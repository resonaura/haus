/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  CompatEntity,
  CompatView,
  EndpointStates,
  EntityBinding,
  HubCapability,
  HubDevice,
  HubEndpoint,
} from './types';

const SENSOR_CLASSES: Record<string, string> = {
  leak: 'moisture',
  contact: 'opening',
  motion: 'motion',
  vibration: 'vibration',
};

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'device'
  );
}

/** Which HA-style domain the legacy renderer should use for a Hub capability. */
export function domainFor(device: HubDevice, endpoint: HubEndpoint, cap: HubCapability): string {
  const caps = new Set(endpoint.capabilities.map((item) => item.id));
  const writable = cap.operations.some((op) => ['set', 'turn_on', 'turn_off'].includes(op));
  if (cap.id === 'on_off' && (caps.has('brightness') || caps.has('color'))) return 'light';
  if (cap.id === 'on_off') return device.category === 'lighting' ? 'light' : 'switch';
  if (cap.id in SENSOR_CLASSES) return 'binary_sensor';
  if (cap.id === 'video') return 'camera';
  if (cap.id === 'press' || cap.kind === 'action') return 'button';
  if (cap.kind === 'binary') return writable ? 'switch' : 'binary_sensor';
  if (cap.kind === 'numeric' || cap.kind === 'string') {
    if (['brightness', 'color', 'effect'].includes(cap.id) && caps.has('on_off')) return '';
    return 'sensor';
  }
  return '';
}

const truthy = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['on', 'true', 'open', 'detected', 'wet'].includes(lower)) return true;
    if (['off', 'false', 'closed', 'clear', 'dry'].includes(lower)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
};

function colorOf(value: unknown): [number, number, number] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { r, g, b } = value as Record<string, unknown>;
  return [r, g, b].every((item) => typeof item === 'number')
    ? [r as number, g as number, b as number]
    : undefined;
}

function stateFor(
  domain: string,
  cap: HubCapability,
  endpointState: Record<string, unknown> | undefined,
  device: HubDevice,
): { state: string; attributes: Record<string, unknown> } {
  const attributes: Record<string, unknown> = {};
  if (device.availability === 'offline') return { state: 'unavailable', attributes };
  if (!endpointState) return { state: 'unknown', attributes };
  const raw = endpointState[cap.id] ?? endpointState.state ?? endpointState.value;
  if (domain === 'light') {
    const on = truthy(endpointState.on_off ?? endpointState.state);
    const rgb = colorOf(endpointState.color);
    if (typeof endpointState.brightness === 'number')
      attributes.brightness = Math.round(endpointState.brightness);
    if (rgb) {
      attributes.rgb_color = rgb;
      attributes.color_mode = 'rgb';
    }
    return { state: on === undefined ? 'unknown' : on ? 'on' : 'off', attributes };
  }
  if (domain === 'switch' || domain === 'binary_sensor') {
    const on = truthy(raw);
    if (SENSOR_CLASSES[cap.id]) attributes.device_class = SENSOR_CLASSES[cap.id];
    return { state: on === undefined ? 'unknown' : on ? 'on' : 'off', attributes };
  }
  if (domain === 'sensor') {
    if (typeof endpointState.unit === 'string') attributes.unit_of_measurement = endpointState.unit;
    return { state: raw === undefined || raw === null ? 'unknown' : String(raw), attributes };
  }
  return { state: domain === 'camera' ? 'idle' : 'unknown', attributes };
}

/** Builds the HA-shaped snapshot the legacy renderer consumes from Hub devices and states. */
export function buildView(
  devices: HubDevice[],
  states: EndpointStates,
  now = new Date().toISOString(),
): CompatView {
  const used = new Set<string>();
  const bindings = new Map<string, EntityBinding>();
  const entities: Record<string, unknown>[] = [];
  const entityStates: CompatEntity[] = [];
  const rooms = new Set<string>();
  for (const device of devices) {
    for (const endpoint of device.endpoints) {
      for (const cap of endpoint.capabilities) {
        const domain = domainFor(device, endpoint, cap);
        if (!domain) continue;
        let id = `${domain}.${slug(device.id)}`;
        for (let n = 2; used.has(id); n += 1) id = `${domain}.${slug(device.id)}_${n}`;
        used.add(id);
        bindings.set(id, { deviceId: device.id, endpointId: endpoint.id, capability: cap, domain });
        const { state, attributes } = stateFor(domain, cap, states[endpoint.id], device);
        const modes = endpoint.capabilities.map((item) => item.id);
        entityStates.push({
          entity_id: id,
          state,
          attributes: {
            friendly_name: device.name,
            ...(domain === 'light'
              ? {
                  supported_color_modes: modes.includes('color')
                    ? ['rgb']
                    : modes.includes('brightness')
                      ? ['brightness']
                      : ['onoff'],
                }
              : {}),
            ...attributes,
          },
          last_changed: now,
          last_updated: now,
        });
        entities.push({
          entity_id: id,
          device_id: device.id,
          area_id: null,
          name: null,
          original_name: device.name,
          platform: 'haus',
          unique_id: `${endpoint.id}:${cap.id}`,
        });
      }
    }
    if (device.roomId && device.roomId !== 'unassigned') rooms.add(device.roomId);
  }
  return {
    states: entityStates,
    bindings,
    entities,
    devices: devices.map((device) => ({
      id: device.id,
      name: device.name,
      name_by_user: null,
      area_id: device.roomId && device.roomId !== 'unassigned' ? device.roomId : null,
      manufacturer: device.manufacturer ?? null,
      model: device.model ?? null,
    })),
    areas: [...rooms].map((room) => ({
      area_id: room,
      name: room.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    })),
  };
}
