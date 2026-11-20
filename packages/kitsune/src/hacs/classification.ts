/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { DeviceCategory, HausEndpoint } from '@haus/core/device';
import type { Availability, Capability } from '@haus/core/types';
import { contactCapability, motionCapability } from '@haus/core/device';

const priorities: readonly (DeviceCategory | 'outlet')[] = [
  'cameras',
  'media',
  'climate',
  'covers',
  'outlet',
  'lighting',
  'power',
  'safety_sensors',
  'security',
  'occupancy_sensors',
  'network',
  'environmental_sensors',
];

export function categoryForEndpoints(
  endpoints: readonly HausEndpoint[],
  deviceEntryType?: 'service' | null,
): DeviceCategory {
  let category: DeviceCategory = 'generic';
  let best = Infinity;
  for (const endpoint of endpoints) {
    if (
      !endpoint.category ||
      !endpoint.capabilities.some((capability) => !capability.entityCategory)
    )
      continue;
    if (deviceEntryType === 'service' && ['power', 'lighting'].includes(endpoint.category))
      continue;
    const role =
      endpoint.category === 'power' &&
      endpoint.capabilities.some((cap) => cap.deviceClass === 'outlet')
        ? 'outlet'
        : endpoint.category;
    const priority = priorities.findIndex((item) => item === role);
    if (priority < 0 || priority >= best) continue;
    category = endpoint.category;
    best = priority;
  }
  return category;
}

export function binarySensorId(deviceClass: unknown): string {
  if (['door', 'window', 'opening'].includes(String(deviceClass))) return 'contact';
  return typeof deviceClass === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(deviceClass)
    ? deviceClass
    : 'binary_state';
}

export function binarySensorCapability(deviceClass: unknown): Capability {
  const id = binarySensorId(deviceClass);
  const metadata = { deviceClass: typeof deviceClass === 'string' ? deviceClass : undefined };
  if (id === 'contact') return { ...contactCapability, ...metadata };
  if (id === 'motion') return { ...motionCapability, ...metadata };
  return { id, kind: 'binary', readable: true, operations: [], ...metadata };
}

export function availabilityFor(state: unknown, domain?: string): Availability {
  if (state === 'unavailable') return 'offline';
  if (
    state === 'unknown' &&
    domain !== undefined &&
    ['notify', 'event', 'button', 'scene'].includes(domain)
  ) {
    return 'online';
  }
  return state === 'unknown' || state == null ? 'unknown' : 'online';
}
