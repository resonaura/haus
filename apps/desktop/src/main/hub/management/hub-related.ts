/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isRecord, type CompatView } from '../types';
import { automationToHaConfig, scriptToHaConfig } from './hub-rule-configs';
import type { HubAutomationsContext, ProjectedRules } from './hub-rules-projection';

const MAX_WALK_DEPTH = 24;

interface MatchTargets {
  readonly deviceIds: ReadonlySet<string>;
  readonly entityIds: ReadonlySet<string>;
  readonly endpointIds: ReadonlySet<string>;
}

function matchesStringOrList(value: unknown, target: ReadonlySet<string>): boolean {
  if (target.size === 0) return false;
  if (typeof value === 'string') return target.has(value);
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === 'string' && target.has(item));
  }
  return false;
}

function referencesTarget(node: unknown, targets: MatchTargets, depth = 0): boolean {
  if (depth > MAX_WALK_DEPTH || node === null || node === undefined) return false;
  if (Array.isArray(node)) {
    return node.some((item) => referencesTarget(item, targets, depth + 1));
  }
  if (!isRecord(node)) return false;

  for (const [key, value] of Object.entries(node)) {
    if (
      (key === 'device_id' || key === 'deviceId') &&
      matchesStringOrList(value, targets.deviceIds)
    ) {
      return true;
    }
    if (
      (key === 'entity_id' || key === 'entityId') &&
      matchesStringOrList(value, targets.entityIds)
    ) {
      return true;
    }
    if (
      (key === 'endpointId' || key === 'endpoint_id') &&
      matchesStringOrList(value, targets.endpointIds)
    ) {
      return true;
    }
    if (referencesTarget(value, targets, depth + 1)) return true;
  }
  return false;
}

function buildTargets(
  itemType: 'device' | 'entity',
  itemId: string,
  view: CompatView,
): MatchTargets {
  const deviceIds = new Set<string>();
  const entityIds = new Set<string>();
  const endpointIds = new Set<string>();

  if (itemType === 'device') {
    deviceIds.add(itemId);
    for (const [entityId, binding] of view.bindings) {
      if (binding.deviceId === itemId) {
        entityIds.add(entityId);
        endpointIds.add(binding.endpointId);
      }
    }
    for (const entry of view.entities) {
      if (entry.device_id === itemId && typeof entry.entity_id === 'string') {
        entityIds.add(entry.entity_id);
      }
    }
  } else {
    entityIds.add(itemId);
    const binding = view.bindings.get(itemId);
    if (binding) endpointIds.add(binding.endpointId);
  }

  return { deviceIds, entityIds, endpointIds };
}

/**
 * Resolves HA-shaped `search/related` queries against projected Hub automations, scripts,
 * and scenes using canonical device IDs, endpoint IDs, and compat entity IDs.
 */
export function searchHubRelated(params: {
  readonly itemType: string;
  readonly itemId: string;
  readonly view: CompatView;
  readonly projected: ProjectedRules;
}): Record<string, string[]> {
  if ((params.itemType !== 'device' && params.itemType !== 'entity') || !params.itemId) {
    throw new Error('Choose a valid device or entity.');
  }
  const targets = buildTargets(params.itemType, params.itemId, params.view);
  const automations: string[] = [];
  const scripts: string[] = [];
  const scenes: string[] = [];

  for (const [entityId, ruleId] of params.projected.automationByEntity) {
    const rule = params.projected.automationsById.get(ruleId);
    if (!rule) continue;
    if (
      referencesTarget(rule.triggers, targets) ||
      referencesTarget(rule.conditions, targets) ||
      referencesTarget(rule.actions, targets) ||
      referencesTarget(rule.metadata?.haConfig, targets)
    ) {
      automations.push(entityId);
    }
  }

  for (const [entityId, scriptId] of params.projected.scriptByEntity) {
    const script = params.projected.scriptsById.get(scriptId);
    if (!script) continue;
    if (
      referencesTarget(script.steps, targets) ||
      referencesTarget(script.metadata?.haConfig, targets)
    ) {
      scripts.push(entityId);
    }
  }

  for (const [entityId, sceneId] of params.projected.sceneByEntity) {
    const scene = params.projected.scenesById.get(sceneId);
    if (!scene) continue;
    const savedEntities = isRecord(scene.metadata?.haEntities)
      ? Object.keys(scene.metadata.haEntities)
      : [];
    const matched =
      scene.members.some(
        (member) =>
          targets.endpointIds.has(member.endpointId) || targets.entityIds.has(member.endpointId),
      ) || savedEntities.some((key) => targets.entityIds.has(key));
    if (matched) scenes.push(entityId);
  }

  return {
    ...(automations.length ? { automation: automations } : {}),
    ...(scripts.length ? { script: scripts } : {}),
    ...(scenes.length ? { scene: scenes } : {}),
  };
}

/** Handles `automation/config`, `script/config`, and `search/related` RPC queries against Hub. */
export function handleRuleRpc(
  message: Record<string, unknown>,
  ctx: HubAutomationsContext,
): { handled: true; result: unknown } | { handled: false } {
  const type = typeof message.type === 'string' ? message.type : '';
  const entityId = typeof message.entity_id === 'string' ? message.entity_id : '';
  const projected = ctx.getProjected();
  const view = ctx.getView();
  if (type === 'automation/config') {
    const id = projected.automationByEntity.get(entityId);
    const rule = id ? projected.automationsById.get(id) : undefined;
    if (!rule) throw new Error('Automation configuration was not found on this Hub.');
    return { handled: true, result: { config: automationToHaConfig(rule, view) } };
  }
  if (type === 'script/config') {
    const id = projected.scriptByEntity.get(entityId);
    const script = id ? projected.scriptsById.get(id) : undefined;
    if (!script) throw new Error('Script configuration was not found on this Hub.');
    return { handled: true, result: { config: scriptToHaConfig(script, view) } };
  }
  if (type === 'search/related') {
    return {
      handled: true,
      result: searchHubRelated({
        itemType: typeof message.item_type === 'string' ? message.item_type : '',
        itemId: typeof message.item_id === 'string' ? message.item_id : '',
        view,
        projected,
      }),
    };
  }
  return { handled: false };
}
