/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { securityIcon } from '@haus/ha/view/device-state';
import type { HausAccessory } from '@haus/ha/view/types';
import { DEVICE_ICONS, type UiIconName } from '@haus/ui/components';

const SECURITY_ICONS: Readonly<Record<string, UiIconName>> = {
  'door-open': 'door-open',
  'door-closed': 'door-closed',
  locked: 'lock-keyhole',
  unlocked: 'lock-keyhole-open',
  motion: 'radar',
  clear: 'radar',
  vibration: 'vibrate',
  'vibration-clear': 'vibrate',
  wet: 'droplets',
  dry: 'droplet-off',
  smoke: 'alarm-smoke',
  fire: 'flame',
  alert: 'shield-alert',
  protected: 'shield-check',
  disarmed: 'shield-off',
  unknown: 'circle-help',
};

function networkIcon(deviceType?: string): UiIconName {
  switch (deviceType) {
    case 'network_switch':
    case 'bridge':
      return 'network';
    case 'repeater':
      return 'wifi';
    case 'access_point':
      return 'radio';
    case 'modem':
      return 'globe';
    case 'firewall':
      return 'shield';
    case 'nas':
      return 'hard-drive';
    default:
      return 'router';
  }
}

export function resolveAccessoryIconName(accessory: HausAccessory): UiIconName {
  const domain = accessory.primaryEntityId.split('.')[0];
  let icon: UiIconName = DEVICE_ICONS[accessory.category] ?? 'circle-help';
  if (accessory.category === 'network' && accessory.deviceType) {
    icon = networkIcon(accessory.deviceType);
  }
  if (accessory.powerStrip) icon = 'circuit-board';
  if (accessory.buttonController) icon = 'toggle-left';
  if (accessory.physicalHub) icon = 'radio';
  if (domain === 'camera') icon = 'camera';
  if (domain === 'media_player' && accessory.state.attributes.device_class === 'tv') icon = 'tv';
  if (domain === 'fan') icon = 'wind';
  if (
    (accessory.category === 'lights' || accessory.category === 'outlets') &&
    accessory.name.toLowerCase().includes('lamp')
  ) {
    icon = 'lamp';
  }
  if (accessory.state.attributes.device_class === 'battery') icon = 'battery-medium';
  const sec = securityIcon(accessory.state);
  if (sec && SECURITY_ICONS[sec]) {
    return SECURITY_ICONS[sec];
  }
  return icon;
}
