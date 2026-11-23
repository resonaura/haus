/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity } from './types';
export function securityIcon(state: HassEntity): string | undefined {
  const domain = state.entity_id.split('.')[0];
  const kind = String(state.attributes.device_class ?? '');
  if (!['binary_sensor', 'lock', 'alarm_control_panel'].includes(domain)) return;
  const unavailable = ['unavailable', 'unknown'].includes(state.state);
  if (domain === 'lock')
    return !unavailable && ['unlocked', 'open', 'unlocking'].includes(state.state)
      ? 'unlocked'
      : 'locked';
  if (domain === 'alarm_control_panel')
    return unavailable
      ? 'protected'
      : state.state === 'triggered'
        ? 'alert'
        : state.state === 'disarmed'
          ? 'disarmed'
          : 'protected';
  const active = !unavailable && state.state === 'on';
  if (['door', 'garage_door', 'opening'].includes(kind))
    return active ? 'door-open' : 'door-closed';
  if (kind === 'window') return active ? 'window-open' : 'window-closed';
  if (kind === 'vibration') return active ? 'vibration' : 'vibration-clear';
  if (['motion', 'occupancy', 'presence'].includes(kind)) return active ? 'motion' : 'clear';
  if (kind === 'moisture') return active ? 'wet' : 'dry';
  if (kind === 'smoke') return active ? 'fire' : 'smoke';
  if (['gas', 'carbon_monoxide', 'safety', 'problem', 'tamper'].includes(kind))
    return active ? 'alert' : 'protected';
}
