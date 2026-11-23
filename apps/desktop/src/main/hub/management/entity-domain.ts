/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isMediaCapability } from '../media';
import { NUMERIC_SENSOR_CLASSES, SENSOR_CLASSES } from '../sensor-classes';
import type { HubCapability, HubDevice, HubEndpoint } from '../types';

/** Which HA-style domain the legacy renderer should use for a Hub capability. */
export function domainFor(device: HubDevice, endpoint: HubEndpoint, cap: HubCapability): string {
  if (endpoint.haIdentity?.domain === 'binary_sensor') return 'binary_sensor';
  const caps = new Set(endpoint.capabilities.map((item) => item.id));
  const writable = cap.operations.some((op) =>
    ['set', 'turn_on', 'turn_off', 'press'].includes(op),
  );

  if (cap.id === 'climate') return 'climate';
  if (
    (cap.id === 'hvac_mode' || cap.id === 'target_temperature') &&
    device.category === 'climate'
  ) {
    return caps.has('climate') ? '' : 'climate';
  }
  if (
    ['fan_mode', 'swing_mode', 'swing_horizontal_mode', 'current_temperature'].includes(cap.id) &&
    device.category === 'climate'
  ) {
    return '';
  }
  if (
    cap.id === 'water_heater' ||
    (cap.id === 'target_temperature' && device.category === 'appliances')
  ) {
    return 'water_heater';
  }
  if (
    ['position', 'tilt', 'cover'].includes(cap.id) &&
    (writable || device.category === 'covers')
  ) {
    return 'cover';
  }
  if (cap.id === 'lock' || cap.id === 'lock_state') return 'lock';
  if (cap.id === 'fan' || cap.id === 'fan_speed') return 'fan';
  if (cap.id === 'remote' || cap.id === 'remote_key') return 'remote';
  if (isMediaCapability(device, endpoint, cap)) return 'media_player';
  if (cap.id === 'number') return 'number';
  if (cap.kind === 'enum' && cap.deviceClass === 'enum') return 'sensor';
  if (cap.id === 'select' || cap.kind === 'enum') return 'select';
  if (cap.id === 'scene' || (cap.kind === 'action' && endpoint.id.startsWith('scene.')))
    return 'scene';
  if (cap.id === 'device_tracker' || endpoint.id.startsWith('device_tracker.'))
    return 'device_tracker';
  if (cap.id === 'update' || cap.kind === 'update') return 'update';
  if (cap.id === 'image' || endpoint.id.startsWith('image.')) return 'image';
  if (cap.id === 'event' || cap.kind === 'event') return 'event';
  if (cap.id === 'weather' || cap.kind === 'weather') return 'weather';
  if (cap.id === 'notify' || endpoint.id.startsWith('notify.')) return 'notify';
  if (
    cap.id in NUMERIC_SENSOR_CLASSES ||
    (cap.deviceClass !== undefined && cap.deviceClass in NUMERIC_SENSOR_CLASSES)
  )
    return 'sensor';
  if (cap.id === 'on_off' && endpoint.haIdentity?.domain === 'switch') return 'switch';
  if (
    cap.id === 'on_off' &&
    (caps.has('brightness') || caps.has('color') || caps.has('color_temp'))
  )
    return 'light';
  if (cap.id === 'on_off') return device.category === 'lighting' ? 'light' : 'switch';
  if (cap.id in SENSOR_CLASSES) return 'binary_sensor';
  if (cap.id === 'video') return 'camera';
  if (cap.id === 'press' || cap.kind === 'action') return 'button';
  if (cap.kind === 'binary') return writable ? 'switch' : 'binary_sensor';
  if (cap.kind === 'numeric' || cap.kind === 'string') {
    if (['brightness', 'color', 'color_temp', 'effect'].includes(cap.id) && caps.has('on_off'))
      return '';
    return 'sensor';
  }
  return '';
}
