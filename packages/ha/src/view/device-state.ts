/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { lightColor } from '../light-color.js';
import { lightActiveEffectOption, type LightEffectOption } from '../light-profile.js';
import type { HassEntity } from './types.js';

export interface DeviceAppearance {
  readonly active: boolean;
  readonly isLight: boolean;
  readonly actualColor: string | undefined;
  readonly effect?: LightEffectOption;
}

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

/** Light output keeps its color or active effect palette; other active devices share a neutral highlight. */
export function resolveDeviceAppearance(entity: HassEntity): DeviceAppearance {
  const active = isEntityActive(entity);
  const isLight = entity.entity_id.split('.')[0] === 'light';
  const effect = active && isLight ? lightActiveEffectOption(entity) : undefined;
  const actualColor = active ? (effect?.palette[0] ?? lightColor(entity)) : undefined;
  return {
    active,
    isLight,
    actualColor,
    ...(effect ? { effect } : {}),
  };
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

export function securityIcon(state: HassEntity): string | undefined {
  const domain = state.entity_id.split('.')[0];
  const kind = String(state.attributes.device_class ?? '');
  if (!['binary_sensor', 'lock', 'alarm_control_panel'].includes(domain)) return undefined;
  const unavailable = ['unavailable', 'unknown'].includes(state.state);
  if (domain === 'lock') {
    return !unavailable && ['unlocked', 'open', 'unlocking'].includes(state.state)
      ? 'unlocked'
      : 'locked';
  }
  if (domain === 'alarm_control_panel') {
    return unavailable
      ? 'protected'
      : state.state === 'triggered'
        ? 'alert'
        : state.state === 'disarmed'
          ? 'disarmed'
          : 'protected';
  }
  const active = !unavailable && state.state === 'on';
  if (['door', 'garage_door', 'opening'].includes(kind))
    return active ? 'door-open' : 'door-closed';
  if (kind === 'window') return active ? 'window-open' : 'window-closed';
  if (kind === 'vibration') return active ? 'vibration' : 'vibration-clear';
  if (['motion', 'occupancy', 'presence'].includes(kind)) return active ? 'motion' : 'clear';
  if (kind === 'moisture') return active ? 'wet' : 'dry';
  if (kind === 'smoke') return active ? 'fire' : 'smoke';
  if (['gas', 'carbon_monoxide', 'safety', 'problem', 'tamper'].includes(kind)) {
    return active ? 'alert' : 'protected';
  }
  return undefined;
}
