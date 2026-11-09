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
  bundleDiscovery,
  componentDiscovery,
  discoveryObject,
  buildCommandMessages,
  buildEndpointFromComponent,
  consolidateLegacyMqttDevices,
  expandHaDiscoveryPayload,
  extractEndpointStatePatch,
  extractRawIdentifier,
  inferDeviceCategory,
  inferRoomIdFromLabels,
  resolveCommonDeviceName,
  resolvePhysicalDeviceId,
  sanitizeMqttId,
  sortDeviceEndpoints,
  type DeviceBundleDiscoveryPayload,
  type HausMqttBrokerOptions,
  type MqttCommand,
  type MqttEndpointBinding,
  type MqttMessage,
  type SingleEntityDiscoveryPayload,
} from '@haus/mqtt';
import { stripEntityRoleSuffix, type HausDevice, type HausEndpoint } from '@haus/core';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { HAUS_MQTT_OPTIONS } from './tokens.js';
import { DiscoveryBindings } from './bindings.js';

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  public readonly broker: HausMqttBroker;
  private readonly bindings = new DiscoveryBindings();
  private readonly syntheticVideoEndpoints = new Set<string>();
  private unregisterCommandHandler?: () => void;
  private isStarted = false;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(HAUS_MQTT_OPTIONS)
    options?: HausMqttBrokerOptions,
  ) {
    const port = options?.port ?? Number(process.env.HAUS_MQTT_PORT || 1883);
    const host = options?.host ?? process.env.HAUS_MQTT_HOST ?? '0.0.0.0';
    const allowAnonymous = options?.allowAnonymous ?? process.env.HAUS_MQTT_ALLOW_ANON !== 'false';

    this.broker = new HausMqttBroker({
      port,
      host,
      allowAnonymous,
      username: options?.username ?? process.env.HAUS_MQTT_USER,
      password: options?.password ?? process.env.HAUS_MQTT_PASS,
    });
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

      const bound = await this.broker.listen();
      this.isStarted = true;
      this.logger.log(`Native Haus MQTT Broker listening on ${bound.host}:${bound.port}`);

      this.setupMqttSubscribers();

      if (this.homeService) {
        this.unregisterCommandHandler = this.homeService.registerCommandHandler(
          'mqtt',
          async (endpointId, capability, command, parameters) => {
            await this.handleDeviceCommand(endpointId, capability, command, parameters);
          },
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to start native Haus MQTT Broker: ${msg}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unregisterCommandHandler?.();
    if (this.isStarted) {
      await this.broker.close();
      this.isStarted = false;
      this.logger.log('Native Haus MQTT Broker stopped.');
    }
  }

  async publish(command: MqttCommand): Promise<void> {
    return this.broker.publish(command);
  }

  private setupMqttSubscribers(): void {
    this.broker.subscribe('homeassistant/#', (msg) => {
      if (msg.topic.endsWith('/config')) {
        this.handleDiscovery(msg);
      }
    });
    this.broker.subscribe('haus/#', (msg) => {
      if (msg.topic.endsWith('/config')) {
        this.handleDiscovery(msg);
      }
    });

    this.broker.on('message', (msg: MqttMessage) => {
      this.handleStateMessage(msg);
    });
  }

  private handleDiscovery(msg: MqttMessage): void {
    if (!this.homeService) return;

    if (msg.payload.length === 0) {
      this.pruneEndpoints(this.bindings.remove(msg.topic));
      return;
    }
    const trimmed = msg.payload.trim();
    if (!trimmed) return;

    try {
      const rawParsed: unknown = JSON.parse(trimmed);
      if (!discoveryObject(rawParsed)) throw Error('mqtt_discovery_invalid');
      const parsed = expandHaDiscoveryPayload(rawParsed);
      if ('components' in parsed) {
        if (!bundleDiscovery(parsed)) throw Error('mqtt_discovery_invalid');
        this.handleDeviceBundleDiscovery(msg.topic, parsed);
        return;
      }
      if (!componentDiscovery(parsed)) throw Error('mqtt_discovery_invalid');
      this.handleSingleEntityDiscovery(msg.topic, parsed);
    } catch {
      // Provider bodies and parser errors can contain credentials; report a stable code only.
      this.logger.warn('mqtt_discovery_invalid');
    }
  }

  private handleSingleEntityDiscovery(topic: string, payload: SingleEntityDiscoveryPayload): void {
    const parts = topic.split('/');
    const component = payload.platform || parts[1] || 'switch';
    const objectId = parts.length >= 5 ? (parts[3] ?? 'object') : (parts[2] ?? 'object');
    const nodeId = parts.length >= 5 ? parts[2] : undefined;

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

  private handleStateMessage(msg: MqttMessage): void {
    if (!this.homeService) return;
    const endpoints = this.bindings.matching(msg.topic);
    if (!endpoints || endpoints.size === 0) return;

    for (const endpointId of endpoints) {
      const binding = this.bindings.get(endpointId);
      if (!binding) continue;
      const patch = extractEndpointStatePatch(binding, msg.payload);
      if (Object.keys(patch).length > 0) {
        void this.homeService.updateEndpointState(endpointId, patch, true);
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
