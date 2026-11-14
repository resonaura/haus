/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { translateService } from '../commands';
import { isRecord, type CompatView } from '../types';
import {
  buildEndpointEntityMap,
  type HubAutomationRecord,
  type HubAutomationsContext,
  type HubScriptRecord,
} from './hub-rules-projection';

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

export function toHubTrigger(
  block: Record<string, unknown>,
  view: CompatView,
): Record<string, unknown> {
  const kind = String(block.trigger ?? block.platform ?? 'state');
  const entityId = typeof block.entity_id === 'string' ? block.entity_id : '';
  const endpointId = view.bindings.get(entityId)?.endpointId ?? entityId;
  if (kind === 'time') {
    return { type: 'time', ...(typeof block.at === 'string' ? { at: block.at } : {}) };
  }
  if (kind === 'sun') {
    return { type: 'time', sun: block.event === 'sunrise' ? 'sunrise' : 'sunset' };
  }
  if (kind === 'numeric_state') {
    return {
      type: 'numeric_state',
      endpointId,
      property: typeof block.attribute === 'string' && block.attribute ? block.attribute : 'value',
      ...(typeof block.above === 'number' ? { above: block.above } : {}),
      ...(typeof block.below === 'number' ? { below: block.below } : {}),
    };
  }
  return {
    type: 'state',
    endpointId,
    ...(typeof block.attribute === 'string' && block.attribute
      ? { property: block.attribute }
      : {}),
    ...(block.from !== undefined ? { from: block.from } : {}),
    ...(block.to !== undefined ? { to: block.to } : {}),
  };
}

export function toHubCondition(
  block: Record<string, unknown>,
  view: CompatView,
): Record<string, unknown> | null {
  const kind = String(block.condition ?? 'state');
  const entityId = typeof block.entity_id === 'string' ? block.entity_id : '';
  const endpointId = view.bindings.get(entityId)?.endpointId ?? entityId;
  if (kind === 'state') {
    return {
      type: 'state',
      endpointId,
      property: 'state',
      operator: '==',
      value: block.state ?? 'on',
    };
  }
  if (kind === 'time') {
    return {
      type: 'time',
      ...(typeof block.after === 'string' ? { after: block.after } : {}),
      ...(typeof block.before === 'string' ? { before: block.before } : {}),
    };
  }
  return null;
}

export function toHubStep(
  block: Record<string, unknown>,
  ctx: HubAutomationsContext,
): Record<string, unknown> | null {
  if (isRecord(block.delay) || typeof block.delay === 'string' || typeof block.delay === 'number') {
    const ms =
      typeof block.delay === 'number'
        ? block.delay * 1000
        : isRecord(block.delay)
          ? (Number(block.delay.seconds ?? 0) + Number(block.delay.minutes ?? 0) * 60) * 1000
          : 1000;
    return { type: 'delay', durationMs: Math.max(0, ms) };
  }
  const fullService = String(block.action ?? block.service ?? '');
  const [domain, service] = fullService.split('.');
  if (!domain || !service) return null;
  const target = isRecord(block.target) ? block.target : { entity_id: block.entity_id };
  const targetEntity =
    typeof target.entity_id === 'string'
      ? target.entity_id
      : Array.isArray(target.entity_id) && typeof target.entity_id[0] === 'string'
        ? target.entity_id[0]
        : '';
  const projected = ctx.getProjected();
  if (domain === 'scene' && service === 'turn_on' && projected.sceneByEntity.has(targetEntity)) {
    return {
      type: 'action',
      action: {
        kind: 'activate_scene',
        payload: { sceneId: projected.sceneByEntity.get(targetEntity) },
      },
    };
  }
  if (domain === 'script' && projected.scriptByEntity.has(targetEntity)) {
    return {
      type: 'action',
      action: {
        kind: 'call_script',
        payload: { scriptId: projected.scriptByEntity.get(targetEntity) },
      },
    };
  }
  const view = ctx.getView();
  if (targetEntity && view.bindings.has(targetEntity)) {
    try {
      const cmds = translateService(
        view.bindings,
        {
          domain,
          service,
          target: { entity_id: targetEntity },
          service_data: isRecord(block.data) ? block.data : {},
        },
        (id) => view.states.some((s) => s.entity_id === id && s.state === 'on'),
      );
      if (cmds[0]) {
        return {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: cmds[0].endpointId,
              capability: cmds[0].capability,
              command: cmds[0].command,
              ...(cmds[0].parameters ? { parameters: cmds[0].parameters } : {}),
            },
          },
        };
      }
    } catch {
      /* Preserve unmapped command in metadata.haConfig when Hub capability conversion declines. */
    }
  }
  return {
    type: 'action',
    action: { kind: 'custom', customType: fullService, payload: block },
  };
}

export function automationToHaConfig(
  rule: HubAutomationRecord,
  view: CompatView,
): Record<string, unknown> {
  const saved = isRecord(rule.metadata?.haConfig) ? rule.metadata.haConfig : undefined;
  if (saved) {
    return {
      ...saved,
      id: rule.id,
      alias: rule.name,
      description: rule.description ?? saved.description ?? '',
      mode: rule.mode ?? 'single',
      initial_state: rule.enabled,
    };
  }
  const epMap = buildEndpointEntityMap(view.bindings);
  return {
    id: rule.id,
    alias: rule.name,
    description: rule.description ?? '',
    mode: rule.mode ?? 'single',
    initial_state: rule.enabled,
    triggers: (rule.triggers ?? []).map((t) => {
      if (t.type === 'time') {
        return t.sun
          ? { trigger: 'sun', event: t.sun }
          : { trigger: 'time', at: t.at ?? '08:00:00' };
      }
      const entityId =
        typeof t.endpointId === 'string' ? (epMap.get(t.endpointId)?.entityId ?? t.endpointId) : '';
      return {
        trigger: t.type === 'numeric_state' ? 'numeric_state' : 'state',
        entity_id: entityId,
        ...(t.to !== undefined ? { to: t.to } : {}),
        ...(t.from !== undefined ? { from: t.from } : {}),
        ...(typeof t.above === 'number' ? { above: t.above } : {}),
        ...(typeof t.below === 'number' ? { below: t.below } : {}),
      };
    }),
    conditions: (rule.conditions ?? []).map((c) => {
      if (c.type === 'time') return { condition: 'time', after: c.after, before: c.before };
      const entityId =
        typeof c.endpointId === 'string' ? (epMap.get(c.endpointId)?.entityId ?? c.endpointId) : '';
      return { condition: 'state', entity_id: entityId, state: c.value ?? 'on' };
    }),
    actions: (rule.actions ?? []).map((step) => {
      if (step.type === 'delay') {
        return { delay: { seconds: Math.round(Number(step.durationMs ?? 1000) / 1000) } };
      }
      const action = isRecord(step.action) ? step.action : undefined;
      if (action?.kind === 'device_command' && isRecord(action.payload)) {
        const epId = String(action.payload.endpointId ?? '');
        const bound = epMap.get(epId);
        const domain = bound?.binding.domain ?? 'switch';
        return {
          action: `${domain}.${String(action.payload.command ?? 'turn_on')}`,
          target: { entity_id: bound?.entityId ?? epId },
          ...(isRecord(action.payload.parameters) ? { data: action.payload.parameters } : {}),
        };
      }
      if (action?.kind === 'custom' && isRecord(action.payload)) return action.payload;
      return step;
    }),
  };
}

export function scriptToHaConfig(
  script: HubScriptRecord,
  view: CompatView,
): Record<string, unknown> {
  const saved = isRecord(script.metadata?.haConfig) ? script.metadata.haConfig : undefined;
  if (saved) return { ...saved, id: script.id, alias: script.name, mode: script.mode ?? 'single' };
  const dummy: HubAutomationRecord = {
    id: script.id,
    name: script.name,
    enabled: true,
    mode: script.mode,
    triggers: [],
    actions: script.steps,
  };
  const converted = automationToHaConfig(dummy, view);
  return {
    id: script.id,
    alias: script.name,
    description: script.description ?? '',
    mode: script.mode ?? 'single',
    sequence: converted.actions,
  };
}
