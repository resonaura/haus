/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { TransportAreaEntry, TransportDeviceEntry } from './contract.js';

export interface RoomIconOption {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

export const ROOM_ICON_OPTIONS: readonly RoomIconOption[] = [
  { id: 'auto', label: 'Automatic', icon: 'layout-grid' },
  { id: 'home', label: 'Home', icon: 'house' },
  { id: 'living', label: 'Living room', icon: 'armchair' },
  { id: 'bedroom', label: 'Bedroom', icon: 'bed-double' },
  { id: 'kitchen', label: 'Kitchen', icon: 'utensils' },
  { id: 'outdoor', label: 'Outdoors', icon: 'trees' },
  { id: 'hallway', label: 'Hallway', icon: 'door-open' },
  { id: 'security', label: 'Security', icon: 'shield-check' },
  { id: 'lights', label: 'Lighting', icon: 'lightbulb' },
  { id: 'climate', label: 'Climate', icon: 'thermometer' },
  { id: 'water', label: 'Water', icon: 'droplets' },
  { id: 'media', label: 'Media', icon: 'speaker' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'printer', label: 'Printer', icon: 'printer' },
  { id: 'network', label: 'Network', icon: 'router' },
  { id: 'bathroom', label: 'Bathroom', icon: 'bath' },
  { id: 'retreat', label: 'Retreat', icon: 'sparkles' },
  { id: 'tv', label: 'TV room', icon: 'tv' },
];

const ROOM_NAME_ICONS: Readonly<Record<string, string>> = {
  'Living Room': 'armchair',
  Narnia: 'sparkles',
  'TV Place': 'tv',
  Bathroom: 'bath',
  Bedroom: 'bed-double',
  Michael: 'bed-double',
  Kitchen: 'utensils',
  Outdoor: 'trees',
  Hallway: 'door-open',
};

export function resolveRoomIconName(roomName: string, customIconId?: string): string {
  if (customIconId && customIconId !== 'auto') {
    const matched = ROOM_ICON_OPTIONS.find((item) => item.id === customIconId);
    if (matched) return matched.icon;
  }
  return ROOM_NAME_ICONS[roomName] ?? 'house';
}

export interface RoomDeviceCandidate {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly currentAreaId: string | null;
  readonly currentRoomName: string;
}

export function mergeRoomIcons(
  areas: readonly TransportAreaEntry[],
  preferences?: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const area of areas) {
    if (typeof area.icon === 'string' && area.icon) {
      merged[area.area_id] = area.icon;
    }
  }
  if (preferences) Object.assign(merged, preferences);
  return merged;
}

export function buildRoomDeviceCandidates(
  devices: readonly TransportDeviceEntry[],
  areas: readonly TransportAreaEntry[],
  resolveDeviceArea: (device: TransportDeviceEntry) => string | null,
  roomId: string,
  query = '',
): RoomDeviceCandidate[] {
  const areasById = new Map(areas.map((area) => [area.area_id, area.name]));
  const needle = query.trim().toLocaleLowerCase();
  const candidates: RoomDeviceCandidate[] = [];

  for (const device of devices) {
    const currentAreaId = resolveDeviceArea(device);
    if (currentAreaId === roomId) continue;

    const rawName = typeof device.name_by_user === 'string' && device.name_by_user.trim()
      ? device.name_by_user.trim()
      : typeof device.name === 'string' && device.name.trim()
        ? device.name.trim()
        : 'Connected device';
    const manufacturer = typeof device.manufacturer === 'string' ? device.manufacturer : '';
    const model = typeof device.model === 'string' ? device.model : '';
    const detail = [manufacturer, model].filter(Boolean).join(' · ');
    const currentRoomName = currentAreaId
      ? (areasById.get(currentAreaId) ?? 'Other room')
      : 'Unassigned';

    if (needle && !`${rawName} ${detail} ${currentRoomName}`.toLocaleLowerCase().includes(needle)) {
      continue;
    }

    candidates.push({
      id: device.id,
      name: rawName,
      detail,
      currentAreaId,
      currentRoomName,
    });
  }

  candidates.sort((a, b) => {
    const aUnassigned = a.currentAreaId === null ? 0 : 1;
    const bUnassigned = b.currentAreaId === null ? 0 : 1;
    if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  return candidates;
}
