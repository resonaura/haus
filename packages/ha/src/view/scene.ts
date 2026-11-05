/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Device, EntityRegistryEntry, HassEntity, Snapshot } from './types.js';

export const sceneMetadata = new Set([
  'friendly_name',
  'icon',
  'entity_id',
  'id',
  'supported_features',
  'supported_color_modes',
  'min_color_temp_kelvin',
  'max_color_temp_kelvin',
  'min_mireds',
  'max_mireds',
  'unit_of_measurement',
]);

export function isStatefulScene(
  entity: HassEntity,
  entry?: EntityRegistryEntry,
  device?: Device,
): boolean {
  if (entry?.platform && /stateful[_-]?scenes?/i.test(entry.platform)) return true;
  if (entry?.unique_id && /stateful[_-]?scenes?/i.test(entry.unique_id)) return true;
  if (
    /^switch\.stateful_scene/i.test(entity.entity_id) ||
    /stateful[_-]?scenes?/i.test(entity.entity_id)
  ) {
    return true;
  }
  if (entity.attributes.integration === 'stateful_scenes') return true;
  if (
    entity.attributes.scene_entity_id !== undefined ||
    entity.attributes.monitored_entities !== undefined ||
    entity.attributes.off_scene !== undefined
  ) {
    return true;
  }
  if (device) {
    if (device.manufacturer && /hugo\s*bloem|stateful[_-]?scenes?/i.test(device.manufacturer)) {
      return true;
    }
    if (device.model && /stateful[_-]?scenes?/i.test(device.model)) return true;
    if (device.name && /stateful[_-]?scenes?/i.test(device.name)) return true;
    if (device.name_by_user && /stateful[_-]?scenes?/i.test(device.name_by_user)) return true;
    if (
      Array.isArray(device.identifiers) &&
      device.identifiers.some((tuple) =>
        Array.isArray(tuple)
          ? tuple.some((id) => typeof id === 'string' && /stateful[_-]?scenes?/i.test(id))
          : typeof tuple === 'string' && /stateful[_-]?scenes?/i.test(tuple),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function sceneSettingMatch(
  scene: HassEntity,
  snapshot: Snapshot,
  sceneConfig?: Record<string, unknown>,
) {
  const settings = sceneConfig?.entities ?? scene.attributes.entities ?? scene.attributes.states;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
  const currentStates = new Map(snapshot.states.map((state) => [state.entity_id, state]));
  const entries = Object.entries(settings as Record<string, unknown>);
  let comparedEntities = 0;
  let matches = 0;
  let comparisons = 0;
  const matchesValue = (key: string, actual: unknown, expected: unknown) => {
    if (typeof actual === 'number' && typeof expected === 'number') {
      const tolerance: Record<string, number> = {
        brightness: 20,
        color_temp_kelvin: 250,
        color_temp: 25,
        current_position: 5,
        position: 5,
        percentage: 5,
        temperature: 0.5,
      };
      return (
        Math.abs(actual - expected) <= (tolerance[key] ?? Math.max(0.05, Math.abs(expected) * 0.02))
      );
    }
    if (Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length) {
      return actual.every((value, index) =>
        typeof value === 'number' && typeof expected[index] === 'number'
          ? Math.abs(value - expected[index]) <= (key === 'rgb_color' ? 24 : 0.025)
          : value === expected[index],
      );
    }
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  };

  for (const [entityId, config] of entries) {
    const current = currentStates.get(entityId);
    if (!current) continue;
    const configRecord =
      config && typeof config === 'object' && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : undefined;
    const expectedAttributes =
      configRecord?.attributes && typeof configRecord.attributes === 'object'
        ? (configRecord.attributes as Record<string, unknown>)
        : configRecord;
    const expectedValues: Array<[string, unknown, unknown]> = [];
    if (typeof config === 'string') expectedValues.push(['state', current.state, config]);
    else if (configRecord?.state !== undefined)
      expectedValues.push(['state', current.state, configRecord.state]);
    for (const [key, expected] of Object.entries(expectedAttributes ?? {})) {
      const expectedState = typeof config === 'string' ? config : configRecord?.state;
      // A powered-off lamp may keep its previous brightness and color in HA.
      if (
        entityId.startsWith('light.') &&
        expectedState === 'off' &&
        [
          'brightness',
          'color_mode',
          'rgb_color',
          'rgbw_color',
          'rgbww_color',
          'hs_color',
          'xy_color',
          'color_temp',
          'color_temp_kelvin',
          'effect',
        ].includes(key)
      )
        continue;
      if (
        key === 'state' ||
        sceneMetadata.has(key) ||
        expected === null ||
        (typeof expected === 'object' && !Array.isArray(expected))
      )
        continue;
      expectedValues.push([key, current.attributes[key], expected]);
    }
    if (expectedValues.length) comparedEntities += 1;
    for (const [key, actual, expected] of expectedValues) {
      comparisons += 1;
      if (matchesValue(key, actual, expected)) matches += 1;
    }
  }
  return comparisons
    ? {
        matchScore: matches / comparisons,
        matchCoverage: entries.length ? comparedEntities / entries.length : 0,
      }
    : undefined;
}
