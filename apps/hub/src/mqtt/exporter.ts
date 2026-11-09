/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Logger } from '@nestjs/common';
import {
  DiscoveryTopics,
  isHausExportTopic,
  projectMqttEndpoint,
  type HausMqttBroker,
  type MqttCommand,
  type RetainedPacket,
} from '@haus/mqtt';
import type { StandaloneHomeService } from '../home/home.service.js';
import type { PreferencesResponseDto } from '../preferences/preferences.dto.js';

interface ExportPreferences {
  get(): Promise<PreferencesResponseDto>;
  subscribe?(listener: () => void): () => void;
}

interface ProjectedExport {
  readonly discoveryTopic: string;
  readonly discoveryPayload: string;
  readonly stateTopic: string;
  readonly statePayload?: string;
  readonly availabilityTopic: string;
  readonly availabilityPayload?: 'online' | 'offline';
}

/** Publishes only explicit local-device opt-ins, and reconciles the Haus-owned MQTT namespace. */
export class MqttExportPublisher {
  private readonly discoveryPayloads = new Map<string, string>();
  private readonly statePayloads = new Map<string, string>();
  private readonly availabilityPayloads = new Map<string, string>();
  private availabilityTopics = new Set<string>();
  private readonly stopListening: (() => void)[] = [];
  private structure = '';
  private started = false;
  private stopping = false;
  private dirty = false;
  private refreshing?: Promise<void>;

  constructor(
    private readonly broker: HausMqttBroker,
    private readonly home: StandaloneHomeService,
    private readonly preferences: ExportPreferences | undefined,
    private readonly retainedStore: { load(): Promise<readonly RetainedPacket[]> } | undefined,
    private readonly topics: DiscoveryTopics,
    private readonly homeId: string,
    private readonly nodeId: string,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopListening.push(
      this.home.subscribeDevices(() => this.scheduleRefresh()),
      this.preferences?.subscribe?.(() => this.scheduleRefresh()) ?? (() => {}),
    );
    await this.refresh();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    this.stopListening.splice(0).forEach((stop) => stop());
    await this.refreshing?.catch(() => {});
    let failed = false;
    for (const topic of this.availabilityTopics) {
      try {
        await this.publish(topic, 'offline');
        this.availabilityPayloads.set(topic, 'offline');
      } catch {
        failed = true;
      }
    }
    this.started = false;
    if (failed) throw Error('mqtt_export_shutdown_failed');
  }

  private scheduleRefresh(): void {
    void this.refresh().catch(() => this.logger.warn('mqtt_export_refresh_failed'));
  }

  private refresh(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.dirty = true;
    if (!this.refreshing) {
      this.refreshing = this.flush().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async flush(): Promise<void> {
    while (this.dirty && !this.stopping) {
      this.dirty = false;
      await this.refreshOnce();
    }
  }

  private async refreshOnce(): Promise<void> {
    const selected = await this.selectedDevices();
    const projected = this.project(selected);
    const discovery = new Map(
      projected.map((item) => [item.discoveryTopic, item.discoveryPayload]),
    );
    const states = new Map<string, string>();
    const availability = new Map<string, string>();
    const availabilityTopics = new Set<string>();
    for (const item of projected) {
      if (item.statePayload !== undefined) states.set(item.stateTopic, item.statePayload);
      availabilityTopics.add(item.availabilityTopic);
      if (item.availabilityPayload !== undefined)
        availability.set(item.availabilityTopic, item.availabilityPayload);
    }

    const nextStructure = JSON.stringify({
      discovery: [...discovery].sort(([left], [right]) => left.localeCompare(right)),
      states: [...states.keys()].sort(),
      availability: [...availabilityTopics].sort(),
    });
    if (nextStructure !== this.structure) {
      await this.restoreAndReconcile(discovery, states, availability);
      this.structure = nextStructure;
    } else {
      await this.publishChanges(discovery, states, availability);
    }
    this.availabilityTopics = availabilityTopics;
  }

  private async selectedDevices(): Promise<ReadonlySet<string>> {
    if (!this.preferences) return new Set();
    const value = (await this.preferences.get()).value.mqttExportDevices;
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0));
  }

  private project(selectedDeviceIds: ReadonlySet<string>): ProjectedExport[] {
    const output: ProjectedExport[] = [];
    for (const device of this.home.listDevices()) {
      if (!selectedDeviceIds.has(device.id)) continue;
      for (const endpoint of device.endpoints) {
        const endpointState = this.home.getEndpointState(endpoint.id);
        for (const capability of endpoint.capabilities) {
          const result = projectMqttEndpoint({
            device,
            endpointId: endpoint.id,
            capabilityId: capability.id,
            endpointState,
            selectedDeviceIds,
            homeId: this.homeId,
            discoveryPrefix: this.topics.prefixes[0],
          });
          if (result.kind !== 'projected') continue;
          output.push({
            discoveryTopic: result.projection.discoveryTopic,
            discoveryPayload: JSON.stringify(result.projection.discovery),
            stateTopic: result.projection.stateTopic,
            statePayload: result.projection.statePayload,
            availabilityTopic: result.projection.availabilityTopic,
            availabilityPayload: result.projection.availabilityPayload,
          });
        }
      }
    }
    return output;
  }

  private async restoreAndReconcile(
    discovery: ReadonlyMap<string, string>,
    states: ReadonlyMap<string, string>,
    availability: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (this.retainedStore) this.loadKnown(await this.retainedStore.load());
    await this.reconcileMap(this.discoveryPayloads, discovery);
    await this.reconcileMap(this.statePayloads, states);
    await this.reconcileMap(this.availabilityPayloads, availability);
  }

  private loadKnown(packets: readonly RetainedPacket[]): void {
    this.discoveryPayloads.clear();
    this.statePayloads.clear();
    this.availabilityPayloads.clear();
    for (const packet of packets) {
      const payload = Buffer.from(packet.payload).toString('utf8');
      if (!payload) continue;
      const discovery = this.topics.parse(packet.topic);
      if (discovery?.nodeId === this.nodeId && discovery.objectId.startsWith('haus_')) {
        this.discoveryPayloads.set(packet.topic, payload);
      } else if (isHausExportTopic(packet.topic, this.nodeId)) {
        if (packet.topic.includes('/state/')) this.statePayloads.set(packet.topic, payload);
        else this.availabilityPayloads.set(packet.topic, payload);
      }
    }
  }

  private async reconcileMap(
    previous: Map<string, string>,
    next: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const topic of previous.keys()) {
      if (!next.has(topic)) await this.clear(topic);
    }
    for (const [topic, payload] of next) {
      if (previous.get(topic) !== payload) await this.publish(topic, payload);
    }
    previous.clear();
    for (const [topic, payload] of next) previous.set(topic, payload);
  }

  private async publishChanges(
    discovery: ReadonlyMap<string, string>,
    states: ReadonlyMap<string, string>,
    availability: ReadonlyMap<string, string>,
  ): Promise<void> {
    await this.reconcileMap(this.discoveryPayloads, discovery);
    await this.reconcileMap(this.statePayloads, states);
    await this.reconcileMap(this.availabilityPayloads, availability);
  }

  private publish(topic: string, payload: string): Promise<void> {
    const command: MqttCommand = { topic, payload, qos: 1, retain: true };
    return this.broker.publish(command);
  }

  private clear(topic: string): Promise<void> {
    return this.publish(topic, '');
  }
}
