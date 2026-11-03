/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HassEntity, Snapshot } from './types';

/** Only Haus-owned native/MQTT identities may replace explicitly linked raw camera sensors. */
export interface CameraActivityBinding {
  id: string;
  activity?: { replaces?: string[] };
}
export function cameraActivities(
  snapshot: Snapshot,
  bindings: readonly CameraActivityBinding[] = [],
) {
  const registry = new Map(snapshot.entities.map((entry) => [entry.entity_id, entry]));
  const devices = new Map(snapshot.devices.map((device) => [device.id, device]));
  const ids = new Set(snapshot.states.map((state) => state.entity_id));
  const sensors = new Map<string, HassEntity>();
  const replaced = new Set<string>();
  const ordered = [...snapshot.states].sort(
    (a, b) =>
      Number(registry.get(b.entity_id)?.platform === 'haus') -
      Number(registry.get(a.entity_id)?.platform === 'haus'),
  );
  for (const state of ordered) {
    const entry = registry.get(state.entity_id);
    const device = devices.get(entry?.device_id ?? '');
    const identifiers: [string, string][] = Array.isArray(device?.identifiers)
      ? device.identifiers.filter(
          (value: unknown): value is [string, string] =>
            Array.isArray(value) &&
            value.length === 2 &&
            value.every((part) => typeof part === 'string'),
        )
      : [];
    const persisted = identifiers.some(
      ([domain, id]) => domain === 'mqtt' && id === entry?.unique_id,
    )
      ? identifiers
          .find(([domain, id]) => domain === 'mqtt' && id.startsWith('haus_camera:'))?.[1]
          .slice('haus_camera:'.length)
      : undefined;
    const native =
      entry?.platform === 'haus' && entry.unique_id?.startsWith('haus_native:')
        ? /:(camera\.[a-z0-9_]+):haus_activity$/.exec(entry.unique_id ?? '')?.[1]
        : undefined;
    const camera =
      native ??
      persisted ??
      (state.attributes.haus_activity_version === 1 ? state.attributes.haus_camera : undefined);
    if (
      !state.entity_id.startsWith('binary_sensor.') ||
      (!native &&
        (entry?.platform !== 'mqtt' ||
          !/^haus_activity_[a-f0-9]{20}$/.test(entry.unique_id ?? ''))) ||
      entry?.disabled_by ||
      entry?.hidden_by ||
      typeof camera !== 'string' ||
      !camera.startsWith('camera.') ||
      !ids.has(camera)
    )
      continue;
    if (sensors.has(camera)) {
      replaced.add(state.entity_id);
      continue;
    }
    sensors.set(camera, state);
    // Home Assistant deliberately omits runtime attributes when unavailable.
    // Exact helper metadata is home-scoped; never guess from a friendly name.
    const sources = Array.isArray(state.attributes.native_sources)
      ? state.attributes.native_sources
      : bindings.find((binding) => binding.id === camera)?.activity?.replaces;
    if (Array.isArray(sources))
      for (const source of sources.slice(0, 32))
        if (
          typeof source === 'string' &&
          /^(binary_sensor|event)\./.test(source) &&
          ids.has(source)
        )
          replaced.add(source);
  }
  return { sensors, replaced };
}
