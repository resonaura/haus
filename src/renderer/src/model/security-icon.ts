import type { HassEntity } from './types';
export function securityIcon(state: HassEntity): string | undefined {
  const domain = state.entity_id.split('.')[0];
  const kind = String(state.attributes.device_class ?? '');
  if (!['binary_sensor', 'lock', 'alarm_control_panel'].includes(domain)) return;
  if (['unavailable', 'unknown'].includes(state.state)) return 'unknown';
  if (domain === 'lock')
    return ['unlocked', 'open', 'unlocking'].includes(state.state) ? 'unlocked' : 'locked';
  if (domain === 'alarm_control_panel')
    return state.state === 'triggered'
      ? 'alert'
      : state.state === 'disarmed'
        ? 'disarmed'
        : 'protected';
  const active = state.state === 'on';
  if (['door', 'garage_door', 'opening'].includes(kind))
    return active ? 'door-open' : 'door-closed';
  if (kind === 'window') return active ? 'window-open' : 'window-closed';
  if (kind === 'vibration') return active ? 'vibration' : 'vibration-clear';
  if (['motion', 'occupancy', 'presence'].includes(kind)) return active ? 'motion' : 'clear';
  if (kind === 'moisture') return active ? 'wet' : 'dry';
  if (kind === 'smoke') return active ? 'fire' : 'smoke';
  if (['gas', 'carbon_monoxide', 'safety', 'problem', 'tamper', 'vibration'].includes(kind))
    return active ? 'alert' : 'protected';
}
