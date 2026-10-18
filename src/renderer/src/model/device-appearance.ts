import type { HassEntity } from './types';
import { lightColor } from './light-color';

const activeStates = new Set([
  'on',
  'playing',
  'buffering',
  'open',
  'opening',
  'closing',
  'unlocked',
  'heat',
  'cool',
  'heating',
  'cooling',
  'heat_cool',
  'dry',
  'fan_only',
  'armed_away',
  'armed_home',
  'armed_night',
  'armed_vacation',
  'triggered',
  'pending',
  'cleaning',
  'returning',
  'printing',
  'processing',
  'busy',
  'online',
  'connected',
  'home',
]);
const openingClasses = new Set(['door', 'window', 'opening', 'garage_door']);

export function isEntityActive(entity: HassEntity): boolean {
  return activeStates.has(entity.state.toLowerCase());
}

/** Light output keeps its color; other active devices share a neutral highlight. */
export function deviceAppearance(entity: HassEntity) {
  const active = isEntityActive(entity);
  const domain = entity.entity_id.split('.')[0];
  const actualColor = active ? lightColor(entity) : undefined;
  const accent = domain === 'light' ? 'var(--cat-lights)' : 'var(--device-neutral)';
  return { active, accent: actualColor ?? accent, actualColor };
}

export function binaryStateDescription(entity: HassEntity): string | undefined {
  if (!entity.entity_id.startsWith('binary_sensor.') || !['on', 'off'].includes(entity.state))
    return undefined;
  const on = entity.state === 'on';
  const cls = String(entity.attributes.device_class ?? '');
  if (openingClasses.has(cls)) return on ? 'Open' : 'Closed';
  if (['motion', 'occupancy', 'presence'].includes(cls)) return on ? 'Detected' : 'Clear';
  if (cls === 'moisture') return on ? 'Leak detected' : 'Dry';
  if (['smoke', 'gas', 'carbon_monoxide'].includes(cls)) return on ? 'Detected' : 'Clear';
  if (cls === 'connectivity') return on ? 'Connected' : 'Disconnected';
  if (cls === 'running') return on ? 'Running' : 'Stopped';
  if (cls === 'plug') return on ? 'Plugged in' : 'Unplugged';
  if (cls === 'battery_charging') return on ? 'Charging' : 'Not charging';
  return undefined;
}
