/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isRecord, type CompatView } from '../types';
import { toHubDeviceTriggers } from './hub-ha-device-triggers';
import {
  buildEndpointEntityMap,
  type HubAutomationRecord,
  type HubScriptRecord,
} from './hub-rules-projection';

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parseSunOffsetMinutes(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw / 60);
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const parts = trimmed.replace(/^[+-]/, '').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return sign * ((parts[0] ?? 0) * 60 + (parts[1] ?? 0));
}

export function toHubTriggerList(
  block: Record<string, unknown>,
  view: CompatView,
): Record<string, unknown>[] {
  const kind = String(block.trigger ?? block.platform ?? 'state');
  const target = isRecord(block.target) ? block.target : {};
  const entityIds = stringList(target.entity_id ?? block.entity_id);
  const firstEntityId = entityIds[0] ?? '';
  const endpointId = view.bindings.get(firstEntityId)?.endpointId ?? firstEntityId;

  if (kind === 'time') {
    return [{ type: 'time', ...(typeof block.at === 'string' ? { at: block.at } : {}) }];
  }
  if (kind === 'sun') {
    const offsetMinutes = parseSunOffsetMinutes(block.offset);
    return [
      {
        type: 'time',
        sun: block.event === 'sunrise' ? 'sunrise' : 'sunset',
        ...(offsetMinutes !== undefined && offsetMinutes !== 0 ? { offsetMinutes } : {}),
      },
    ];
  }
  if (kind === 'event.received' || kind === 'event') {
    const options = isRecord(block.options) ? block.options : {};
    const eventTypes = stringList(options.event_type ?? block.event_type);
    const resolvedTypes = eventTypes.length > 0 ? eventTypes : ['initial_press'];
    const eventData = isRecord(block.event_data) ? block.event_data : undefined;
    const hasData = eventData && Object.keys(eventData).length > 0;
    if (entityIds.length > 0) {
      return entityIds.flatMap((id) => {
        const ep = view.bindings.get(id)?.endpointId ?? id;
        return resolvedTypes.map((eventType) => ({
          type: 'event',
          eventType,
          endpointId: ep,
          ...(hasData ? { data: eventData } : {}),
        }));
      });
    }
    return resolvedTypes.map((eventType) => ({
      type: 'event',
      eventType,
      ...(hasData ? { data: eventData } : {}),
    }));
  }
  if (kind === 'device') {
    try {
      return toHubDeviceTriggers(block, view);
    } catch {
      const eventType = typeof block.type === 'string' && block.type ? block.type : 'initial_press';
      const deviceId = typeof block.device_id === 'string' ? block.device_id : undefined;
      return [{ type: 'event', eventType, ...(deviceId ? { endpointId: deviceId } : {}) }];
    }
  }
  if (kind === 'state' && firstEntityId.startsWith('event.') && block.attribute === 'event_type') {
    const toTypes = stringList(block.to);
    const resolvedTypes = toTypes.length > 0 ? toTypes : ['initial_press'];
    return resolvedTypes.map((eventType) => ({
      type: 'event',
      eventType,
      endpointId,
    }));
  }
  if (kind === 'numeric_state') {
    return [
      {
        type: 'numeric_state',
        endpointId,
        property:
          typeof block.attribute === 'string' && block.attribute ? block.attribute : 'value',
        ...(typeof block.above === 'number' ? { above: block.above } : {}),
        ...(typeof block.below === 'number' ? { below: block.below } : {}),
      },
    ];
  }
  return [
    {
      type: 'state',
      endpointId,
      ...(typeof block.attribute === 'string' && block.attribute
        ? { property: block.attribute }
        : {}),
      ...(block.from !== undefined ? { from: block.from } : {}),
      ...(block.to !== undefined ? { to: block.to } : {}),
    },
  ];
}

export function toHubTrigger(
  block: Record<string, unknown>,
  view: CompatView,
): Record<string, unknown> {
  return toHubTriggerList(block, view)[0] ?? { type: 'state', endpointId: '' };
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
      if (t.type === 'event') {
        const entityId =
          typeof t.endpointId === 'string' && t.endpointId
            ? (epMap.get(t.endpointId)?.entityId ?? t.endpointId)
            : '';
        const eventType = typeof t.eventType === 'string' && t.eventType ? t.eventType : 'initial_press';
        if (entityId) {
          return {
            trigger: 'event.received',
            target: { entity_id: entityId },
            options: { event_type: [eventType] },
          };
        }
        return {
          trigger: 'event',
          event_type: eventType,
          ...(isRecord(t.data) && Object.keys(t.data).length > 0 ? { event_data: t.data } : {}),
        };
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
