/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { resolveNamedScenePalette } from '@haus/core/transport';
import { lightColor } from '../light-color.js';
import type { EntityRegistryEntry, HassEntity, HausModel, Snapshot } from './types.js';

function resolveFallbackSceneArtwork(
  scene: HassEntity,
  snapshot: Snapshot,
  title: string,
  source?: string,
) {
  const inline: string[] = [];
  const rawColors = scene.attributes.colors ?? scene.attributes.palette;
  if (Array.isArray(rawColors)) {
    for (const entry of rawColors) {
      if (typeof entry === 'string' && entry.trim()) inline.push(entry.trim());
      else if (Array.isArray(entry) && entry.length === 3 && entry.every((n) => typeof n === 'number')) {
        inline.push(`rgb(${Math.round(entry[0])}, ${Math.round(entry[1])}, ${Math.round(entry[2])})`);
      }
    }
  }
  const direct = lightColor({
    entity_id: 'light.scene_preview',
    state: 'on',
    attributes: scene.attributes,
    last_changed: '',
  });
  if (direct) inline.push(direct);
  if (inline.length > 0) return { colors: [...new Set(inline)].slice(0, 5) };

  const entry = snapshot.entities.find((item) => item.entity_id === scene.entity_id);
  const entryConfigId =
    typeof entry?.config_entry_id === 'string' ? entry.config_entry_id : undefined;
  const device = entry?.device_id
    ? snapshot.devices.find((item) => item.id === entry.device_id)
    : undefined;
  const isHue =
    source?.toLowerCase() === 'hue' ||
    typeof scene.attributes.group_name === 'string' ||
    typeof scene.attributes.is_dynamic === 'boolean' ||
    entry?.platform === 'hue' ||
    Boolean(entryConfigId?.includes('hue')) ||
    /philips|signify|\bhue\b/i.test(`${device?.manufacturer ?? ''} ${device?.model ?? ''}`);
  return resolveNamedScenePalette(title, scene.entity_id, isHue);
}

export function sceneLightingIsDark(
  settings: Record<string, unknown> | undefined,
): boolean | undefined {
  if (!settings) return undefined;
  const lights = Object.entries(settings).filter(([id]) => id.startsWith('light.'));
  if (!lights.length) return undefined;
  return lights.every(([, setting]) => {
    if (setting === 'off') return true;
    if (!setting || typeof setting !== 'object') return false;
    const value = setting as Record<string, unknown>;
    const attrs =
      value.attributes && typeof value.attributes === 'object'
        ? (value.attributes as Record<string, unknown>)
        : value;
    return (
      value.state === 'off' || (typeof attrs.brightness === 'number' && attrs.brightness <= 12)
    );
  });
}

export function scenePresentation(scene: HassEntity, room?: string, entry?: EntityRegistryEntry) {
  const raw = String(
    scene.attributes.friendly_name ?? scene.entity_id.split('.')[1].replaceAll('_', ' '),
  );
  const hue =
    /\(\s*hue\s*\)/i.test(raw) ||
    entry?.platform?.toLowerCase() === 'hue' ||
    typeof scene.attributes.group_name === 'string';
  const name =
    raw
      .replace(/\(\s*hue\s*\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Scene';
  const title =
    room && name.toLowerCase().startsWith(room.toLowerCase() + ' ')
      ? name.slice(room.length + 1)
      : name;
  return { name, title, source: hue ? 'Hue' : undefined };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function sceneCard(scene: HassEntity, snapshot: Snapshot, model: HausModel) {
  const id = scene.entity_id;
  const placement = model.scenePlacements.find((item) => item.sceneId === id);
  const room = model.rooms.find((item) => item.id === placement?.areaId)?.name ?? 'Whole home';
  const presentation = scenePresentation(
    scene,
    room,
    snapshot.entities.find((item) => item.entity_id === id),
  );
  const settings = record(
    snapshot.sceneConfigs?.[id]?.entities ?? scene.attributes.entities ?? scene.attributes.states,
  );
  const ids = scene.attributes.entity_id;
  const targets = settings
    ? Object.entries(settings).map(([id, setting]) => ({ id, setting }))
    : (Array.isArray(ids) ? ids : [ids])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ id, setting: undefined }));
  const swatches = new Set<string>();
  for (const { id, setting } of targets) {
    const value = record(setting);
    if (!id.startsWith('light.') || !value || value.state === 'off') continue;
    const color = lightColor({
      entity_id: id,
      state: 'on',
      attributes: record(value.attributes) ?? value,
      last_changed: '',
    });
    if (color) swatches.add(color);
  }
  const artwork =
    snapshot.sceneArtwork?.[id] ??
    (swatches.size === 0
      ? resolveFallbackSceneArtwork(scene, snapshot, presentation.title, presentation.source)
      : undefined);
  const colors = artwork?.colors.length ? artwork.colors : [...swatches].slice(0, 5);
  return {
    ...presentation,
    room,
    icon: typeof scene.attributes.icon === 'string' ? scene.attributes.icon : undefined,
    targets,
    colors,
    count: targets.length || placement?.targetCount || 0,
    dark:
      artwork?.dark ??
      sceneLightingIsDark(settings) ??
      (/night|sleep/i.test(presentation.name) && !colors.length),
    match: placement?.matchScore === 1 && placement.matchCoverage === 1,
    active: placement?.active === true,
  };
}

export function groupScenes(scenes: readonly HassEntity[], model: HausModel) {
  const assignments = new Map(model.scenePlacements.map((item) => [item.sceneId, item.areaId]));
  const groups = new Map<string, HassEntity[]>();
  for (const scene of scenes) {
    const id = assignments.get(scene.entity_id) ?? 'home';
    const group = groups.get(id);
    if (group) group.push(scene);
    else groups.set(id, [scene]);
  }
  const rooms = [{ id: 'home', name: 'Whole home' }, ...model.rooms];
  return rooms.flatMap(({ id, name }) => {
    const items = groups.get(id);
    return items ? [{ id, name, items }] : [];
  });
}

/** Keep each room together, then sort visible titles without prefixes or source badges. */
export function sortScenesByName(
  scenes: HassEntity[],
  roomForScene: (scene: HassEntity) => string | undefined = () => undefined,
) {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return [...scenes].sort((a, b) => {
    const roomA = roomForScene(a);
    const roomB = roomForScene(b);
    return (
      collator.compare(roomA ?? 'Whole home', roomB ?? 'Whole home') ||
      collator.compare(scenePresentation(a, roomA).title, scenePresentation(b, roomB).title) ||
      a.entity_id.localeCompare(b.entity_id)
    );
  });
}

/** Home visibility is independent of library visibility; hiding in Haus takes precedence. */
export function sceneViews(
  scenes: HassEntity[],
  hiddenApp: ReadonlySet<string>,
  hiddenHome: ReadonlySet<string>,
) {
  const visible = scenes.filter((scene) => !hiddenApp.has(scene.entity_id));
  return {
    visible,
    home: visible.filter((scene) => !hiddenHome.has(scene.entity_id)),
    hidden: scenes.filter((scene) => hiddenApp.has(scene.entity_id)),
  };
}
