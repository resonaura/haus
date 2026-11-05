/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { formatAddress } from '@haus/core/identity';
import {
  DeviceCategory,
  DEVICE_CATEGORIES,
  normalizeHaEntity,
  Protocol,
  type HausDevice,
  type HausEndpoint,
} from '@haus/core/device';
import type { Availability } from '@haus/core/types';
import type { HaTransport } from '../ha-client.js';
import type {
  DeviceImportDiff,
  DeviceImportItem,
  LegacyHaArea,
  LegacyHaDevice,
  LegacyHaEntityEntry,
  LegacyHaInventory,
  LegacyHaState,
} from './types.js';

export const READ_ONLY_HA_MESSAGE_TYPES = new Set<string>([
  'get_states',
  'get_config',
  'get_services',
  'auth/current_user',
  'config/area_registry/list',
  'config/device_registry/list',
  'config/entity_registry/list',
  'automation/config',
]);

const EXCLUDED_STANDALONE_DOMAINS = new Set<string>([
  'automation',
  'scene',
  'script',
  'zone',
  'sun',
  'person',
  'persistent_notification',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts any text into a valid hyphen-separated address segment [a-z0-9]+(-[a-z0-9]+)* */
export function slugifySegment(value: string, fallback: string = 'default'): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : fallback;
}

/** Formats a canonical address adhering to formatAddress: type::area:device:entity */
export function buildCanonicalAddress(params: {
  readonly type: string;
  readonly area: string;
  readonly device: string;
  readonly entity?: string;
}): string {
  const type = slugifySegment(params.type, 'generic');
  const area = slugifySegment(params.area, 'home');
  const device = slugifySegment(params.device, 'device');
  const entity = params.entity ? slugifySegment(params.entity, 'endpoint') : undefined;

  return formatAddress({
    type,
    area,
    device,
    entity,
  });
}

/** Infers communication protocol from HA connection and identifier tuples. */
export function inferProtocolFromIdentifiers(
  connections?: readonly (readonly [string, string])[],
  identifiers?: readonly (readonly [string, string])[],
): Protocol {
  const allIdentifiers = (identifiers ?? []).map((tuple) => String(tuple[0] ?? '').toLowerCase());
  const allConnections = (connections ?? []).map((tuple) => String(tuple[0] ?? '').toLowerCase());

  for (const id of allIdentifiers) {
    if (id.includes('matter')) return Protocol.Matter;
    if (id.includes('zigbee') || id.includes('zha') || id.includes('z2m')) return Protocol.Zigbee;
    if (id.includes('thread')) return Protocol.Thread;
    if (id.includes('homekit') || id.includes('hap')) return Protocol.HomeKit;
    if (id.includes('mqtt')) return Protocol.Mqtt;
    if (id.includes('virtual') || id.includes('template') || id.startsWith('input_'))
      return Protocol.Virtual;
    if (
      id.includes('shelly') ||
      id.includes('esphome') ||
      id.includes('tasmota') ||
      id.includes('tuya') ||
      id.includes('wemo') ||
      id.includes('tplink')
    ) {
      return Protocol.LocalIp;
    }
  }

  for (const conn of allConnections) {
    if (conn.includes('mac') || conn.includes('ip')) return Protocol.LocalIp;
    if (conn.includes('bluetooth') || conn.includes('ble')) return Protocol.Ble;
    if (conn.includes('zigbee')) return Protocol.Zigbee;
    if (conn.includes('thread')) return Protocol.Thread;
    if (conn.includes('matter')) return Protocol.Matter;
  }

  return Protocol.Ha;
}

/**
 * Extracts a complete snapshot of Home Assistant inventory using strictly read-only requests.
 * Never issues service calls, entity modifications, or configuration changes on the source.
 */
export async function extractReadOnlyHaInventory(
  transport: Pick<HaTransport, 'request'>,
  options?: { signal?: AbortSignal },
): Promise<LegacyHaInventory> {
  options?.signal?.throwIfAborted();

  const safeRequest = async <T>(type: string, fallback: T): Promise<T> => {
    if (!READ_ONLY_HA_MESSAGE_TYPES.has(type)) {
      throw new Error(`Unauthorized modifying request rejected: ${type}`);
    }
    options?.signal?.throwIfAborted();
    try {
      return await transport.request<T>({ type });
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      return fallback;
    }
  };

  const [rawStates, rawAreas, rawDevices, rawEntities] = await Promise.all([
    safeRequest<unknown[]>('get_states', []),
    safeRequest<unknown[]>('config/area_registry/list', []),
    safeRequest<unknown[]>('config/device_registry/list', []),
    safeRequest<unknown[]>('config/entity_registry/list', []),
  ]);

  options?.signal?.throwIfAborted();

  const states: LegacyHaState[] = (Array.isArray(rawStates) ? rawStates : [])
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) &&
        typeof item.entity_id === 'string' &&
        typeof item.state === 'string' &&
        isRecord(item.attributes),
    )
    .map((item) => ({
      entity_id: String(item.entity_id),
      state: String(item.state),
      attributes: item.attributes as Record<string, unknown>,
      last_changed: typeof item.last_changed === 'string' ? item.last_changed : undefined,
      last_updated: typeof item.last_updated === 'string' ? item.last_updated : undefined,
    }));

  const areas: LegacyHaArea[] = (Array.isArray(rawAreas) ? rawAreas : [])
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && typeof item.area_id === 'string' && typeof item.name === 'string',
    )
    .map((item) => ({
      area_id: String(item.area_id),
      name: String(item.name),
      icon: typeof item.icon === 'string' ? item.icon : undefined,
    }));

  const devices: LegacyHaDevice[] = (Array.isArray(rawDevices) ? rawDevices : [])
    .filter(
      (item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string',
    )
    .map((item) => ({
      id: String(item.id),
      name: typeof item.name === 'string' ? item.name : null,
      name_by_user: typeof item.name_by_user === 'string' ? item.name_by_user : null,
      area_id: typeof item.area_id === 'string' ? item.area_id : null,
      manufacturer: typeof item.manufacturer === 'string' ? item.manufacturer : null,
      model: typeof item.model === 'string' ? item.model : null,
      sw_version: typeof item.sw_version === 'string' ? item.sw_version : null,
      hw_version: typeof item.hw_version === 'string' ? item.hw_version : null,
      serial_number: typeof item.serial_number === 'string' ? item.serial_number : null,
      connections: Array.isArray(item.connections)
        ? (item.connections as readonly (readonly [string, string])[])
        : undefined,
      identifiers: Array.isArray(item.identifiers)
        ? (item.identifiers as readonly (readonly [string, string])[])
        : undefined,
    }));

  const entities: LegacyHaEntityEntry[] = (Array.isArray(rawEntities) ? rawEntities : [])
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && typeof item.entity_id === 'string',
    )
    .map((item) => ({
      entity_id: String(item.entity_id),
      device_id: typeof item.device_id === 'string' ? item.device_id : null,
      area_id: typeof item.area_id === 'string' ? item.area_id : null,
      name: typeof item.name === 'string' ? item.name : null,
      original_name: typeof item.original_name === 'string' ? item.original_name : null,
      platform: typeof item.platform === 'string' ? item.platform : undefined,
      unique_id: typeof item.unique_id === 'string' ? item.unique_id : undefined,
      disabled_by: typeof item.disabled_by === 'string' ? item.disabled_by : null,
    }));

  return {
    states,
    areas,
    devices,
    entities,
  };
}

function resolveDominantCategory(categories: readonly DeviceCategory[]): DeviceCategory {
  if (categories.length === 0) return DeviceCategory.Generic;
  for (const preferred of DEVICE_CATEGORIES) {
    if (categories.includes(preferred)) return preferred;
  }
  return categories[0] ?? DeviceCategory.Generic;
}

/**
 * Normalizes legacy Home Assistant inventory into Haus canonical devices, endpoints,
 * and canonical addresses (type::area:device:entity) without altering source state.
 */
export function normalizeHaInventory(
  inventory: LegacyHaInventory,
  options?: { instanceId?: string; defaultRoomId?: string },
): DeviceImportDiff {
  const instanceId = options?.instanceId ?? 'legacy-ha';
  const defaultRoom = options?.defaultRoomId ?? 'home';

  const areaMap = new Map<string, LegacyHaArea>();
  for (const area of inventory.areas) {
    areaMap.set(area.area_id, area);
  }

  const stateMap = new Map<string, LegacyHaState>();
  for (const state of inventory.states) {
    stateMap.set(state.entity_id, state);
  }

  const entityRegistryMap = new Map<string, LegacyHaEntityEntry>();
  for (const entity of inventory.entities) {
    entityRegistryMap.set(entity.entity_id, entity);
  }

  const readyToImport: DeviceImportItem[] = [];
  const unsupported: { entityId: string; reason: string }[] = [];
  const processedEntityIds = new Set<string>();

  // 1. Process devices registered in device_registry
  for (const device of inventory.devices) {
    const matchingEntries = inventory.entities.filter(
      (entry) => entry.device_id === device.id && !entry.disabled_by,
    );

    const endpoints: HausEndpoint[] = [];
    const sourceEntityIds: string[] = [];
    const canonicalAddresses: string[] = [];
    const endpointCategories: DeviceCategory[] = [];

    const areaRecord = device.area_id ? areaMap.get(device.area_id) : undefined;
    const deviceAreaSlug = areaRecord ? slugifySegment(areaRecord.name) : defaultRoom;
    const deviceName = device.name_by_user ?? device.name ?? `Device ${device.id.slice(0, 8)}`;
    const deviceSlug = slugifySegment(deviceName, `dev-${device.id.slice(0, 6)}`);

    for (const entry of matchingEntries) {
      processedEntityIds.add(entry.entity_id);
      const state = stateMap.get(entry.entity_id);
      if (!state) {
        unsupported.push({
          entityId: entry.entity_id,
          reason: 'entity_state_missing',
        });
        continue;
      }

      const normalized = normalizeHaEntity(state);
      const entityAreaRecord = entry.area_id ? areaMap.get(entry.area_id) : undefined;
      const entityAreaSlug = entityAreaRecord
        ? slugifySegment(entityAreaRecord.name)
        : deviceAreaSlug;

      const [, rawName] = entry.entity_id.split('.');
      const entityName = entry.name ?? entry.original_name ?? normalized.endpoint.name;
      const entitySlug = slugifySegment(rawName ?? entityName, 'entity');

      const address = buildCanonicalAddress({
        type: normalized.category,
        area: entityAreaSlug,
        device: deviceSlug,
        entity: entitySlug !== deviceSlug ? entitySlug : undefined,
      });

      const hausEndpoint: HausEndpoint = {
        id: entry.entity_id,
        address,
        roomId: entry.area_id ?? device.area_id ?? undefined,
        name: entityName,
        category: normalized.category,
        capabilities: normalized.endpoint.capabilities,
        readings: normalized.endpoint.readings,
      };

      endpoints.push(hausEndpoint);
      sourceEntityIds.push(entry.entity_id);
      canonicalAddresses.push(address);
      endpointCategories.push(normalized.category);
    }

    if (endpoints.length > 0) {
      const hasOnline = endpoints.some(
        (ep) =>
          ep.readings['on_off']?.freshness === 'live' ||
          ep.readings['motion']?.freshness === 'live' ||
          ep.readings['temperature']?.freshness === 'live',
      );
      const availability: Availability = hasOnline ? 'online' : 'offline';
      const dominantCategory = resolveDominantCategory(endpointCategories);
      const protocol = inferProtocolFromIdentifiers(device.connections, device.identifiers);

      const hausDevice: HausDevice = {
        id: `device_${instanceId}_${slugifySegment(device.id)}`,
        source: { instanceId, externalId: device.id },
        name: deviceName,
        category: dominantCategory,
        roomId: device.area_id ?? undefined,
        manufacturer: device.manufacturer ?? undefined,
        model: device.model ?? undefined,
        firmwareVersion: device.sw_version ?? undefined,
        hardwareVersion: device.hw_version ?? undefined,
        serialNumber: device.serial_number ?? undefined,
        connectivity: { protocol },
        availability,
        endpoints,
      };

      readyToImport.push({
        device: hausDevice,
        sourceEntityIds,
        canonicalAddresses,
      });
    }
  }

  // 2. Process standalone entities not attached to any device_registry device
  for (const state of inventory.states) {
    if (processedEntityIds.has(state.entity_id)) continue;
    const [domain, rawName] = state.entity_id.split('.');
    if (!domain || EXCLUDED_STANDALONE_DOMAINS.has(domain)) continue;

    const entry = entityRegistryMap.get(state.entity_id);
    if (entry?.disabled_by) continue;

    const normalized = normalizeHaEntity(state);
    const areaRecord = entry?.area_id ? areaMap.get(entry.area_id) : undefined;
    const areaSlug = areaRecord ? slugifySegment(areaRecord.name) : defaultRoom;

    const entityName =
      entry?.name ??
      entry?.original_name ??
      (typeof state.attributes.friendly_name === 'string'
        ? state.attributes.friendly_name
        : normalized.endpoint.name);
    const nameSlug = slugifySegment(rawName ?? entityName, 'standalone');

    const address = buildCanonicalAddress({
      type: normalized.category,
      area: areaSlug,
      device: nameSlug,
    });

    const hausEndpoint: HausEndpoint = {
      id: state.entity_id,
      address,
      roomId: entry?.area_id ?? undefined,
      name: entityName,
      category: normalized.category,
      capabilities: normalized.endpoint.capabilities,
      readings: normalized.endpoint.readings,
    };

    const isAvailable = !['unavailable', 'unknown'].includes(state.state);
    const availability: Availability = isAvailable ? 'online' : 'offline';

    const hausDevice: HausDevice = {
      id: `device_${instanceId}_${slugifySegment(state.entity_id)}`,
      source: { instanceId, externalId: state.entity_id },
      name: entityName,
      category: normalized.category,
      roomId: entry?.area_id ?? undefined,
      connectivity: {
        protocol: domain.startsWith('input_') ? Protocol.Virtual : Protocol.Ha,
      },
      availability,
      endpoints: [hausEndpoint],
    };

    readyToImport.push({
      device: hausDevice,
      sourceEntityIds: [state.entity_id],
      canonicalAddresses: [address],
    });
  }

  const importedEndpointsCount = readyToImport.reduce(
    (sum, item) => sum + item.device.endpoints.length,
    0,
  );

  return {
    readyToImport,
    unsupported,
    totalEntities: inventory.states.length,
    importedDevicesCount: readyToImport.length,
    importedEndpointsCount,
    sourceInstanceId: instanceId,
  };
}
