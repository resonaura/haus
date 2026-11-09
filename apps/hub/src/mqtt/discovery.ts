/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Logger } from '@nestjs/common';
import {
  parseDiscoveryPayload,
  singleDiscoveryIdentity,
  buildEndpointFromComponent,
  extractRawIdentifier,
  inferDeviceCategory,
  inferRoomIdFromLabels,
  resolveCommonDeviceName,
  sanitizeMqttId,
  sortDeviceEndpoints,
  type DeviceBundleDiscoveryPayload,
  type DiscoveryTopic,
  type DiscoveryTopics,
  type MqttEndpointBinding,
  type MqttMessage,
  type MqttDiscoveryClaim,
  type SingleEntityDiscoveryPayload,
} from '@haus/mqtt';
import { stripEntityRoleSuffix, type HausDevice, type HausEndpoint } from '@haus/core';
import type { StandaloneHomeService } from '../home/home.service.js';
import type { DiscoveryBindings } from './bindings.js';
import type { MqttIdentities } from './identity.js';
import { MqttRecovery } from './recovery.js';
import { mqttSourceReferences, resolveMqttRelationships } from './metadata.js';

export class MqttDiscovery {
  private readonly syntheticVideoEndpoints = new Set<string>();
  private readonly recovery?: MqttRecovery;
  constructor(
    private readonly homeService: StandaloneHomeService | undefined,
    private readonly bindings: DiscoveryBindings,
    private readonly discoveryTopics: DiscoveryTopics,
    private readonly logger: Pick<Logger, 'log' | 'warn'>,
    private readonly identities: MqttIdentities,
  ) {
    if (homeService)
      this.recovery = new MqttRecovery(homeService, identities, this.syntheticVideoEndpoints);
  }
  async reconcile(claims: readonly MqttDiscoveryClaim[]): Promise<void> {
    await this.recovery?.run(claims);
    this.refreshRelationships();
  }

  async handle(msg: MqttMessage): Promise<boolean> {
    if (!this.homeService) return true;
    const descriptor = this.discoveryTopics.parse(msg.topic);
    if (!descriptor) return true;

    if (msg.payload.length === 0) {
      this.pruneEndpoints(this.bindings.remove(msg.topic));
      this.refreshRelationships();
      return true;
    }
    const trimmed = msg.payload.trim();
    if (!trimmed) return false;

    try {
      const parsed = parseDiscoveryPayload(descriptor.component, trimmed);
      if (parsed.kind === 'device') {
        await this.handleDeviceBundleDiscovery(msg.topic, parsed.payload);
        this.refreshRelationships();
        return true;
      }
      await this.handleSingleEntityDiscovery(msg.topic, parsed.payload, descriptor);
      this.refreshRelationships();
      return true;
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        ![
          'mqtt_discovery_invalid',
          'mqtt_discovery_unsupported_platform',
          'mqtt_discovery_identity_conflict',
          'mqtt_identity_ambiguous_legacy',
          'invalid_identity_reference',
        ].includes(error.message)
      )
        throw Error('mqtt_discovery_processing_failed');
      // Provider bodies and parser errors can contain credentials; report a stable code only.
      this.logger.warn(
        error instanceof Error &&
          [
            'mqtt_discovery_unsupported_platform',
            'mqtt_discovery_identity_conflict',
            'mqtt_identity_ambiguous_legacy',
          ].includes(error.message)
          ? error.message
          : 'mqtt_discovery_invalid',
      );
      return false;
    }
  }

  private async handleSingleEntityDiscovery(
    topic: string,
    payload: SingleEntityDiscoveryPayload,
    descriptor: DiscoveryTopic,
  ): Promise<void> {
    const { component, objectId } = descriptor;

    const { uniqueId, rawDeviceId: rawDevId } = singleDiscoveryIdentity(descriptor, payload);
    const deviceId = await this.identities.device(rawDevId);
    const preferredEndpointId = `ep_mqtt_${sanitizeMqttId(uniqueId)}`;

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

    const built = buildEndpointFromComponent({
      deviceId,
      deviceName,
      component,
      uniqueId,
      endpointId: preferredEndpointId,
      config: payload,
      isCameraDevice,
    });
    const endpointId = await this.identities.endpoint(
      rawDevId,
      component,
      uniqueId,
      built.endpoint,
      preferredEndpointId,
    );
    const endpoint = { ...built.endpoint, id: endpointId };
    const binding = { ...built.binding, endpointId };
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
        const camEpId = await this.identities.syntheticCamera(rawDevId, `ep_${deviceId}_camera`);
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
      hardwareVersion: payload.device?.hw_version ?? existing?.hardwareVersion,
      serialNumber: payload.device?.serial_number ?? existing?.serialNumber,
      sourceRefs: mqttSourceReferences(
        existing?.sourceRefs,
        rawDevId,
        payload.device,
        payload.origin,
      ),
      relationships: existing?.relationships,
      endpoints,
    };

    this.homeService!.registerDevice(device);
    this.pruneEndpoints(this.bindings.update(topic, new Map([['', binding]])));

    this.logger.log(
      `Discovered MQTT entity "${endpoint.name}" -> device "${deviceName}" (${deviceId}, ${endpoints.length} endpoints)`,
    );
  }

  private async handleDeviceBundleDiscovery(
    topic: string,
    payload: DeviceBundleDiscoveryPayload,
  ): Promise<void> {
    const rawDevId = extractRawIdentifier(payload.device) || 'device';
    const deviceId = await this.identities.device(rawDevId);
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
      const preferredEndpointId = `ep_${sanitizeMqttId(uniqueId)}`;
      const component = comp.platform || 'sensor';

      const built = buildEndpointFromComponent({
        deviceId,
        deviceName,
        component,
        uniqueId,
        endpointId: preferredEndpointId,
        config: comp,
        componentKey: compKey,
        fallbackStateTopic: payload.state_topic,
        isCameraDevice,
      });
      const endpointId = await this.identities.endpoint(
        rawDevId,
        component,
        uniqueId,
        built.endpoint,
        preferredEndpointId,
      );
      const endpoint = { ...built.endpoint, id: endpointId };
      const binding = { ...built.binding, endpointId };
      if ([...changes.values()].some((previous) => previous?.endpointId === endpointId))
        throw Error('mqtt_discovery_identity_conflict');

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
      hardwareVersion: payload.device?.hw_version ?? existing?.hardwareVersion,
      serialNumber: payload.device?.serial_number ?? existing?.serialNumber,
      sourceRefs: mqttSourceReferences(
        existing?.sourceRefs,
        rawDevId,
        payload.device,
        payload.origin,
      ),
      relationships: existing?.relationships,
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

  private refreshRelationships(): void {
    if (!this.homeService) return;
    const devices = this.homeService.listDevices();
    const resolved = resolveMqttRelationships(devices);
    for (const [index, device] of resolved.entries())
      if (device !== devices[index]) this.homeService.registerDevice(device);
  }
}
