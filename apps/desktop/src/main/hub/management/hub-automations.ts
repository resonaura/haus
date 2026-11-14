/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { translateService } from '../commands';
import { isRecord, type CompatView } from '../types';
import {
  asRecordArray,
  automationToHaConfig,
  scriptToHaConfig,
  toHubCondition,
  toHubStep,
  toHubTrigger,
} from './hub-rule-configs';
import {
  emptyProjectedRules,
  fetchHubRuleLists,
  haTargetToHub,
  projectHubRules,
  type HubAutomationRecord,
  type HubAutomationsContext,
  type HubSceneMember,
  type HubSceneRecord,
  type HubScriptRecord,
} from './hub-rules-projection';

export {
  emptyProjectedRules,
  fetchHubRuleLists,
  projectHubRules,
  type HubAutomationRecord,
  type HubAutomationsContext,
  type HubSceneRecord,
  type HubScriptRecord,
  type ProjectedRules,
} from './hub-rules-projection';

/** Encapsulates Hub scenes, scripts, and automations compat projection and RPC/service routing. */
export class HubRulesBridge {
  private lists: {
    scenes: HubSceneRecord[];
    scripts: HubScriptRecord[];
    automations: HubAutomationRecord[];
  } = { scenes: [], scripts: [], automations: [] };
  private projected = emptyProjectedRules();

  constructor(
    private readonly deps: {
      api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
      refresh: () => Promise<void>;
      getView: () => CompatView;
    },
  ) {}

  reset(): void {
    this.lists = { scenes: [], scripts: [], automations: [] };
    this.projected = emptyProjectedRules();
  }

  async fetchIfStale(stale: boolean) {
    return stale ? fetchHubRuleLists(this.deps.api) : undefined;
  }

  applyView(deviceView: CompatView, fetched?: typeof this.lists): CompatView {
    if (fetched !== undefined) this.lists = fetched;
    this.projected = projectHubRules({
      view: deviceView,
      ...this.lists,
      now: new Date().toISOString(),
    });
    return {
      ...deviceView,
      states: [...deviceView.states, ...this.projected.states],
      entities: [...deviceView.entities, ...this.projected.entities],
    };
  }

  getSceneConfig(entityId?: unknown, sceneId?: unknown): Record<string, unknown> | null {
    const byId = typeof sceneId === 'string' ? this.projected.sceneConfigs.get(sceneId) : undefined;
    if (byId) return byId;
    const mappedId =
      typeof entityId === 'string' ? this.projected.sceneByEntity.get(entityId) : undefined;
    return mappedId ? (this.projected.sceneConfigs.get(mappedId) ?? null) : null;
  }

  management(input: { method?: unknown; path?: unknown; data?: unknown }) {
    return handleRuleManagement(input, this.ctx());
  }

  rpc(message: Record<string, unknown>) {
    return handleRuleRpc(message, this.ctx());
  }

  callService(message: Record<string, unknown>) {
    return handleRuleService(message, this.ctx());
  }

  private ctx(): HubAutomationsContext {
    return { ...this.deps, getProjected: () => this.projected };
  }
}

/** Handles HA management REST paths for scenes, automations, and scripts against Hub. */
export async function handleRuleManagement(
  input: { method?: unknown; path?: unknown; data?: unknown },
  ctx: HubAutomationsContext,
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  const path = typeof input.path === 'string' ? input.path : '';
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
  const match = /^config\/(scene|automation|script)\/config\/([a-z0-9_-]{1,128})$/i.exec(path);
  if (!match) return { handled: false };
  const [, kind, rawId] = match;
  const id = decodeURIComponent(rawId);
  const projected = ctx.getProjected();
  const view = ctx.getView();

  if (kind === 'scene') {
    if (method === 'GET') {
      const cfg = projected.sceneConfigs.get(id);
      if (!cfg) throw new Error('Scene configuration was not found on this Hub.');
      return { handled: true, result: cfg };
    }
    if (method === 'DELETE') {
      await ctx.api(`/api/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await ctx.refresh();
      return { handled: true, result: { result: 'ok' } };
    }
    if (method === 'POST') {
      const body = isRecord(input.data) ? input.data : {};
      const entities = isRecord(body.entities) ? body.entities : {};
      const members: HubSceneMember[] = Object.entries(entities).map(([entityId, value]) => ({
        endpointId: view.bindings.get(entityId)?.endpointId ?? entityId,
        targetState: haTargetToHub(value),
      }));
      const roomIds = new Set(
        Object.keys(entities)
          .map((entityId) => {
            const devId = view.bindings.get(entityId)?.deviceId;
            return devId ? view.devices.find((d) => d.id === devId)?.area_id : undefined;
          })
          .filter((room): room is string => typeof room === 'string' && room.length > 0),
      );
      const roomId =
        typeof body.room_id === 'string' && body.room_id
          ? body.room_id
          : roomIds.size === 1
            ? [...roomIds][0]
            : undefined;
      await ctx.api('/api/scenes', {
        method: 'POST',
        body: {
          id,
          name: String(body.name ?? id).trim(),
          ...(typeof body.icon === 'string' && body.icon ? { icon: body.icon } : {}),
          ...(roomId ? { roomId } : {}),
          members,
          metadata: { haEntities: entities },
        },
      });
      await ctx.refresh();
      return { handled: true, result: { result: 'ok' } };
    }
  }

  if (kind === 'automation') {
    if (method === 'GET') {
      const rule = projected.automationsById.get(id);
      if (!rule) throw new Error('Automation configuration was not found on this Hub.');
      return { handled: true, result: automationToHaConfig(rule, view) };
    }
    if (method === 'DELETE') {
      await ctx.api(`/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await ctx.refresh();
      return { handled: true, result: { result: 'ok' } };
    }
    if (method === 'POST') {
      const body = isRecord(input.data) ? input.data : {};
      const triggers = asRecordArray(body.triggers ?? body.trigger).map((b) =>
        toHubTrigger(b, view),
      );
      const conditions = asRecordArray(body.conditions ?? body.condition)
        .map((b) => toHubCondition(b, view))
        .filter((item): item is Record<string, unknown> => item !== null);
      const actions = asRecordArray(body.actions ?? body.action)
        .map((b) => toHubStep(b, ctx))
        .filter((item): item is Record<string, unknown> => item !== null);
      const existing = projected.automationsById.get(id);
      const enabled =
        typeof body.initial_state === 'boolean' ? body.initial_state : (existing?.enabled ?? false);
      await ctx.api('/api/automations', {
        method: 'POST',
        body: {
          id,
          name: String(body.alias ?? body.name ?? id).trim(),
          ...(typeof body.description === 'string' ? { description: body.description } : {}),
          enabled,
          mode: typeof body.mode === 'string' ? body.mode : 'single',
          triggers,
          conditions,
          actions,
          metadata: { haConfig: body },
        },
      });
      await ctx.refresh();
      return { handled: true, result: { result: 'ok' } };
    }
  }

  if (kind === 'script') {
    if (method === 'GET') {
      const script = projected.scriptsById.get(id);
      if (!script) throw new Error('Script configuration was not found on this Hub.');
      return { handled: true, result: scriptToHaConfig(script, view) };
    }
    if (method === 'DELETE') {
      await ctx.api(`/api/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await ctx.refresh();
      return { handled: true, result: { result: 'ok' } };
    }
    if (method === 'POST') {
      const body = isRecord(input.data) ? input.data : {};
      const steps = asRecordArray(body.sequence ?? body.steps)
        .map((b) => toHubStep(b, ctx))
        .filter((item): item is Record<string, unknown> => item !== null);
      await ctx.api('/api/scripts', {
        method: 'POST',
        body: {
          id,
          name: String(body.alias ?? body.name ?? id).trim(),
          ...(typeof body.description === 'string' ? { description: body.description } : {}),
          mode: typeof body.mode === 'string' ? body.mode : 'single',
          steps,
          metadata: { haConfig: body },
        },
      });
      await ctx.refresh();
      return { handled: true, result: { result: 'ok' } };
    }
  }

  return { handled: false };
}

/** Handles `automation/config` and `script/config` websocket RPC queries. */
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
  return { handled: false };
}

function targetEntityIds(target: unknown): string[] {
  if (!isRecord(target)) return [];
  if (typeof target.entity_id === 'string') return [target.entity_id];
  return Array.isArray(target.entity_id)
    ? target.entity_id.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Executes `scene`, `script`, and `automation` service calls against Hub APIs. */
export async function handleRuleService(
  message: Record<string, unknown>,
  ctx: HubAutomationsContext,
): Promise<boolean> {
  const domain = typeof message.domain === 'string' ? message.domain : '';
  const service = typeof message.service === 'string' ? message.service : '';
  const data = isRecord(message.service_data) ? message.service_data : {};
  const projected = ctx.getProjected();
  const view = ctx.getView();

  if (domain === 'scene' && service === 'apply' && isRecord(data.entities)) {
    for (const [entityId, rawTarget] of Object.entries(data.entities)) {
      const binding = view.bindings.get(entityId);
      if (!binding) continue;
      const targetObj = isRecord(rawTarget) ? rawTarget : { state: rawTarget };
      const svc =
        targetObj.state === 'off'
          ? 'turn_off'
          : targetObj.state === 'closed'
            ? 'close_cover'
            : targetObj.state === 'open'
              ? 'open_cover'
              : targetObj.state === 'locked'
                ? 'lock'
                : targetObj.state === 'unlocked'
                  ? 'unlock'
                  : binding.domain === 'climate'
                    ? targetObj.temperature !== undefined
                      ? 'set_temperature'
                      : 'set_hvac_mode'
                    : 'turn_on';
      const serviceData: Record<string, unknown> = { ...targetObj };
      delete serviceData.state;
      if (binding.domain === 'climate' && svc === 'set_hvac_mode') {
        serviceData.hvac_mode = targetObj.state;
      }
      const cmds = translateService(
        view.bindings,
        {
          domain: binding.domain,
          service: svc,
          target: { entity_id: entityId },
          service_data: serviceData,
        },
        (id) => view.states.some((s) => s.entity_id === id && s.state === 'on'),
      );
      for (const { deviceId, ...cmdBody } of cmds) {
        await ctx.api(`/api/devices/${encodeURIComponent(deviceId)}/command`, {
          method: 'POST',
          body: cmdBody,
        });
      }
    }
    return true;
  }

  const ids = targetEntityIds(message.target);
  if (domain === 'scene' && service === 'turn_on') {
    const hubIds = ids
      .map((id) => projected.sceneByEntity.get(id))
      .filter((id): id is string => Boolean(id));
    if (hubIds.length === 0) return false;
    for (const id of hubIds) {
      await ctx.api(`/api/scenes/${encodeURIComponent(id)}/activate`, { method: 'POST', body: {} });
    }
    await ctx.refresh();
    return true;
  }

  if (domain === 'script') {
    const scriptName = service === 'turn_on' || service === 'toggle' ? '' : service;
    const targets = ids.length ? ids : scriptName ? [`script.${scriptName}`] : [];
    const hubIds = targets
      .map(
        (id) =>
          projected.scriptByEntity.get(id) ?? (projected.scriptsById.has(id) ? id : undefined),
      )
      .filter((id): id is string => Boolean(id));
    if (hubIds.length === 0) return false;
    for (const id of hubIds) {
      await ctx.api(`/api/scripts/${encodeURIComponent(id)}/execute`, { method: 'POST', body: {} });
    }
    await ctx.refresh();
    return true;
  }

  if (domain === 'automation') {
    const hubIds = ids
      .map((id) => projected.automationByEntity.get(id))
      .filter((id): id is string => Boolean(id));
    if (hubIds.length === 0) return false;
    for (const id of hubIds) {
      if (service === 'trigger') {
        await ctx.api(`/api/automations/${encodeURIComponent(id)}/trigger`, {
          method: 'POST',
          body: {},
        });
      } else if (service === 'toggle' || service === 'turn_on' || service === 'turn_off') {
        const rule = projected.automationsById.get(id);
        if (!rule) continue;
        const enabled = service === 'toggle' ? !rule.enabled : service === 'turn_on';
        await ctx.api('/api/automations', { method: 'POST', body: { ...rule, enabled } });
      }
    }
    await ctx.refresh();
    return true;
  }

  return false;
}
