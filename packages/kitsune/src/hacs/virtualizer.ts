/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import type { Capability, Json, Reading } from '@haus/core/types';
import {
  type HausDevice,
  type HausEndpoint,
  type DeviceCategory,
  type SystemIssue,
  type ActionableNotification,
  onOffCapability,
  brightnessCapability,
  createTemperatureCapability,
  motionCapability,
  lockCapability,
  coverCapability,
} from '@haus/core/device';
import { PythonSidecarHarness } from './sidecar.js';
import type { HacsEntityPayload, HacsEntityUpdatePayload, HacsIntegrationConfig } from './types.js';
import type { KitsuneCommandPayload, UnsupportedCapability } from '../engine.js';

function makeReading(value: Json): Reading {
  return {
    value,
    freshness: 'live',
    observedAt: new Date().toISOString(),
  };
}

export const SUPPORTED_HACS_DOMAINS = new Set<string>([
  'light',
  'switch',
  'outlet',
  'climate',
  'cover',
  'lock',
  'binary_sensor',
  'sensor',
]);

export const SUPPORTED_HACS_CAPABILITIES = new Set<string>([
  'on_off',
  'brightness',
  'lock',
  'cover',
  'temperature',
]);

export class HacsVirtualizer extends EventEmitter {
  readonly sidecar: PythonSidecarHarness;
  private devices = new Map<string, HausDevice>();
  private entityToDevice = new Map<string, { deviceId: string; endpointId: string }>();
  private unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] = [];

  constructor(sidecar?: PythonSidecarHarness) {
    super();
    this.sidecar = sidecar ?? new PythonSidecarHarness();

    this.sidecar.on('entity_added', (payload: HacsEntityPayload) => {
      this.handleEntityAdded(payload);
    });

    this.sidecar.on('entity_updated', (payload: HacsEntityUpdatePayload) => {
      this.handleEntityUpdated(payload);
    });

    this.sidecar.on('issue_created', (params: Record<string, unknown>) => {
      const issue: SystemIssue = {
        id: String(params.issueId ?? 'unknown_issue'),
        domain: String(params.domain ?? 'hacs'),
        severity: (params.severity as 'critical' | 'warning' | 'info') ?? 'warning',
        title: String(params.translationKey ?? 'HACS Repair Required'),
        description: `Repair required for integration ${String(params.domain ?? 'hacs')}`,
        fixable: true,
        createdAt: new Date().toISOString(),
      };
      this.emit('issueCreated', issue);
    });

    this.sidecar.on('persistent_notification', (params: Record<string, unknown>) => {
      const notification: ActionableNotification = {
        id: String(params.notificationId ?? 'notif'),
        title: String(params.title ?? 'Notification'),
        message: String(params.message ?? ''),
        priority: 'normal',
        createdAt: new Date().toISOString(),
      };
      this.emit('notificationCreated', notification);
    });
  }

  async start(): Promise<void> {
    await this.sidecar.start();
  }

  async stop(): Promise<void> {
    await this.sidecar.stop();
  }

  async loadIntegration(config: HacsIntegrationConfig): Promise<void> {
    await this.sidecar.setupEntry(config.domain, config.entryId, config.data, config.options);
  }

  getDevices(): HausDevice[] {
    return Array.from(this.devices.values());
  }

  getHausDevices(): HausDevice[] {
    return this.getDevices();
  }

  getDevice(id: string): HausDevice | undefined {
    return this.devices.get(id);
  }

  getUnsupportedCapabilities(pluginId?: string): Omit<UnsupportedCapability, 'reportedAt'>[] {
    if (!pluginId) return [...this.unsupported];
    return this.unsupported.filter((u) => u.pluginId === pluginId || !u.pluginId);
  }

  private mapDomainToCategory(domain: string): DeviceCategory {
    switch (domain) {
      case 'light':
        return 'lighting';
      case 'switch':
      case 'outlet':
        return 'power';
      case 'climate':
        return 'climate';
      case 'cover':
        return 'covers';
      case 'lock':
        return 'security';
      case 'binary_sensor':
        return 'occupancy_sensors';
      case 'sensor':
        return 'environmental_sensors';
      default:
        return 'generic';
    }
  }

  private mapDomainToCapabilities(domain: string): Capability[] {
    switch (domain) {
      case 'light':
        return [onOffCapability, brightnessCapability];
      case 'switch':
      case 'outlet':
        return [onOffCapability];
      case 'climate':
        return [createTemperatureCapability('temperature', ['set_temperature'])];
      case 'cover':
        return [coverCapability];
      case 'lock':
        return [lockCapability];
      case 'binary_sensor':
        return [motionCapability];
      case 'sensor':
        return [createTemperatureCapability()];
      default:
        return [];
    }
  }

  private parseReadings(
    domain: string,
    state: string | number | boolean | null,
    attributes: Record<string, unknown>,
  ): Record<string, Reading> {
    const readings: Record<string, Reading> = {};
    if (state === null || state === undefined || state === 'unavailable') {
      return readings;
    }

    if (domain === 'light' || domain === 'switch' || domain === 'outlet') {
      readings.on_off = makeReading(state === 'on' || state === true);
      if (typeof attributes.brightness === 'number') {
        readings.brightness = makeReading(Math.round((attributes.brightness / 255) * 100));
      }
      if (typeof attributes.color_temp_kelvin === 'number') {
        readings.color_temp = makeReading(attributes.color_temp_kelvin);
      }
    } else if (domain === 'sensor' || domain === 'climate') {
      const num = typeof state === 'number' ? state : parseFloat(String(state));
      if (!isNaN(num)) {
        readings.temperature = makeReading(num);
      }
    } else if (domain === 'binary_sensor') {
      readings.motion = makeReading(state === 'on' || state === true);
    } else if (domain === 'lock') {
      readings.lock = makeReading(state === 'locked' ? 'locked' : 'unlocked');
    } else if (domain === 'cover') {
      if (typeof attributes.current_position === 'number') {
        readings.cover = makeReading(attributes.current_position);
      } else {
        readings.cover = makeReading(state === 'open' || state === true ? 100 : 0);
      }
    }

    return readings;
  }

  private handleEntityAdded(payload: HacsEntityPayload): void {
    const deviceId =
      payload.deviceId ?? `hacs:${payload.domain}:${payload.uniqueId ?? payload.entityId}`;

    if (!SUPPORTED_HACS_DOMAINS.has(payload.domain)) {
      const record: Omit<UnsupportedCapability, 'reportedAt'> = {
        runtime: 'hacs',
        pluginId: payload.domain,
        deviceId,
        capability: payload.domain,
        reason: 'unsupported_ha_domain',
      };
      this.unsupported.push(record);
      this.emit('unsupportedCapability', record);
      return;
    }

    const endpointId = payload.entityId;
    const category = this.mapDomainToCategory(payload.domain);
    const capabilities = this.mapDomainToCapabilities(payload.domain);
    const readings = this.parseReadings(payload.domain, payload.state, payload.attributes);

    const existingDevice = this.devices.get(deviceId);
    const endpoints: HausEndpoint[] = existingDevice ? [...existingDevice.endpoints] : [];

    const endpoint: HausEndpoint = {
      id: endpointId,
      address: `${category}::${payload.areaId ?? 'default'}:${deviceId}:${endpointId}`,
      name: payload.name,
      capabilities,
      readings,
    };

    const existingIdx = endpoints.findIndex((ep) => ep.id === endpointId);
    if (existingIdx >= 0) {
      endpoints[existingIdx] = endpoint;
    } else {
      endpoints.push(endpoint);
    }

    const device: HausDevice = {
      id: deviceId,
      source: { instanceId: 'hacs', externalId: deviceId },
      name: payload.name,
      category,
      availability: payload.state === 'unavailable' ? 'offline' : 'online',
      connectivity: {
        protocol: 'virtual',
      },
      endpoints,
      customEntities: {},
    };

    this.devices.set(deviceId, device);
    this.entityToDevice.set(payload.entityId, { deviceId, endpointId });
    this.emit('deviceDiscovered', device);
    this.emit('stateChanged', device);
  }

  private handleEntityUpdated(payload: HacsEntityUpdatePayload): void {
    const mapping = this.entityToDevice.get(payload.entityId);
    if (!mapping) return;

    const existingDevice = this.devices.get(mapping.deviceId);
    if (!existingDevice) return;

    const endpoint = existingDevice.endpoints.find((ep) => ep.id === mapping.endpointId);
    if (!endpoint) return;

    const domain = payload.entityId.split('.')[0] ?? 'unknown';
    const newReadings = this.parseReadings(domain, payload.state, payload.attributes ?? {});
    const updatedReadings = { ...endpoint.readings, ...newReadings };

    const updatedEndpoints = existingDevice.endpoints.map((ep) =>
      ep.id === mapping.endpointId ? { ...ep, readings: updatedReadings } : ep,
    );

    const newAvailability = payload.state === 'unavailable' ? 'offline' : 'online';
    const updatedDevice: HausDevice = {
      ...existingDevice,
      availability: newAvailability,
      endpoints: updatedEndpoints,
    };

    this.devices.set(existingDevice.id, updatedDevice);

    if (existingDevice.availability !== newAvailability) {
      this.emit('deviceAvailabilityChanged', existingDevice.id, newAvailability);
    }

    this.emit('deviceStateChanged', existingDevice.id, updatedReadings);
    this.emit('stateChanged', updatedDevice);
  }

  async executeCommand(command: KitsuneCommandPayload): Promise<void>;
  async executeCommand(
    deviceId: string,
    endpointId: string,
    capabilityKind: string,
    value: unknown,
  ): Promise<void>;
  async executeCommand(
    deviceIdOrCmd: string | KitsuneCommandPayload,
    endpointIdArg?: string,
    capabilityKindArg?: string,
    valueArg?: unknown,
  ): Promise<void> {
    const isCommandObj = typeof deviceIdOrCmd === 'object' && deviceIdOrCmd !== null;
    const deviceId = isCommandObj ? deviceIdOrCmd.deviceId : deviceIdOrCmd;
    const endpointId = isCommandObj ? deviceIdOrCmd.endpointId : (endpointIdArg ?? '');
    const capabilityKind = isCommandObj ? deviceIdOrCmd.capability : (capabilityKindArg ?? '');
    const value = isCommandObj ? deviceIdOrCmd.value : valueArg;

    const domain = endpointId.split('.')[0] ?? 'homeassistant';
    if (!SUPPORTED_HACS_CAPABILITIES.has(capabilityKind)) {
      const record: Omit<UnsupportedCapability, 'reportedAt'> = {
        runtime: 'hacs',
        pluginId: domain,
        deviceId,
        capability: capabilityKind,
        reason: 'unsupported_ha_capability_command',
      };
      this.unsupported.push(record);
      this.emit('unsupportedCapability', record);
      throw new Error(`kitsune_unsupported_capability:${capabilityKind}`);
    }

    let service = 'turn_on';
    const serviceData: Record<string, unknown> = { entity_id: endpointId };

    if (capabilityKind === 'on_off') {
      service = value ? 'turn_on' : 'turn_off';
    } else if (capabilityKind === 'brightness') {
      service = 'turn_on';
      serviceData.brightness = Math.round((Number(value) / 100) * 255);
    } else if (capabilityKind === 'lock') {
      service = value === 'locked' || value === true ? 'lock' : 'unlock';
    } else if (capabilityKind === 'cover') {
      if (typeof value === 'number') {
        service = 'set_cover_position';
        serviceData.position = value;
      } else {
        service = value === 'open' || value === true ? 'open_cover' : 'close_cover';
      }
    } else if (capabilityKind === 'temperature') {
      service = 'set_temperature';
      serviceData.temperature = Number(value);
    }

    await this.sidecar.callService({ domain, service, serviceData });
  }
}
