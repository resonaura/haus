/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Capability, Reading } from '../types.js';
import { DeviceCategory, isDeviceCategory } from './category.js';
import { Protocol } from './enums.js';
import {
  buildHaDeviceKey,
  buildHaEntityKey,
  type HausCharacteristic,
  type HausService,
  type HausValue,
  type SourceDeviceRef,
} from './graph.js';
import type { HausDevice, HausEndpoint } from './types.js';

export interface HaDeviceEntry {
  readonly id: string;
  readonly name?: string;
  readonly name_by_user?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly sw_version?: string;
  readonly hw_version?: string;
  readonly serial_number?: string;
  readonly area_id?: string;
  readonly connections?: readonly (readonly [string, string])[];
  readonly identifiers?: readonly (readonly [string, string])[];
}

export interface HaEntityEntry {
  readonly entity_id: string;
  readonly device_id?: string;
  readonly area_id?: string;
  readonly name?: string;
  readonly original_name?: string;
  readonly disabled_by?: string;
}

export interface HaStateRecord {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Record<string, unknown>;
  readonly last_updated?: string;
}

export function endpointToServices(endpoint: HausEndpoint): readonly HausService[] {
  const characteristics: HausCharacteristic[] = [];
  const now = new Date().toISOString();

  for (const [key, reading] of Object.entries(endpoint.readings)) {
    const isWritable = endpoint.capabilities.some((c) => c.kind === key && c.operations.length > 0);
    characteristics.push({
      id: `${endpoint.id}_${key}`,
      stableKey: `${endpoint.id}:${key}`,
      type: key,
      value: reading.value as HausValue,
      readable: true,
      writable: isWritable,
      notifiable: true,
      sourceRefs: [{ protocol: 'virtual', externalId: `${endpoint.id}:${key}` }],
      metadata: {
        freshness: reading.freshness,
        observedAt: reading.observedAt ?? now,
      },
    });
  }

  return [
    {
      id: `service_${endpoint.id}`,
      stableKey: endpoint.address ?? endpoint.id,
      type: endpoint.category ?? 'generic',
      name: endpoint.name,
      characteristics,
      linkedServiceIds: [],
      sourceRefs: endpoint.sourceRefs?.length
        ? endpoint.sourceRefs
        : [{ protocol: 'virtual', externalId: endpoint.id }],
      sourceOwner: endpoint.sourceOwner,
      mediaId: endpoint.mediaId,
      opaqueMetadata: { address: endpoint.address },
    },
  ];
}

export function servicesToEndpoints(
  deviceId: string,
  services: readonly HausService[],
): readonly HausEndpoint[] {
  return services.map((service, index) => {
    const readings: Record<string, Reading> = {};
    const capabilities: Capability[] = [];

    for (const char of service.characteristics) {
      readings[char.type] = {
        value: char.value as Reading['value'],
        freshness: 'live',
        observedAt: new Date().toISOString(),
      };
      capabilities.push({
        id: char.type,
        kind: char.type,
        readable: char.readable,
        operations: char.writable ? ['set'] : [],
        unit: char.unit,
        minimum: char.min,
        maximum: char.max,
        step: char.step,
      });
    }

    const category = isDeviceCategory(service.type) ? service.type : DeviceCategory.Generic;

    return {
      id: `${deviceId}_ep_${index}`,
      address: `generic::home:${deviceId}:ep-${index}`,
      name: service.name ?? service.type,
      category,
      capabilities,
      readings,
      sourceRefs: service.sourceRefs,
      sourceOwner: service.sourceOwner,
      mediaId: service.mediaId,
    };
  });
}

export function groupHaEntitiesToDevices(params: {
  readonly states: readonly HaStateRecord[];
  readonly deviceEntries?: readonly HaDeviceEntry[];
  readonly entityEntries?: readonly HaEntityEntry[];
  readonly configEntryId?: string;
}): readonly HausDevice[] {
  const { states, deviceEntries = [], entityEntries = [], configEntryId } = params;

  const entityMap = new Map<string, HaEntityEntry>();
  for (const ent of entityEntries) entityMap.set(ent.entity_id, ent);

  const deviceMap = new Map<string, HaDeviceEntry>();
  for (const dev of deviceEntries) deviceMap.set(dev.id, dev);

  const entitiesByDeviceId = new Map<string, HaStateRecord[]>();
  const processedEntityIds = new Set<string>();

  for (const state of states) {
    const entityEntry = entityMap.get(state.entity_id);
    if (entityEntry?.device_id && deviceMap.has(entityEntry.device_id)) {
      const devId = entityEntry.device_id;
      const list = entitiesByDeviceId.get(devId) ?? [];
      list.push(state);
      entitiesByDeviceId.set(devId, list);
      processedEntityIds.add(state.entity_id);
    }
  }

  const result: HausDevice[] = [];

  for (const [deviceId, devStates] of entitiesByDeviceId.entries()) {
    const dev = deviceMap.get(deviceId)!;
    const stableKey = buildHaDeviceKey(configEntryId, deviceId);
    const id = `ha_device_${dev.id}`;
    const name = dev.name_by_user ?? dev.name ?? `HA Device ${dev.id.slice(0, 8)}`;

    const services: HausService[] = [];
    const sourceRefs: SourceDeviceRef[] = [
      {
        protocol: 'home-assistant',
        externalId: deviceId,
        configEntryId,
        deviceId,
      },
    ];

    for (const state of devStates) {
      services.push(mapHaStateToService(state));
    }

    result.push({
      id,
      source: { instanceId: configEntryId ?? 'ha', externalId: dev.id },
      stableKey,
      name,
      category: DeviceCategory.Generic,
      manufacturer: dev.manufacturer,
      model: dev.model,
      firmwareVersion: dev.sw_version,
      hardwareVersion: dev.hw_version,
      serialNumber: dev.serial_number,
      roomId: dev.area_id,
      areaId: dev.area_id,
      connectivity: { protocol: Protocol.Ha },
      availability: 'online',
      endpoints: servicesToEndpoints(id, services),
      sourceRefs,
      services,
      relationships: [],
      diagnostics: {},
      opaqueMetadata: { haDeviceId: dev.id, configEntryId },
    });
  }

  for (const state of states) {
    if (processedEntityIds.has(state.entity_id)) continue;

    const entityEntry = entityMap.get(state.entity_id);
    const stableKey = buildHaEntityKey(entityEntry?.entity_id ?? state.entity_id);
    const id = `ha_entity_${state.entity_id.replace(/\./g, '_')}`;
    const name = entityEntry?.name ?? entityEntry?.original_name ?? state.entity_id;

    const service = mapHaStateToService(state);

    result.push({
      id,
      source: { instanceId: configEntryId ?? 'ha', externalId: state.entity_id },
      stableKey,
      name,
      category: DeviceCategory.Generic,
      connectivity: { protocol: Protocol.Ha },
      availability: state.state === 'unavailable' ? 'offline' : 'online',
      endpoints: servicesToEndpoints(id, [service]),
      sourceRefs: [
        {
          protocol: 'home-assistant',
          externalId: state.entity_id,
          configEntryId,
        },
      ],
      services: [service],
      relationships: [],
      diagnostics: {},
      opaqueMetadata: { entityId: state.entity_id },
    });
  }

  return result;
}

function mapHaStateToService(state: HaStateRecord): HausService {
  const [domain] = state.entity_id.split('.');
  const characteristics: HausCharacteristic[] = [];

  const mainChar: HausCharacteristic = {
    id: `${state.entity_id}_state`,
    stableKey: `${state.entity_id}:state`,
    type: `${domain}.state`,
    value: state.state,
    readable: true,
    writable: domain === 'switch' || domain === 'light' || domain === 'lock',
    notifiable: true,
    sourceRefs: [
      {
        protocol: 'home-assistant',
        externalId: `${state.entity_id}:state`,
        entityId: state.entity_id,
      },
    ],
    metadata: {},
  };
  characteristics.push(mainChar);

  for (const [key, val] of Object.entries(state.attributes)) {
    if (val === null || val === undefined) continue;
    characteristics.push({
      id: `${state.entity_id}_attr_${key}`,
      stableKey: `${state.entity_id}:attr:${key}`,
      type: `attribute.${key}`,
      value: val as HausValue,
      readable: true,
      writable: false,
      notifiable: true,
      sourceRefs: [
        {
          protocol: 'home-assistant',
          externalId: `${state.entity_id}:attr:${key}`,
          entityId: state.entity_id,
          attributeKey: key,
        },
      ],
      metadata: { rawAttributeKey: key },
    });
  }

  return {
    id: `service_${state.entity_id.replace(/\./g, '_')}`,
    stableKey: `ha:service:${state.entity_id}`,
    type: domain,
    name: state.entity_id,
    characteristics,
    linkedServiceIds: [],
    sourceRefs: [
      {
        protocol: 'home-assistant',
        externalId: state.entity_id,
        entityId: state.entity_id,
        domain,
      },
    ],
    opaqueMetadata: state.attributes,
  };
}
