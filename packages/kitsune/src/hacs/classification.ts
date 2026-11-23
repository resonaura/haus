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
  'network',
  'occupancy_sensors',
  'environmental_sensors',
];

const NETWORK_INTEGRATIONS = new Set([
  'eero',
  'unifi',
  'asuswrt',
  'fritz',
  'upnp',
  'mikrotik',
  'opnsense',
  'pfsense',
  'tplink_omada',
  'linksys_smart',
]);

const NETWORK_MODEL_RE =
  /\b(?:eero|network|router|gateway|mesh|access\s*point|repeater|unifi|mikrotik)\b/i;

export interface DeviceClassificationContext {
  readonly integration?: string;
  readonly manufacturer?: string;
  readonly model?: string;
}

export function categoryForEndpoints(
  endpoints: readonly HausEndpoint[],
  deviceEntryType?: 'service' | null,
  context?: DeviceClassificationContext,
): DeviceCategory {
  if (context?.integration && NETWORK_INTEGRATIONS.has(context.integration.toLowerCase())) {
    return 'network';
  }
  const resolvePass = (allowSecondary: boolean): DeviceCategory => {
    let category: DeviceCategory = 'generic';
    let best = Infinity;
    for (const endpoint of endpoints) {
      if (!endpoint.category) continue;
      if (
        !allowSecondary &&
        !endpoint.capabilities.some((capability) => !capability.entityCategory)
      ) {
        continue;
      }
      if (deviceEntryType === 'service' && ['power', 'lighting'].includes(endpoint.category)) {
        continue;
      }
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
  };

  const primary = resolvePass(false);
  if (primary !== 'generic') return primary;
  const fallback = resolvePass(true);
  if (fallback !== 'generic') return fallback;
  const hint = `${context?.manufacturer ?? ''} ${context?.model ?? ''}`.trim();
  if (hint && NETWORK_MODEL_RE.test(hint)) return 'network';
  return 'generic';
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
    ['notify', 'event', 'button', 'input_button', 'scene'].includes(domain)
  ) {
    return 'online';
  }
  return state === 'unknown' || state == null ? 'unknown' : 'online';
}
