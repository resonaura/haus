/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import { formatAddress, slugifySegment } from '@haus/core/identity';
import {
  normalizeDeviceEndpointsForHap,
  type HausDevice,
  type HausEndpoint,
  type SystemIssue,
  type ActionableNotification,
} from '@haus/core/device';
import { PythonSidecarHarness } from './sidecar.js';
import { availabilityFor, categoryForEndpoints } from './classification.js';
import { buildHacsServiceCall, HACS_CAPABILITY_ALIASES } from './commands.js';
import type {
  HacsBleAdvertisementPayload,
  HacsEntityPayload,
  HacsEntityUpdatePayload,
  HacsIntegrationConfig,
  HacsServiceCallPayload,
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
  private rawEndpointNames = new Map<string, string>();
  private deviceNameFromEntity = new Set<string>();
  private unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] = [];

  constructor(
    sidecar?: PythonSidecarHarness,
    private readonly invokeService?: (payload: HacsServiceCallPayload) => Promise<void>,
  ) {
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

  handleEntityAdded(payload: HacsEntityPayload): void {
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
    const capabilities = mapDomainToCapabilities(payload.domain, payload).map((capability) => ({
      ...capability,
      ...(payload.entityCategory === 'config' || payload.entityCategory === 'diagnostic'
        ? { entityCategory: payload.entityCategory }
        : {}),
    }));
    const readings = parseReadings(payload.domain, payload.state, payload.attributes);

    const existingDevice = this.devices.get(deviceId);
    const endpoints: HausEndpoint[] = existingDevice
      ? existingDevice.endpoints.map((ep) => ({
          ...ep,
          name: this.rawEndpointNames.get(ep.id) ?? ep.name,
        }))
      : [];

    this.rawEndpointNames.set(endpointId, payload.name);

    const endpoint: HausEndpoint = {
      id: endpointId,
      address: formatAddress({
        type: slugifySegment(category),
        area: slugifySegment(payload.areaId ?? 'default'),
        device: slugifySegment(deviceId),
        entity: slugifySegment(endpointId),
      }),
      name: payload.name,
      category,
      availability: availabilityFor(payload.state, payload.domain),
      capabilities,
      readings,
      ...(isHomeAssistantEntityIdentity(payload)
        ? {
            sourceRefs: [
              // Preserve HA's platform-scoped identity when config-entry IDs change.
              {
                protocol: 'vendor',
                externalId: payload.uniqueId,
                domain: 'ha_entity',
                entityId: payload.entityId,
                metadata: {
                  platform: payload.integration,
                  entityDomain: payload.domain,
                },
              },
            ],
          }
        : {}),
    };

    const existingIdx = endpoints.findIndex((ep) => ep.id === endpointId);
    if (existingIdx >= 0) {
      endpoints[existingIdx] = endpoint;
    } else {
      endpoints.push(endpoint);
    }

    const explicitDeviceName = payload.deviceName?.trim() || undefined;
    let resolvedDeviceName: string;
    if (explicitDeviceName) {
      const wasEntityFallback = this.deviceNameFromEntity.delete(deviceId);
      resolvedDeviceName =
        existingDevice && !wasEntityFallback ? existingDevice.name : explicitDeviceName;
    } else if (existingDevice) {
      resolvedDeviceName = existingDevice.name;
    } else {
      this.deviceNameFromEntity.add(deviceId);
      resolvedDeviceName = payload.name;
    }

    const deviceCategory = categoryForEndpoints(endpoints, payload.deviceEntryType, {
      integration: payload.integration,
      manufacturer: payload.manufacturer,
      model: payload.model,
    });
    const normalizedEndpoints = normalizeDeviceEndpointsForHap({
      name: resolvedDeviceName,
      category: deviceCategory,
      endpoints,
    });

    const device: HausDevice = {
      id: deviceId,
      source: { instanceId: 'hacs', externalId: deviceId },
      name: resolvedDeviceName,
      category: deviceCategory,
      availability: availabilityFor(payload.state, payload.domain),
      connectivity: {
        protocol: 'virtual',
      },
      sourceRefs: [{ protocol: 'virtual', externalId: deviceId }],
      endpoints: normalizedEndpoints,
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

    const newAvailability = availabilityFor(payload.state, domain);
    const updatedEndpoints = existingDevice.endpoints.map((ep) => {
      if (ep.id !== mapping.endpointId) return ep;
      return {
        ...ep,
        availability: newAvailability,
        ...(payload.attributes
          ? {
              capabilities: mapDomainToCapabilities(domain, {
                domain,
                state: payload.state,
                attributes: payload.attributes,
              }),
            }
          : {}),
        readings: updatedReadings,
      };
    });

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
    const operation = isCommandObj ? deviceIdOrCmd.operation : undefined;
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
      const validNames = new Set(HACS_CAPABILITY_ALIASES[capabilityKind] ?? [capabilityKind]);
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

    const { service, serviceData } = buildHacsServiceCall({
      domain,
      endpointId,
      capabilityKind,
      value,
      operation,
      params,
    });

    if (this.invokeService) await this.invokeService({ domain, service, serviceData });
    else await this.sidecar.callService({ domain, service, serviceData });
  }
}

function isHomeAssistantEntityIdentity(
  payload: HacsEntityPayload,
): payload is HacsEntityPayload & { integration: string; uniqueId: string } {
  return Boolean(
    payload.integration &&
    /^[a-z0-9_]{1,128}$/.test(payload.integration) &&
    payload.uniqueId &&
    payload.uniqueId.length <= 1024 &&
    !containsControlCharacters(payload.uniqueId) &&
    /^[a-z0-9_]+$/.test(payload.domain) &&
    /^[a-z_]+\.[a-z0-9_]+$/.test(payload.entityId) &&
    payload.entityId.startsWith(`${payload.domain}.`),
  );
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 0x20 || (code >= 0x7f && code <= 0x9f))) return true;
  }
  return false;
}
