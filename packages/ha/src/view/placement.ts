/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { effectiveArea } from './matchers.js';
import { isStatefulScene, sceneSettingMatch } from './scene.js';
import type { Device, EntityRegistryEntry, HassEntity, HausModel, Snapshot } from './types.js';

export function inferScenePlacements(
  scenes: HassEntity[],
  snapshot: Snapshot,
  registry: Map<string, EntityRegistryEntry>,
  devices: ReadonlyMap<string, Device>,
  knownAreas: ReadonlySet<string>,
): HausModel['scenePlacements'] {
  const stateIds = new Set(snapshot.states.map((state) => state.entity_id));
  return scenes.map((scene) => {
    const configured = scene.attributes.entity_id;
    const sceneConfig = snapshot.sceneConfigs?.[scene.entity_id];
    const nested = sceneConfig?.entities ?? scene.attributes.entities;
    const targetIds = [
      ...(Array.isArray(configured)
        ? configured.filter((id): id is string => typeof id === 'string')
        : typeof configured === 'string'
          ? [configured]
          : []),
      ...(nested && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.keys(nested)
        : []),
    ];
    const areaScores = new Map<string, number>();
    for (const targetId of new Set(targetIds)) {
      if (!stateIds.has(targetId)) continue;
      const areaId = effectiveArea(registry.get(targetId), devices);
      if (areaId && knownAreas.has(areaId))
        areaScores.set(areaId, (areaScores.get(areaId) ?? 0) + 1);
    }
    const rankedAreas = [...areaScores.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const targetCount = [...new Set(targetIds)].filter((id) => stateIds.has(id)).length;
    const [bestArea, bestCount] = rankedAreas[0] ?? [];
    const concentration = targetCount ? (bestCount ?? 0) / targetCount : 0;
    const directArea = effectiveArea(registry.get(scene.entity_id), devices);
    const spansHome =
      rankedAreas.length >= 3 ||
      (rankedAreas.length >= 2 && targetCount >= 6 && concentration < 0.85);
    const inferredRoom =
      !spansHome && concentration >= 0.7 && (rankedAreas.length === 1 || (bestCount ?? 0) >= 2);
    const settingMatch = sceneSettingMatch(scene, snapshot, sceneConfig);
    const monitors = snapshot.states.filter(
      (state) =>
        state.attributes.scene_entity_id === scene.entity_id &&
        isStatefulScene(state, registry.get(state.entity_id)),
    );
    const activeMatch = {
      ...settingMatch,
      active: monitors.length
        ? monitors.some((state) => state.state === 'on')
        : settingMatch?.matchScore === 1 && settingMatch?.matchCoverage === 1,
    };
    if (targetCount && inferredRoom && bestArea) {
      return {
        sceneId: scene.entity_id,
        areaId: bestArea,
        scope: 'room' as const,
        confidence: Math.min(0.99, 0.65 + concentration * 0.34),
        targetCount,
        ...activeMatch,
      };
    }
    if (targetCount && rankedAreas.length > 1) {
      return {
        sceneId: scene.entity_id,
        scope: 'home' as const,
        confidence: Math.min(0.98, 0.58 + (1 - concentration) * 0.4),
        targetCount,
        ...activeMatch,
      };
    }
    if (directArea && knownAreas.has(directArea))
      return {
        sceneId: scene.entity_id,
        areaId: directArea,
        scope: 'room' as const,
        confidence: 0.72,
        targetCount: 0,
        ...activeMatch,
      };
    return {
      sceneId: scene.entity_id,
      scope: 'home' as const,
      confidence: 0.5,
      targetCount,
      ...activeMatch,
    };
  });
}
