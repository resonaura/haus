/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  HausMqttBroker,
  DiscoveryTopics,
  parseDiscoveryPayload,
  buildCommandMessages,
  buildEndpointFromComponent,
  consolidateLegacyMqttDevices,
  extractEndpointStatePatch,
  extractRawIdentifier,
  inferDeviceCategory,
  inferRoomIdFromLabels,
  resolveCommonDeviceName,
  resolvePhysicalDeviceId,
  sanitizeMqttId,
  sortDeviceEndpoints,
  type DeviceBundleDiscoveryPayload,
  type DiscoveryTopic,
  type MqttCommand,
  type MqttEndpointBinding,
  type MqttMessage,
  type RetainedStore,
  type SingleEntityDiscoveryPayload,
} from '@haus/mqtt';
import { stripEntityRoleSuffix, type HausDevice, type HausEndpoint } from '@haus/core';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { HAUS_MQTT_OPTIONS } from './tokens.js';
import { DiscoveryBindings } from './bindings.js';
import { OrmMqttRetention } from '../storage/mqtt/retention.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { CatalogLifetime } from '../storage/lifetime.js';
import type { MqttServiceOptions } from './options.js';

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  public readonly broker: HausMqttBroker;
  private readonly bindings = new DiscoveryBindings();
  private readonly syntheticVideoEndpoints = new Set<string>();
  private unregisterCommandHandler?: () => void;
  private isStarted = false;
  private readonly retainedStore?: RetainedStore;
  private stopSubscribers: (() => void)[] = [];
  private readonly discoveryTopics: DiscoveryTopics;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(HAUS_MQTT_OPTIONS)
    options?: MqttServiceOptions,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(CatalogLifetime) lifetime?: CatalogLifetime,
  ) {
    const port = options?.port ?? Number(process.env.HAUS_MQTT_PORT || 1883);
    const host = options?.host ?? process.env.HAUS_MQTT_HOST ?? '0.0.0.0';
    const allowAnonymous = options?.allowAnonymous ?? process.env.HAUS_MQTT_ALLOW_ANON !== 'false';
    this.discoveryTopics = new DiscoveryTopics(
      options?.discoveryPrefixes ??
        process.env.HAUS_MQTT_DISCOVERY_PREFIXES?.split(',').map((prefix) => prefix.trim()),
    );
    this.retainedStore =
      options?.retainedStore ??
      (transactions ? new OrmMqttRetention(transactions, this.discoveryTopics) : undefined);

    this.broker = new HausMqttBroker({
      port,
      host,
      allowAnonymous,
      username: options?.username ?? process.env.HAUS_MQTT_USER,
      password: options?.password ?? process.env.HAUS_MQTT_PASS,
      retainedStore: this.retainedStore,
    });
    lifetime?.defer(() => this.onApplicationShutdown());
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.isStarted) return;
    try {
      if (this.homeService) {
        const consolidated = consolidateLegacyMqttDevices(this.homeService);
        if (consolidated > 0) {
          this.logger.log(`Consolidated ${consolidated} fragmented legacy MQTT device entries.`);
        }
      }

      await this.restoreRetained();
      this.setupMqttSubscribers();
      const bound = await this.broker.listen();
      this.isStarted = true;
      this.logger.log(`Native Haus MQTT Broker listening on ${bound.host}:${bound.port}`);

      if (this.homeService) {
        this.unregisterCommandHandler = this.homeService.registerCommandHandler(
          'mqtt',
          async (endpointId, capability, command, parameters) => {
            await this.handleDeviceCommand(endpointId, capability, command, parameters);
          },
        );
      }
    } catch {
      this.logger.error('mqtt_start_failed');
      this.stopSubscribers.splice(0).forEach((stop) => stop());
      await this.broker.close();
      throw Error('mqtt_start_failed');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unregisterCommandHandler?.();
    this.stopSubscribers.splice(0).forEach((stop) => stop());
    if (this.isStarted) {
      await this.broker.close();
      this.isStarted = false;
      this.logger.log('Native Haus MQTT Broker stopped.');
    }
  }

  async publish(command: MqttCommand): Promise<void> {
    return this.broker.publish(command);
  }

  private async restoreRetained(): Promise<void> {
    const messages = [...((await this.retainedStore?.load()) ?? [])]
      .sort((a, b) => (a.replayOrder ?? 0) - (b.replayOrder ?? 0))
      .map((packet) => ({
        topic: packet.topic,
        payload: Buffer.from(packet.replayPayload ?? packet.payload).toString('utf8'),
        retained: true,
      }));
    for (const message of messages) {
      if (this.discoveryTopics.parse(message.topic)) this.handleDiscovery(message);
    }
    // Startup state is a snapshot, not a new physical event/automation trigger.
    for (const message of messages) await this.handleStateMessage(message, false);
  }

  private setupMqttSubscribers(): void {
    for (const prefix of this.discoveryTopics.prefixes) {
      this.stopSubscribers.push(
        this.broker.subscribe(`${prefix}/#`, (msg) => {
          if (this.discoveryTopics.parse(msg.topic)) this.handleDiscovery(msg);
        }),
      );
    }

    const stateListener = (msg: MqttMessage) => {
      void this.handleStateMessage(msg).catch(() => this.logger.warn('mqtt_state_update_failed'));
    };
    this.broker.on('message', stateListener);
    this.stopSubscribers.push(() => {
      this.broker.off('message', stateListener);
    });
  }

  private handleDiscovery(msg: MqttMessage): void {
    if (!this.homeService) return;
    const descriptor = this.discoveryTopics.parse(msg.topic);
    if (!descriptor) return;

    if (msg.payload.length === 0) {
      this.pruneEndpoints(this.bindings.remove(msg.topic));
      return;
    }
    const trimmed = msg.payload.trim();
    if (!trimmed) return;

    try {
      const parsed = parseDiscoveryPayload(descriptor.component, trimmed);
      if (parsed.kind === 'device') {
        this.handleDeviceBundleDiscovery(msg.topic, parsed.payload);
        return;
      }
      this.handleSingleEntityDiscovery(msg.topic, parsed.payload, descriptor);
    } catch (error: unknown) {
      // Provider bodies and parser errors can contain credentials; report a stable code only.
      this.logger.warn(
        error instanceof Error && error.message === 'mqtt_discovery_unsupported_platform'
          ? 'mqtt_discovery_unsupported_platform'
          : 'mqtt_discovery_invalid',
      );
    }
  }

  private handleSingleEntityDiscovery(
    topic: string,
    payload: SingleEntityDiscoveryPayload,
    descriptor: DiscoveryTopic,
  ): void {
    const { component, objectId, nodeId } = descriptor;

    const uniqueId =
      payload.unique_id ||
      sanitizeMqttId(nodeId ? `${component}_${nodeId}_${objectId}` : `${component}_${objectId}`);

    const rawDevId = resolvePhysicalDeviceId(uniqueId, payload.device, nodeId);
    const deviceId = `mqtt_${sanitizeMqttId(rawDevId)}`;
    const endpointId = `ep_mqtt_${sanitizeMqttId(uniqueId)}`;

    const existing = this.homeService?.getDevice(deviceId);
    const hasSharedDeviceId =
      Boolean(extractRawIdentifier(payload.device)) || rawDevId !== uniqueId;
    const candidateNames = [
      ...(payload.device?.name ? [payload.device.name] : []),
      ...(existing?.name ? [existing.name] : []),
      ...(payload.name ? [payload.name] : []),
    ];
    const deviceName =
      hasSharedDeviceId && payload.device?.name
        ? stripEntityRoleSuffix(payload.device.name)
        : existing?.name
          ? resolveCommonDeviceName(candidateNames, existing.name)
          : stripEntityRoleSuffix(
              payload.name || payload.device?.name || `${component.toUpperCase()} ${objectId}`,
            );

    const model = payload.device?.model ?? existing?.model;
    const isCameraDevice =
      component === 'camera' ||
      existing?.category === 'cameras' ||
      /\b(camera|doorbell|nvr|g2h|g3|ch-h0[1-9])\b/i.test(
        `${rawDevId} ${deviceName} ${model ?? ''}`,
      );

    const { endpoint, binding } = buildEndpointFromComponent({
      deviceId,
      deviceName,
      component,
      uniqueId,
      endpointId,
      config: payload,
      isCameraDevice,
    });
    this.bindings.validate([binding]);

    const endpointMap = new Map<string, HausEndpoint>();
    for (const ep of existing?.endpoints ?? []) {
      endpointMap.set(ep.id, ep);
    }
    endpointMap.set(endpoint.id, endpoint);

    if (isCameraDevice) {
      const hasVideoEndpoint = [...endpointMap.values()].some((ep) =>
        ep.capabilities.some((c) => c.id === 'video'),
      );
      if (!hasVideoEndpoint) {
        const camEpId = `ep_${deviceId}_camera`;
        this.syntheticVideoEndpoints.add(camEpId);
        endpointMap.set(camEpId, {
          id: camEpId,
          name: deviceName,
          category: 'cameras',
          capabilities: [{ id: 'video', kind: 'complex', readable: true, operations: [] }],
          readings: {},
        });
      }
    }

    const endpoints = sortDeviceEndpoints([...endpointMap.values()]);
    const category = inferDeviceCategory({
      id: rawDevId,
      name: deviceName,
      model,
      endpoints,
    });
    const roomId = inferRoomIdFromLabels({
      suggestedArea: payload.device?.suggested_area,
      existingRoomId: existing?.roomId,
      candidateLabels: [deviceName, ...endpoints.map((ep) => ep.name)],
    });

    const device: HausDevice = {
      id: deviceId,
      source: {
        instanceId: 'haus-mqtt',
        externalId: rawDevId,
      },
      name: deviceName,
      category,
      roomId,
      areaId: roomId !== 'unassigned' ? roomId : undefined,
      availability: 'online',
      connectivity: { protocol: 'mqtt' },
      manufacturer: payload.device?.manufacturer ?? existing?.manufacturer,
      model,
      firmwareVersion: payload.device?.sw_version ?? existing?.firmwareVersion,
      sourceRefs: [{ protocol: 'mqtt', externalId: rawDevId }],
      endpoints,
    };

    this.homeService!.registerDevice(device);
    this.pruneEndpoints(this.bindings.update(topic, new Map([['', binding]])));

    this.logger.log(
      `Discovered MQTT entity "${endpoint.name}" -> device "${deviceName}" (${deviceId}, ${endpoints.length} endpoints)`,
    );
  }

  private handleDeviceBundleDiscovery(topic: string, payload: DeviceBundleDiscoveryPayload): void {
    const rawDevId = extractRawIdentifier(payload.device) || 'device';
    const deviceId = `mqtt_${sanitizeMqttId(rawDevId)}`;
    const existing = this.homeService?.getDevice(deviceId);
    const deviceName = stripEntityRoleSuffix(payload.device?.name || existing?.name || rawDevId);
    const model = payload.device?.model ?? existing?.model;
    const isCameraDevice = /\b(camera|doorbell|nvr|g2h|g3|ch-h0[1-9])\b/i.test(
      `${rawDevId} ${deviceName} ${model ?? ''}`,
    );

    const endpointMap = new Map<string, HausEndpoint>();
    for (const ep of existing?.endpoints ?? []) {
      endpointMap.set(ep.id, ep);
    }

    const changes = new Map<string, MqttEndpointBinding | undefined>();
    for (const [compKey, comp] of Object.entries(payload.components)) {
      if (typeof comp.platform === 'string' && Object.keys(comp).length === 1) {
        changes.set(compKey, undefined);
        continue;
      }
      const uniqueId = comp.unique_id || `${rawDevId}_${compKey}`;
      const endpointId = `ep_${sanitizeMqttId(uniqueId)}`;
      const component = comp.platform || 'sensor';

      const { endpoint, binding } = buildEndpointFromComponent({
        deviceId,
        deviceName,
        component,
        uniqueId,
        endpointId,
        config: comp,
        componentKey: compKey,
        fallbackStateTopic: payload.state_topic,
        isCameraDevice,
      });

      endpointMap.set(endpoint.id, endpoint);
      changes.set(compKey, binding);
    }
    this.bindings.validate([...changes.values()].filter((value) => value !== undefined));

    const endpoints = sortDeviceEndpoints([...endpointMap.values()]);
    const category = inferDeviceCategory({
      id: rawDevId,
      name: deviceName,
      model,
      endpoints,
    });
    const roomId = inferRoomIdFromLabels({
      suggestedArea: payload.device?.suggested_area,
      existingRoomId: existing?.roomId,
      candidateLabels: [deviceName, ...endpoints.map((ep) => ep.name)],
    });

    const device: HausDevice = {
      id: deviceId,
      source: {
        instanceId: 'haus-mqtt',
        externalId: rawDevId,
      },
      name: deviceName,
      category,
      roomId,
      areaId: roomId !== 'unassigned' ? roomId : undefined,
      availability: 'online',
      connectivity: { protocol: 'mqtt' },
      manufacturer: payload.device?.manufacturer ?? existing?.manufacturer,
      model,
      firmwareVersion: payload.device?.sw_version ?? existing?.firmwareVersion,
      sourceRefs: [{ protocol: 'mqtt', externalId: rawDevId }],
      endpoints,
    };

    if (endpoints.length > 0) this.homeService!.registerDevice(device);
    this.pruneEndpoints(this.bindings.update(topic, changes));
    this.logger.log(
      `Discovered MQTT bundled device "${deviceName}" (${deviceId}) with ${endpoints.length} endpoints`,
    );
  }

  private pruneEndpoints(removed: readonly MqttEndpointBinding[]): void {
    const groups = new Map<string, Set<string>>();
    for (const binding of removed) {
      const endpoints = groups.get(binding.deviceId) ?? new Set<string>();
      endpoints.add(binding.endpointId);
      groups.set(binding.deviceId, endpoints);
    }
    for (const [deviceId, ids] of groups) {
      const device = this.homeService?.getDevice(deviceId);
      if (!device) continue;
      const endpoints = device.endpoints.filter((endpoint) => !ids.has(endpoint.id));
      if (
        endpoints.every(
          (endpoint) =>
            this.syntheticVideoEndpoints.has(endpoint.id) && !this.bindings.get(endpoint.id),
        )
      ) {
        for (const endpoint of device.endpoints) this.syntheticVideoEndpoints.delete(endpoint.id);
        this.homeService?.removeDevice(deviceId);
      } else {
        this.homeService?.registerDevice({
          ...device,
          services: [],
          endpoints,
          category: inferDeviceCategory({
            id: device.source.externalId,
            name: device.name,
            model: device.model,
            endpoints,
          }),
        });
      }
    }
  }

  private async handleStateMessage(msg: MqttMessage, dispatchTriggers = true): Promise<void> {
    if (!this.homeService) return;
    const endpoints = this.bindings.matching(msg.topic);
    if (!endpoints || endpoints.size === 0) return;

    for (const endpointId of endpoints) {
      const binding = this.bindings.get(endpointId);
      if (!binding) continue;
      const patch = extractEndpointStatePatch(binding, msg.payload);
      if (Object.keys(patch).length > 0) {
        await this.homeService.updateEndpointState(endpointId, patch, dispatchTriggers);
      }
    }
  }

  private async handleDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const binding = this.bindings.get(endpointId);
    if (!binding) throw Error('mqtt_endpoint_unavailable');

    const messages = buildCommandMessages(binding, capability, command, parameters);
    for (const msg of messages) {
      await this.broker.publish({
        topic: msg.topic,
        payload: msg.payload,
        qos: 1,
      });
    }
  }
}
