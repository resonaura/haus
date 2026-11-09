/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  hsToRgb,
  inferDeviceCategory,
  inferEntityCategory,
  inferRoomIdFromLabels,
  sortDeviceEndpoints,
  type Capability,
  type HausDevice,
  type HausEndpoint,
} from '@haus/core';
import {
  resolveCommonDeviceName,
  resolvePhysicalDeviceId,
  sanitizeMqttId,
} from './converter.js';

export interface MqttConsolidationHost {
  listDevices(): readonly HausDevice[];
  registerDevice(device: HausDevice): HausDevice;
  removeDevice(deviceId: string): boolean;
  getEndpointState(endpointId: string): Record<string, unknown>;
  updateEndpointState(
    endpointId: string,
    patch: Record<string, unknown>,
    dispatchTriggers?: boolean,
  ): Promise<void>;
}

function extractEndpointSuffixKey(endpointId: string, rawDevId: string): string {
  const cleanEp = endpointId.replace(/^ep_(mqtt_)?/, '');
  const cleanDev = sanitizeMqttId(rawDevId);
  if (cleanEp.startsWith(`${cleanDev}_`)) {
    return cleanEp.slice(cleanDev.length + 1);
  }
  const parts = cleanEp.split('_');
  return parts[parts.length - 1] ?? cleanEp;
}

function upgradeEndpointFromStateAndSemantics(params: {
  readonly ep: HausEndpoint;
  readonly rawDevId: string;
  readonly isCameraDevice: boolean;
  readonly isApplianceDevice: boolean;
  readonly sharedState?: Record<string, unknown>;
}): {
  readonly endpoint: HausEndpoint;
  readonly statePatch?: Record<string, unknown>;
} {
  const { ep, rawDevId, isCameraDevice, isApplianceDevice, sharedState } = params;
  const suffixKey = extractEndpointSuffixKey(ep.id, rawDevId);
  const firstCap = ep.capabilities[0];
  const writable = Boolean(firstCap && firstCap.operations.length > 0);

  const entityCategory = inferEntityCategory({
    component: firstCap?.id === 'press' ? 'button' : ep.category ?? 'generic',
    id: ep.id,
    name: ep.name,
    deviceClass: firstCap?.deviceClass,
    explicitCategory: firstCap?.entityCategory,
    isCameraSubEntity: isCameraDevice,
  });

  // 1. Primary water heater / kettle endpoint
  if (
    isApplianceDevice &&
    (suffixKey === 'kettle' ||
      suffixKey === 'water_heater' ||
      firstCap?.id === 'water_heater' ||
      (firstCap?.kind === 'complex' && suffixKey === sanitizeMqttId(rawDevId)))
  ) {
    const mode = typeof sharedState?.mode === 'string' ? sharedState.mode : 'off';
    return {
      endpoint: {
        ...ep,
        category: 'appliances',
        capabilities: [
          {
            id: 'water_heater',
            kind: 'complex',
            readable: true,
            operations: ['set', 'turn_on', 'turn_off'],
            unit: '°C',
            minimum: 40,
            maximum: 99,
            step: 1,
            choices: ['off', 'electric', 'performance'],
            icon: 'mdi:kettle-steam-outline',
          },
        ],
      },
      statePatch: sharedState
        ? {
            state: mode,
            mode,
            operation_mode: mode,
            on_off: mode !== 'off',
            water_heater: mode,
            ...(typeof sharedState.current_temperature === 'number'
              ? {
                  current_temperature: sharedState.current_temperature,
                  temperature: sharedState.current_temperature,
                }
              : {}),
            ...(typeof sharedState.target_temperature === 'number'
              ? { target_temperature: sharedState.target_temperature }
              : {}),
          }
        : undefined,
    };
  }

  // 2. Shared JSON state extraction for multi-component bundled devices
  if (sharedState && suffixKey in sharedState) {
    const val = sharedState[suffixKey];
    if (typeof val === 'boolean') {
      const capId = writable
        ? 'on_off'
        : suffixKey === 'connected'
          ? 'connectivity'
          : 'binary_sensor';
      return {
        endpoint: {
          ...ep,
          category: writable ? 'power' : 'security',
          capabilities: [
            {
              id: capId,
              kind: 'binary',
              readable: true,
              operations: writable ? ['set', 'turn_on', 'turn_off'] : [],
              deviceClass: suffixKey === 'connected' ? 'connectivity' : undefined,
              entityCategory: entityCategory ?? (writable ? 'config' : 'diagnostic'),
            },
          ],
        },
        statePatch: { state: val ? 'on' : 'off', on_off: val, power: val, [capId]: val },
      };
    }

    if (typeof val === 'number') {
      const isTemp = /temp/i.test(suffixKey);
      const isHours = /_time$/i.test(suffixKey);
      const isMinutes = /remaining/i.test(suffixKey);
      if (writable) {
        return {
          endpoint: {
            ...ep,
            category: 'generic',
            capabilities: [
              {
                id: 'number',
                kind: 'numeric',
                readable: true,
                operations: ['set'],
                unit: isTemp ? '°C' : isHours ? 'h' : undefined,
                minimum: isTemp ? 40 : 1,
                maximum: isTemp ? 90 : 12,
                step: isTemp ? 1 : 0.5,
                entityCategory: 'config',
              },
            ],
          },
          statePatch: { state: val, value: val, number: val },
        };
      }
      const capId = isTemp ? 'temperature' : isMinutes ? 'duration' : 'sensor';
      return {
        endpoint: {
          ...ep,
          category: 'environmental_sensors',
          capabilities: [
            {
              id: capId,
              kind: 'numeric',
              readable: true,
              operations: [],
              unit: isTemp ? '°C' : isMinutes ? 'min' : undefined,
              deviceClass: isTemp ? 'temperature' : isMinutes ? 'duration' : undefined,
              entityCategory,
            },
          ],
        },
        statePatch: { state: val, value: val, [capId]: val },
      };
    }

    if (typeof val === 'string') {
      if (writable) {
        return {
          endpoint: {
            ...ep,
            category: 'generic',
            capabilities: [
              {
                id: 'select',
                kind: 'enum',
                readable: true,
                operations: ['set'],
                choices: /refill/i.test(suffixKey) ? ['keep_warm', 'turn_off'] : [val],
                entityCategory: 'config',
              },
            ],
          },
          statePatch: { state: val, value: val, select: val },
        };
      }
      return {
        endpoint: {
          ...ep,
          category: 'environmental_sensors',
          capabilities: [
            {
              id: 'sensor',
              kind: 'string',
              readable: true,
              operations: [],
              entityCategory,
            },
          ],
        },
        statePatch: { state: val, value: val, sensor: val },
      };
    }
  }

  // 3. Generic semantic upgrade for legacy single-entity endpoints
  if (firstCap?.id === 'state') {
    if (/(?:^|_)(?:sync_time|start_calibration|ptz_(?:up|down|left|right|stop))$/i.test(ep.id)) {
      return {
        endpoint: {
          ...ep,
          category: 'power',
          capabilities: [
            {
              id: 'press',
              kind: 'action',
              readable: false,
              operations: ['press'],
              entityCategory: entityCategory ?? 'config',
            },
          ],
        },
      };
    }
    if (
      writable &&
      /(?:^|_)(?:timezone|alarm_hour|alarm_minute|timer|alarm_duration|alarm_volume|volume)$/i.test(
        ep.id,
      )
    ) {
      const isTz = /timezone$/i.test(ep.id);
      const isHour = /hour$/i.test(ep.id);
      const isMin = /minute$|timer$/i.test(ep.id);
      return {
        endpoint: {
          ...ep,
          category: 'generic',
          capabilities: [
            {
              id: 'number',
              kind: 'numeric',
              readable: true,
              operations: ['set'],
              minimum: isTz ? -12 : 0,
              maximum: isTz ? 14 : isHour ? 23 : isMin ? 59 : 100,
              step: 1,
              entityCategory: 'config',
            },
          ],
        },
      };
    }
    if (
      writable &&
      /(?:^|_)(?:time_format|resolution|night_vision|sound_level|alarm_sound|gesture_type)$/i.test(
        ep.id,
      )
    ) {
      return {
        endpoint: {
          ...ep,
          category: 'generic',
          capabilities: [
            {
              id: 'select',
              kind: 'enum',
              readable: true,
              operations: ['set'],
              choices: /time_format$/i.test(ep.id) ? ['12h', '24h'] : [],
              entityCategory: 'config',
            },
          ],
        },
      };
    }
  }

  if (!entityCategory) return { endpoint: ep };

  const updatedCaps: Capability[] = ep.capabilities.map((cap, idx) =>
    idx === 0 ? { ...cap, entityCategory } : cap,
  );
  return { endpoint: { ...ep, capabilities: updatedCaps } };
}

/**
 * Consolidates fragmented legacy MQTT device entries into canonical physical
 * `HausDevice`s using structural ID grouping, longest-common-prefix naming,
 * and semantic capability normalization.
 */
export function consolidateLegacyMqttDevices(host: MqttConsolidationHost): number {
  const allDevices = host.listDevices();
  const knownRooms = new Set<string>(
    allDevices
      .map((d) => d.roomId)
      .filter((r): r is string => Boolean(r && r !== 'unassigned')),
  );

  const groups = new Map<string, { rawDevId: string; devices: HausDevice[] }>();

  for (const dev of allDevices) {
    if (!dev.id.startsWith('mqtt_') && dev.connectivity?.protocol !== 'mqtt') continue;
    const rawDevId = resolvePhysicalDeviceId(dev.id, {
      name: dev.name,
      model: dev.model,
      manufacturer: dev.manufacturer,
    });
    const canonicalId = `mqtt_${sanitizeMqttId(rawDevId)}`;
    const group = groups.get(canonicalId) ?? { rawDevId, devices: [] };
    group.devices.push(dev);
    groups.set(canonicalId, group);
  }

  // Merge orphan role-only groups (e.g. "mqtt_motion" named "Outdoor Camera Motion")
  // into their parent physical device group ("Outdoor Camera") when a unique prefix match exists.
  for (const [orphanId, orphanGroup] of groups.entries()) {
    if (/[0-9a-fA-F]{6,}/.test(orphanId) || orphanId.endsWith('_bridge')) continue;
    const orphanName = orphanGroup.devices[0]?.name?.trim();
    if (!orphanName) continue;
    for (const [targetId, targetGroup] of groups.entries()) {
      if (targetId === orphanId) continue;
      const targetName = targetGroup.devices[0]?.name?.trim();
      if (
        targetName &&
        orphanName.toLowerCase().startsWith(`${targetName.toLowerCase()} `)
      ) {
        targetGroup.devices.push(...orphanGroup.devices);
        groups.delete(orphanId);
        break;
      }
    }
  }

  let consolidatedCount = 0;

  for (const [canonicalId, { rawDevId, devices }] of groups.entries()) {
    const exactMatch = devices.find((d) => d.id === canonicalId);
    const allLabels = [
      ...devices.map((d) => d.name),
      ...devices.flatMap((d) => (d.endpoints ?? []).map((ep) => ep.name)),
    ];
    const resolvedName = exactMatch
      ? resolveCommonDeviceName([exactMatch.name], exactMatch.name)
      : resolveCommonDeviceName(allLabels, devices[0]!.name);

    const existingRoom = devices
      .map((d) => d.roomId)
      .find((r): r is string => Boolean(r && r !== 'unassigned'));

    const roomId = inferRoomIdFromLabels({
      existingRoomId: existingRoom,
      candidateLabels: [resolvedName, ...allLabels, rawDevId.replace(/[_-]+/g, ' ')],
      knownRoomIds: knownRooms,
    });
    if (roomId !== 'unassigned') knownRooms.add(roomId);

    const model = devices.map((d) => d.model).find(Boolean);
    const preliminaryCategory = inferDeviceCategory({
      id: rawDevId,
      name: resolvedName,
      model,
      endpoints: devices.flatMap((d) => d.endpoints ?? []),
    });
    const isCameraDevice = preliminaryCategory === 'cameras';
    const isApplianceDevice = preliminaryCategory === 'appliances';

    // Check if any endpoint in this device holds a shared multi-field JSON state
    let sharedJsonState: Record<string, unknown> | undefined;
    for (const dev of devices) {
      for (const ep of dev.endpoints ?? []) {
        const st = host.getEndpointState(ep.id);
        if (
          typeof st.current_temperature === 'number' &&
          typeof st.mode === 'string' &&
          Object.keys(st).length > 5
        ) {
          sharedJsonState = st;
          break;
        }
      }
      if (sharedJsonState) break;
    }

    const endpointMap = new Map<string, HausEndpoint>();

    for (const dev of devices) {
      for (const rawEp of dev.endpoints ?? []) {
        const ep =
          endpointMap.has(rawEp.id) && dev.id !== canonicalId
            ? { ...rawEp, id: `ep_${dev.id}` }
            : rawEp;
        const { endpoint: upgraded, statePatch } = upgradeEndpointFromStateAndSemantics({
          ep,
          rawDevId,
          isCameraDevice,
          isApplianceDevice,
          sharedState: sharedJsonState,
        });

        if (statePatch) {
          void host.updateEndpointState(upgraded.id, statePatch, false);
        }

        const epState = host.getEndpointState(upgraded.id);
        if (epState.color && typeof epState.color === 'object') {
          const c = epState.color as Record<string, unknown>;
          if (typeof c.h === 'number' && typeof c.s === 'number' && typeof c.r !== 'number') {
            void host.updateEndpointState(
              upgraded.id,
              { hs_color: [c.h, c.s], color: hsToRgb(c.h, c.s) },
              false,
            );
          }
        }

        endpointMap.set(upgraded.id, upgraded);
      }
    }

    if (isCameraDevice) {
      const hasVideoEndpoint = [...endpointMap.values()].some((ep) =>
        ep.capabilities.some((c) => c.id === 'video'),
      );
      if (!hasVideoEndpoint) {
        const camEpId = `ep_${canonicalId}_camera`;
        endpointMap.set(camEpId, {
          id: camEpId,
          name: resolvedName,
          category: 'cameras',
          capabilities: [{ id: 'video', kind: 'complex', readable: true, operations: [] }],
          readings: {},
        });
      }
    }

    const sortedEndpoints = sortDeviceEndpoints([...endpointMap.values()]);
    const category = inferDeviceCategory({
      id: rawDevId,
      name: resolvedName,
      model,
      endpoints: sortedEndpoints,
    });

    const baseDevice = exactMatch ?? devices[0]!;
    const consolidated: HausDevice = {
      ...baseDevice,
      id: canonicalId,
      source: { instanceId: 'haus-mqtt', externalId: rawDevId },
      name: resolvedName,
      category,
      roomId,
      areaId: roomId !== 'unassigned' ? roomId : undefined,
      availability: 'online',
      connectivity: { protocol: 'mqtt' },
      manufacturer: devices.map((d) => d.manufacturer).find(Boolean),
      model,
      firmwareVersion: devices.map((d) => d.firmwareVersion).find(Boolean),
      sourceRefs: [{ protocol: 'mqtt', externalId: rawDevId }],
      endpoints: sortedEndpoints,
      services: [],
    };

    host.registerDevice(consolidated);

    for (const dev of devices) {
      if (dev.id !== canonicalId) {
        host.removeDevice(dev.id);
        consolidatedCount += 1;
      }
    }
  }

  return consolidatedCount;
}
