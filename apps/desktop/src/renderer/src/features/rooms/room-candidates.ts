/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Area, Snapshot } from '../../model';
import { deviceArea } from '../../model/registry';

export interface RoomDeviceCandidate {
  id: string;
  name: string;
  detail: string;
  currentAreaId: string | null;
  currentRoomName: string;
}

/** Merges area-level icons (e.g. Hub persisted rooms) beneath user preferences. */
export function mergeRoomIcons(
  areas: readonly Area[],
  preferences?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const area of areas) {
    const icon = 'icon' in area ? (area as { icon?: unknown }).icon : undefined;
    if (typeof icon === 'string' && icon) merged[area.area_id] = icon;
  }
  if (preferences) Object.assign(merged, preferences);
  return merged;
}

/** Builds searchable candidate devices that can be added to a target room, unassigned first. */
export function buildRoomDeviceCandidates(
  snapshot: Snapshot,
  roomId: string,
  query = '',
): RoomDeviceCandidate[] {
  const areasById = new Map(snapshot.areas.map((area) => [area.area_id, area.name]));
  const needle = query.trim().toLocaleLowerCase();
  const candidates: RoomDeviceCandidate[] = [];

  for (const device of snapshot.devices) {
    const currentAreaId = deviceArea(device, snapshot.devices);
    if (currentAreaId === roomId) continue;

    const name = device.name_by_user?.trim() || device.name?.trim() || 'Connected device';
    const detail = [device.manufacturer, device.model].filter(Boolean).join(' · ');
    const currentRoomName = currentAreaId
      ? (areasById.get(currentAreaId) ?? 'Other room')
      : 'Unassigned';

    if (needle && !`${name} ${detail} ${currentRoomName}`.toLocaleLowerCase().includes(needle)) {
      continue;
    }

    candidates.push({
      id: device.id,
      name,
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
