/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import { formatAddress, slugifySegment } from '@haus/core/identity';
import {
  rgbToHs,
  type HausDevice,
  type HausEndpoint,
  type SystemIssue,
  type ActionableNotification,
} from '@haus/core/device';
import { PythonSidecarHarness } from './sidecar.js';
import type {
  HacsBleAdvertisementPayload,
  HacsEntityPayload,
  HacsEntityUpdatePayload,
  HacsIntegrationConfig,
} from './types.js';
import type { KitsuneCommandPayload, UnsupportedCapability } from '../engine.js';
import {
  SUPPORTED_HACS_DOMAINS,
  SUPPORTED_HACS_CAPABILITIES,
  mapDomainToCategory,
  mapDomainToCapabilities,
  parseReadings,
} from './projection.js';

export { SUPPORTED_HACS_DOMAINS, SUPPORTED_HACS_CAPABILITIES };

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

  async injectBleAdvertisement(
    payload: HacsBleAdvertisementPayload,
  ): Promise<{ status: string; matched: number }> {
    return this.sidecar.injectBleAdvertisement(payload);
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
    const category = mapDomainToCategory(payload.domain, payload.attributes);
    const capabilities = mapDomainToCapabilities(payload.domain, payload);
    const readings = parseReadings(payload.domain, payload.state, payload.attributes);

    const existingDevice = this.devices.get(deviceId);
    const endpoints: HausEndpoint[] = existingDevice ? [...existingDevice.endpoints] : [];

    const endpoint: HausEndpoint = {
      id: endpointId,
      address: formatAddress({
        type: slugifySegment(category),
        area: slugifySegment(payload.areaId ?? 'default'),
        device: slugifySegment(deviceId),
        entity: slugifySegment(endpointId),
      }),
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

    const finalCategory =
      existingDevice?.category === 'climate' || category === 'climate'
        ? 'climate'
        : existingDevice?.category === 'network' || category === 'network'
          ? 'network'
          : existingDevice?.category === 'power' || category === 'power'
            ? 'power'
            : (existingDevice?.category ?? category);

    const device: HausDevice = {
      id: deviceId,
      source: { instanceId: 'hacs', externalId: deviceId },
      name: existingDevice?.name ?? payload.name,
      category: finalCategory,
      availability: payload.state === 'unavailable' ? 'offline' : 'online',
      connectivity: {
        protocol: 'virtual',
      },
      sourceRefs: [{ protocol: 'virtual', externalId: deviceId }],
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
    const newReadings = parseReadings(domain, payload.state, payload.attributes ?? {});
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
    const params = isCommandObj ? deviceIdOrCmd.parameters : undefined;

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

    const dev = this.devices.get(deviceId);
    const ep = dev?.endpoints.find((e) => e.id === endpointId);
    if (ep) {
      const capAliases: Record<string, string[]> = {
        target_temperature: ['temperature', 'target_temperature', 'climate'],
        temperature: ['temperature', 'target_temperature', 'climate'],
        hvac_mode: ['hvac_mode', 'climate'],
        fan_mode: ['fan_mode', 'climate'],
        swing_mode: ['swing_mode', 'climate'],
        swing_horizontal_mode: ['swing_horizontal_mode', 'climate'],
        press: ['press', 'button'],
        button: ['press', 'button'],
        effect: ['effect', 'light'],
        scene: ['scene', 'action', 'on_off'],
        action: ['scene', 'action', 'button', 'press'],
        event: ['event'],
        select: ['select', 'select_option', 'mode'],
        select_option: ['select', 'select_option', 'mode'],
        update: ['update', 'install', 'on_off'],
        install: ['update', 'install', 'on_off'],
        device_tracker: ['device_tracker', 'presence', 'contact'],
        presence: ['device_tracker', 'presence', 'contact'],
        weather: ['weather'],
        notify: ['notify', 'service', 'send_message'],
        send_message: ['notify', 'service', 'send_message'],
      };
      const validNames = new Set(capAliases[capabilityKind] ?? [capabilityKind]);
      const hasCap = ep.capabilities.some(
        (c) => validNames.has(c.id) || validNames.has(c.kind as string),
      );
      if (!hasCap) {
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
    }

    let service = 'turn_on';
    const serviceData: Record<string, unknown> = { entity_id: endpointId };

    if (capabilityKind === 'on_off') {
      service = value ? 'turn_on' : 'turn_off';
      if (domain === 'climate' && params) {
        if (typeof params.temperature === 'number') serviceData.temperature = params.temperature;
        if (typeof params.target_temperature === 'number')
          serviceData.temperature = params.target_temperature;
        if (typeof params.hvac_mode === 'string') serviceData.hvac_mode = params.hvac_mode;
      } else if (value && params) {
        if (typeof params.brightness === 'number') {
          serviceData.brightness = Math.round((Number(params.brightness) / 100) * 255);
        }
        if (typeof params.color_temp === 'number' || typeof params.color_temp_kelvin === 'number') {
          serviceData.kelvin = Number(params.color_temp_kelvin ?? params.color_temp);
        }
        if (typeof params.effect === 'string') {
          serviceData.effect = params.effect;
        }
      }
    } else if (capabilityKind === 'effect') {
      service = 'turn_on';
      serviceData.effect = String(value ?? params?.effect);
    } else if (capabilityKind === 'brightness') {
      service = 'turn_on';
      serviceData.brightness = Math.round((Number(value) / 100) * 255);
    } else if (capabilityKind === 'color_temp') {
      service = 'turn_on';
      serviceData.kelvin = Number(value);
    } else if (capabilityKind === 'color_hsv') {
      service = 'turn_on';
      if (typeof value === 'object' && value !== null) {
        const val = value as Record<string, unknown>;
        if (typeof val.hue === 'number' && typeof val.saturation === 'number') {
          serviceData.hs_color = [val.hue, val.saturation];
        } else if (typeof val.h === 'number' && typeof val.s === 'number') {
          serviceData.hs_color = [val.h, val.s];
        } else if (
          typeof val.r === 'number' &&
          typeof val.g === 'number' &&
          typeof val.b === 'number'
        ) {
          const hs = rgbToHs(val.r, val.g, val.b);
          serviceData.hs_color = [hs.h, hs.s];
        }
      } else if (Array.isArray(value) && value.length >= 2) {
        serviceData.hs_color = [Number(value[0]), Number(value[1])];
      }
    } else if (capabilityKind === 'lock') {
      service = value === 'locked' || value === true ? 'lock' : 'unlock';
    } else if (capabilityKind === 'cover') {
      if (typeof value === 'number') {
        service = 'set_cover_position';
        serviceData.position = value;
      } else {
        service = value === 'open' || value === true ? 'open_cover' : 'close_cover';
      }
    } else if (
      capabilityKind === 'temperature' ||
      capabilityKind === 'target_temperature' ||
      capabilityKind === 'climate'
    ) {
      service = 'set_temperature';
      if (typeof value === 'number') {
        serviceData.temperature = value;
      } else if (typeof params?.temperature === 'number') {
        serviceData.temperature = params.temperature;
      } else if (typeof params?.target_temperature === 'number') {
        serviceData.temperature = params.target_temperature;
      }
      if (typeof params?.hvac_mode === 'string') {
        serviceData.hvac_mode = params.hvac_mode;
      }
      if (typeof params?.fan_mode === 'string') {
        serviceData.fan_mode = params.fan_mode;
      }
      if (typeof params?.swing_mode === 'string') {
        serviceData.swing_mode = params.swing_mode;
      }
    } else if (capabilityKind === 'hvac_mode') {
      service = 'set_hvac_mode';
      serviceData.hvac_mode = String(value);
      if (typeof params?.temperature === 'number') {
        serviceData.temperature = params.temperature;
      }
    } else if (capabilityKind === 'fan_mode') {
      service = 'set_fan_mode';
      serviceData.fan_mode = String(value);
    } else if (capabilityKind === 'swing_mode') {
      service = 'set_swing_mode';
      serviceData.swing_mode = String(value);
    } else if (capabilityKind === 'swing_horizontal_mode') {
      service = 'set_swing_horizontal_mode';
      serviceData.swing_horizontal_mode = String(value);
    } else if (capabilityKind === 'press' || capabilityKind === 'button') {
      service = 'press';
    } else if (capabilityKind === 'scene' || domain === 'scene') {
      service = 'turn_on';
    } else if (
      capabilityKind === 'select' ||
      capabilityKind === 'select_option' ||
      domain === 'select'
    ) {
      service = 'select_option';
      serviceData.option =
        typeof value === 'string' ? value : String(params?.option ?? params?.value ?? '');
    } else if (capabilityKind === 'update' || capabilityKind === 'install' || domain === 'update') {
      service = 'install';
    } else if (
      capabilityKind === 'notify' ||
      capabilityKind === 'send_message' ||
      domain === 'notify'
    ) {
      service = 'send_message';
      if (typeof value === 'string') serviceData.message = value;
      if (typeof params?.message === 'string') serviceData.message = params.message;
      if (typeof params?.title === 'string') serviceData.title = params.title;
    }

    await this.sidecar.callService({ domain, service, serviceData });
  }
}
