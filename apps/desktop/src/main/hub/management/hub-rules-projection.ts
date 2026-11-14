/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { slug } from '../entities';
import { isRecord, type CompatEntity, type CompatView, type EntityBinding } from '../types';

export interface HubSceneMember {
  endpointId: string;
  targetState: Record<string, unknown>;
  transitionSeconds?: number;
}

export interface HubSceneRecord {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  roomId?: string;
  members: HubSceneMember[];
  metadata?: Record<string, unknown>;
}

export interface HubScriptRecord {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  mode?: string;
  steps: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface HubAutomationRecord {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  mode?: string;
  triggers: Array<Record<string, unknown>>;
  conditions?: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface ProjectedRules {
  states: CompatEntity[];
  entities: Record<string, unknown>[];
  sceneByEntity: Map<string, string>;
  scriptByEntity: Map<string, string>;
  automationByEntity: Map<string, string>;
  scenesById: Map<string, HubSceneRecord>;
  scriptsById: Map<string, HubScriptRecord>;
  automationsById: Map<string, HubAutomationRecord>;
  sceneConfigs: Map<string, Record<string, unknown>>;
}

export interface HubAutomationsContext {
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  refresh: () => Promise<void>;
  getView: () => CompatView;
  getProjected: () => ProjectedRules;
}

const DOMAIN_PRIORITY = new Map(
  ['light', 'switch', 'climate', 'water_heater', 'cover', 'lock', 'fan', 'media_player'].map(
    (domain, idx) => [domain, idx],
  ),
);

export function emptyProjectedRules(): ProjectedRules {
  return {
    states: [],
    entities: [],
    sceneByEntity: new Map(),
    scriptByEntity: new Map(),
    automationByEntity: new Map(),
    scenesById: new Map(),
    scriptsById: new Map(),
    automationsById: new Map(),
    sceneConfigs: new Map(),
  };
}

export function buildEndpointEntityMap(
  bindings: Map<string, EntityBinding>,
): Map<string, { entityId: string; binding: EntityBinding }> {
  const out = new Map<string, { entityId: string; binding: EntityBinding }>();
  for (const [entityId, binding] of bindings) {
    const existing = out.get(binding.endpointId);
    const nextRank = DOMAIN_PRIORITY.get(binding.domain) ?? 99;
    const prevRank = existing ? (DOMAIN_PRIORITY.get(existing.binding.domain) ?? 99) : 100;
    if (!existing || nextRank < prevRank) out.set(binding.endpointId, { entityId, binding });
  }
  return out;
}

function uniqueEntityId(
  domain: string,
  name: string,
  fallbackId: string,
  used: Set<string>,
): string {
  const base = slug(name) || slug(fallbackId) || 'item';
  let id = `${domain}.${base}`;
  for (let n = 2; used.has(id); n += 1) id = `${domain}.${base}_${n}`;
  used.add(id);
  return id;
}

export function hubTargetToHa(
  targetState: Record<string, unknown>,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(extras) ? { ...extras } : {};
  if (typeof targetState.on_off === 'boolean') out.state = targetState.on_off ? 'on' : 'off';
  else if (typeof targetState.hvac_mode === 'string') out.state = targetState.hvac_mode;
  else if (typeof targetState.lock_state === 'string') out.state = targetState.lock_state;
  else if (typeof targetState.cover_position === 'number') {
    out.state = targetState.cover_position > 0 ? 'open' : 'closed';
    out.current_position = targetState.cover_position;
  } else if (typeof targetState.state === 'string') out.state = targetState.state;
  if (typeof targetState.brightness === 'number') out.brightness = targetState.brightness;
  if (typeof targetState.color_temp_kelvin === 'number')
    out.color_temp_kelvin = targetState.color_temp_kelvin;
  if (isRecord(targetState.color)) {
    const { r, g, b } = targetState.color;
    if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number')
      out.rgb_color = [r, g, b];
  }
  if (Array.isArray(targetState.hs_color)) out.hs_color = targetState.hs_color;
  if (typeof targetState.target_temperature === 'number')
    out.temperature = targetState.target_temperature;
  if (typeof targetState.fan_speed === 'number') out.percentage = targetState.fan_speed;
  if (typeof targetState.effect === 'string') out.effect = targetState.effect;
  return out;
}

export function haTargetToHub(target: unknown): Record<string, unknown> {
  if (typeof target === 'string') return { on_off: target === 'on' || target === 'open' };
  if (!isRecord(target)) return {};
  const out: Record<string, unknown> = {};
  if (typeof target.state === 'string') {
    if (target.state === 'on' || target.state === 'off') out.on_off = target.state === 'on';
    else if (target.state === 'open' || target.state === 'closed') {
      if (typeof target.current_position !== 'number') {
        out.cover_position = target.state === 'open' ? 100 : 0;
      }
    } else if (target.state === 'locked' || target.state === 'unlocked') {
      out.lock_state = target.state;
    } else {
      out.hvac_mode = target.state;
    }
  }
  if (typeof target.current_position === 'number') out.cover_position = target.current_position;
  if (typeof target.brightness === 'number') out.brightness = Math.round(target.brightness);
  if (typeof target.color_temp_kelvin === 'number')
    out.color_temp_kelvin = Math.round(target.color_temp_kelvin);
  if (Array.isArray(target.rgb_color) && target.rgb_color.length === 3) {
    out.color = {
      r: Number(target.rgb_color[0]),
      g: Number(target.rgb_color[1]),
      b: Number(target.rgb_color[2]),
    };
  }
  if (Array.isArray(target.hs_color)) out.hs_color = target.hs_color;
  if (typeof target.temperature === 'number') out.target_temperature = target.temperature;
  if (typeof target.percentage === 'number') out.fan_speed = target.percentage;
  if (typeof target.effect === 'string') out.effect = target.effect;
  return out;
}

/** Projects Hub scenes, scripts, and automations into desktop compat entities & states. */
export function projectHubRules(input: {
  view: CompatView;
  scenes: HubSceneRecord[];
  scripts: HubScriptRecord[];
  automations: HubAutomationRecord[];
  now: string;
}): ProjectedRules {
  const { view, scenes, scripts, automations, now } = input;
  const used = new Set(view.states.map((s) => s.entity_id));
  const endpointMap = buildEndpointEntityMap(view.bindings);
  const out = emptyProjectedRules();

  for (const scene of scenes) {
    if (!scene?.id || !scene?.name) continue;
    out.scenesById.set(scene.id, scene);
    const entityId = uniqueEntityId('scene', scene.name, scene.id, used);
    out.sceneByEntity.set(entityId, scene.id);
    const savedEntities = isRecord(scene.metadata?.haEntities) ? scene.metadata.haEntities : {};
    const entitiesMap: Record<string, Record<string, unknown>> = {};
    for (const member of scene.members ?? []) {
      const targetEntity = endpointMap.get(member.endpointId)?.entityId ?? member.endpointId;
      const saved = isRecord(savedEntities[targetEntity]) ? savedEntities[targetEntity] : undefined;
      entitiesMap[targetEntity] = hubTargetToHa(member.targetState ?? {}, saved);
    }
    out.sceneConfigs.set(scene.id, {
      id: scene.id,
      name: scene.name,
      ...(scene.icon ? { icon: scene.icon } : {}),
      ...(scene.roomId ? { room_id: scene.roomId } : {}),
      entities: entitiesMap,
    });
    out.states.push({
      entity_id: entityId,
      state: 'scening',
      attributes: {
        id: scene.id,
        friendly_name: scene.name,
        ...(scene.icon ? { icon: scene.icon } : {}),
        ...(scene.roomId ? { room_id: scene.roomId } : {}),
        entity_id: Object.keys(entitiesMap),
        entities: entitiesMap,
      },
      last_changed: now,
      last_updated: now,
    });
    out.entities.push({
      entity_id: entityId,
      device_id: null,
      area_id: scene.roomId ?? null,
      name: null,
      original_name: scene.name,
      platform: 'haus',
      unique_id: scene.id,
    });
  }

  for (const script of scripts) {
    if (!script?.id || !script?.name) continue;
    out.scriptsById.set(script.id, script);
    const entityId = uniqueEntityId('script', script.name, script.id, used);
    out.scriptByEntity.set(entityId, script.id);
    out.states.push({
      entity_id: entityId,
      state: 'off',
      attributes: {
        id: script.id,
        friendly_name: script.name,
        mode: script.mode ?? 'single',
        ...(script.icon ? { icon: script.icon } : {}),
      },
      last_changed: now,
      last_updated: now,
    });
    out.entities.push({
      entity_id: entityId,
      device_id: null,
      area_id: null,
      name: null,
      original_name: script.name,
      platform: 'haus',
      unique_id: script.id,
    });
  }

  for (const rule of automations) {
    if (!rule?.id || !rule?.name) continue;
    out.automationsById.set(rule.id, rule);
    const entityId = uniqueEntityId('automation', rule.name, rule.id, used);
    out.automationByEntity.set(entityId, rule.id);
    out.states.push({
      entity_id: entityId,
      state: rule.enabled === false ? 'off' : 'on',
      attributes: {
        id: rule.id,
        friendly_name: rule.name,
        mode: rule.mode ?? 'single',
        ...(rule.description ? { description: rule.description } : {}),
      },
      last_changed: now,
      last_updated: now,
    });
    out.entities.push({
      entity_id: entityId,
      device_id: null,
      area_id: null,
      name: null,
      original_name: rule.name,
      platform: 'haus',
      unique_id: rule.id,
    });
  }

  return out;
}

export async function fetchHubRuleLists(api: HubAutomationsContext['api']): Promise<{
  scenes: HubSceneRecord[];
  scripts: HubScriptRecord[];
  automations: HubAutomationRecord[];
}> {
  const [scenesBody, scriptsBody, automationsBody] = await Promise.all([
    api('/api/scenes').catch(() => undefined),
    api('/api/scripts').catch(() => undefined),
    api('/api/automations').catch(() => undefined),
  ]);
  return {
    scenes:
      isRecord(scenesBody) && Array.isArray(scenesBody.scenes)
        ? (scenesBody.scenes as HubSceneRecord[])
        : [],
    scripts:
      isRecord(scriptsBody) && Array.isArray(scriptsBody.scripts)
        ? (scriptsBody.scripts as HubScriptRecord[])
        : [],
    automations:
      isRecord(automationsBody) && Array.isArray(automationsBody.automations)
        ? (automationsBody.automations as HubAutomationRecord[])
        : [],
  };
}
