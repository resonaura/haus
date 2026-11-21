/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { translateService } from '../commands';
import { isRecord, type CompatView } from '../types';
import { toHubDeviceTriggers } from './hub-ha-device-triggers';
import { combineSteps, sceneSlug } from './hub-rule-transfer';
import type { HubAutomationsContext } from './hub-rules-projection';

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string' && value) return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function durationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string') {
    const parts = value.split(':').map((part) => Number.parseFloat(part));
    if (parts.some((part) => !Number.isFinite(part))) return undefined;
    const [hours = 0, minutes = 0, seconds = 0] = parts;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  if (isRecord(value)) {
    const number = (key: string) =>
      typeof value[key] === 'number' && Number.isFinite(value[key]) ? Number(value[key]) : 0;
    return (
      (number('hours') * 3600 + number('minutes') * 60 + number('seconds')) * 1000 +
      number('milliseconds')
    );
  }
  return undefined;
}

export function toHubTriggers(
  block: Record<string, unknown>,
  view: CompatView,
): Record<string, unknown>[] {
  const kind = String(block.trigger ?? block.platform ?? 'state');
  const entityIds = stringValues(block.entity_id);
  if (kind === 'time') {
    if (typeof block.at !== 'string' || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(block.at))
      throw new Error('unsupported_automation_time_trigger');
    return [{ type: 'time', at: block.at }];
  }
  if (kind === 'sun') {
    if (block.event !== 'sunrise' && block.event !== 'sunset')
      throw new Error('unsupported_automation_sun_trigger');
    const offset = durationMs(block.offset);
    if (block.offset !== undefined && offset === undefined)
      throw new Error('invalid_automation_sun_offset');
    return [
      {
        type: 'time',
        sun: block.event,
        ...(offset !== undefined ? { offsetMinutes: Math.round(offset / 60_000) } : {}),
      },
    ];
  }
  if (kind === 'event.received' || kind === 'event') {
    const target = isRecord(block.target) ? block.target : {};
    const options = isRecord(block.options) ? block.options : {};
    const targets = stringValues(target.entity_id ?? block.entity_id);
    const eventTypes = stringValues(options.event_type ?? block.event_type);
    if (kind === 'event' && eventTypes.length === 0 && typeof block.event_type === 'string')
      eventTypes.push(block.event_type);
    if (targets.length === 0 || eventTypes.length === 0) {
      throw new Error('unsupported_automation_event_trigger');
    }
    return targets.flatMap((entityId) => {
      const binding = view.bindings.get(entityId);
      if (!binding) throw new Error('automation_trigger_entity_unavailable');
      return eventTypes.map((eventType) => ({
        type: 'event',
        eventType,
        endpointId: binding.endpointId,
      }));
    });
  }
  if (kind === 'device') return toHubDeviceTriggers(block, view);
  if (entityIds.length === 0) throw new Error('automation_trigger_entity_required');
  return entityIds.map((entityId) => {
    const binding = view.bindings.get(entityId);
    if (!binding) throw new Error('automation_trigger_entity_unavailable');
    const endpointId = binding.endpointId;
    const forMs = durationMs(block.for);
    if (block.for !== undefined && (forMs === undefined || forMs < 0))
      throw new Error('invalid_automation_trigger_duration');
    if (kind === 'numeric_state') {
      if (typeof block.above !== 'number' && typeof block.below !== 'number')
        throw new Error('invalid_numeric_state_trigger');
      return {
        type: 'numeric_state',
        endpointId,
        property:
          typeof block.attribute === 'string' && block.attribute ? block.attribute : 'value',
        ...(typeof block.above === 'number' ? { above: block.above } : {}),
        ...(typeof block.below === 'number' ? { below: block.below } : {}),
        ...(forMs !== undefined ? { forDurationSeconds: forMs / 1000 } : {}),
      };
    }
    if (kind !== 'state') throw new Error('unsupported_automation_trigger');
    return {
      type: 'state',
      endpointId,
      ...(typeof block.attribute === 'string' && block.attribute
        ? { property: block.attribute }
        : {}),
      ...(block.from !== undefined ? { from: block.from } : {}),
      ...(block.to !== undefined ? { to: block.to } : {}),
      ...(forMs !== undefined ? { forDurationSeconds: forMs / 1000 } : {}),
    };
  });
}

export function toHubCondition(
  block: Record<string, unknown>,
  view: CompatView,
  strict = false,
): Record<string, unknown> | null {
  const kind = String(block.condition ?? 'state');
  const entityId = typeof block.entity_id === 'string' ? block.entity_id : '';
  const binding = view.bindings.get(entityId);
  if (strict && entityId && !binding) throw new Error('automation_condition_entity_unavailable');
  const endpointId = binding?.endpointId ?? entityId;
  if (kind === 'state') {
    if (!endpointId) {
      if (strict) throw new Error('automation_condition_entity_required');
      return null;
    }
    return {
      type: 'state',
      endpointId,
      property: 'state',
      operator: '==',
      value: block.state ?? 'on',
    };
  }
  if (kind === 'time') {
    const weekdays = Array.isArray(block.weekday)
      ? block.weekday.flatMap((value) => {
          if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6)
            return [value];
          if (typeof value !== 'string') return [];
          const day = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(
            value.slice(0, 3).toLowerCase(),
          );
          return day >= 0 ? [day] : [];
        })
      : [];
    return {
      type: 'time',
      ...(typeof block.after === 'string' ? { after: block.after } : {}),
      ...(typeof block.before === 'string' ? { before: block.before } : {}),
      ...(weekdays.length > 0 ? { weekdays } : {}),
    };
  }
  if (kind === 'numeric_state') {
    if (!endpointId) throw new Error('automation_condition_entity_required');
    const property =
      typeof block.attribute === 'string' && block.attribute ? block.attribute : 'value';
    const conditions = [
      ...(typeof block.above === 'number'
        ? [{ type: 'state', endpointId, property, operator: '>', value: block.above }]
        : []),
      ...(typeof block.below === 'number'
        ? [{ type: 'state', endpointId, property, operator: '<', value: block.below }]
        : []),
    ];
    if (conditions.length === 0) throw new Error('invalid_numeric_state_condition');
    return conditions.length === 1 ? (conditions[0] ?? null) : { type: 'and', conditions };
  }
  if (kind === 'and' || kind === 'or' || kind === 'not') {
    const raw = Array.isArray(block.conditions) ? block.conditions : [];
    const conditions = raw
      .filter(isRecord)
      .map((condition) => toHubCondition(condition, view, strict))
      .filter((condition): condition is Record<string, unknown> => condition !== null);
    if (conditions.length !== raw.length || conditions.length === 0)
      throw new Error('unsupported_automation_condition');
    return { type: kind, conditions };
  }
  if (strict) throw new Error('unsupported_automation_condition');
  return null;
}

export function toHubStep(
  block: Record<string, unknown>,
  ctx: HubAutomationsContext,
  strict = false,
): Record<string, unknown> | null {
  if (block.delay !== undefined) {
    const ms = durationMs(block.delay);
    if (ms === undefined || ms < 0) throw new Error('invalid_automation_delay');
    return { type: 'delay', durationMs: ms };
  }
  if (Array.isArray(block.sequence)) {
    const steps = block.sequence
      .filter(isRecord)
      .map((step) => toHubStep(step, ctx, strict))
      .filter((step): step is Record<string, unknown> => step !== null);
    if (strict && steps.length !== block.sequence.length)
      throw new Error('unsupported_automation_action');
    return { type: 'sequence', steps };
  }
  if (Array.isArray(block.parallel)) {
    const branches = block.parallel.map((branch) => {
      const steps = asRecordArray(branch)
        .map((step) => toHubStep(step, ctx, strict))
        .filter((step): step is Record<string, unknown> => step !== null);
      if (strict && Array.isArray(branch) && steps.length !== branch.length)
        throw new Error('unsupported_automation_action');
      return { type: 'sequence', steps };
    });
    return { type: 'parallel', steps: branches };
  }
  if (Array.isArray(block.choose)) {
    const branches = block.choose.map((rawBranch) => {
      if (!isRecord(rawBranch)) throw new Error('unsupported_automation_choose');
      const rawConditions = Array.isArray(rawBranch.conditions) ? rawBranch.conditions : [];
      const conditions = rawConditions
        .filter(isRecord)
        .map((condition) => toHubCondition(condition, ctx.getView(), strict))
        .filter((condition): condition is Record<string, unknown> => condition !== null);
      const rawSteps = Array.isArray(rawBranch.sequence) ? rawBranch.sequence : [];
      const steps = rawSteps
        .filter(isRecord)
        .map((step) => toHubStep(step, ctx, strict))
        .filter((step): step is Record<string, unknown> => step !== null);
      if (
        strict &&
        (conditions.length !== rawConditions.length || steps.length !== rawSteps.length)
      )
        throw new Error('unsupported_automation_choose');
      return { conditions, steps };
    });
    const rawDefault = Array.isArray(block.default) ? block.default : [];
    const defaultSteps = rawDefault
      .filter(isRecord)
      .map((step) => toHubStep(step, ctx, strict))
      .filter((step): step is Record<string, unknown> => step !== null);
    if (strict && defaultSteps.length !== rawDefault.length)
      throw new Error('unsupported_automation_choose');
    return {
      type: 'choose',
      branches,
      ...(rawDefault.length > 0 ? { defaultSteps } : {}),
    };
  }
  if (block.if !== undefined) {
    const rawConditions = Array.isArray(block.if) ? block.if : [block.if];
    const conditions = rawConditions
      .filter(isRecord)
      .map((condition) => toHubCondition(condition, ctx.getView(), strict))
      .filter((condition): condition is Record<string, unknown> => condition !== null);
    const rawThen = Array.isArray(block.then) ? block.then : [];
    const thenSteps = rawThen
      .filter(isRecord)
      .map((step) => toHubStep(step, ctx, strict))
      .filter((step): step is Record<string, unknown> => step !== null);
    const rawElse = Array.isArray(block.else) ? block.else : [];
    const elseSteps = rawElse
      .filter(isRecord)
      .map((step) => toHubStep(step, ctx, strict))
      .filter((step): step is Record<string, unknown> => step !== null);
    if (
      strict &&
      (conditions.length !== rawConditions.length ||
        thenSteps.length !== rawThen.length ||
        elseSteps.length !== rawElse.length)
    ) {
      throw new Error('unsupported_automation_if');
    }
    return {
      type: 'choose',
      branches: [{ conditions, steps: thenSteps }],
      ...(elseSteps.length > 0 ? { defaultSteps: elseSteps } : {}),
    };
  }
  if (isRecord(block.repeat)) {
    const repeat = block.repeat;
    if (repeat.until !== undefined) throw new Error('unsupported_automation_repeat_until');
    const rawSteps = Array.isArray(repeat.sequence) ? repeat.sequence : [];
    const steps = rawSteps
      .filter(isRecord)
      .map((step) => toHubStep(step, ctx, strict))
      .filter((step): step is Record<string, unknown> => step !== null);
    if (strict && steps.length !== rawSteps.length)
      throw new Error('unsupported_automation_repeat');
    const whileCondition = isRecord(repeat.while)
      ? toHubCondition(repeat.while, ctx.getView())
      : undefined;
    return {
      type: 'repeat',
      ...(typeof repeat.count === 'number' ? { count: repeat.count } : {}),
      ...(whileCondition ? { whileCondition } : {}),
      steps,
    };
  }
  if (isRecord(block.condition)) {
    const condition = toHubCondition(block.condition, ctx.getView());
    if (!condition) throw new Error('unsupported_automation_condition');
    return { type: 'condition', condition };
  }
  const fullService =
    typeof block.action === 'string'
      ? block.action
      : typeof block.service === 'string'
        ? block.service
        : typeof block.domain === 'string' && typeof block.type === 'string'
          ? `${block.domain}.${block.type}`
          : '';
  const [domain, service] = fullService.split('.');
  if (!domain || !service) {
    if (strict) throw new Error('unsupported_automation_action');
    return null;
  }
  const target = isRecord(block.target) ? block.target : { entity_id: block.entity_id };
  const targetEntities = stringValues(target.entity_id ?? block.entity_id);
  const projected = ctx.getProjected();
  const scenes = targetEntities
    .map((entityId) => projected.sceneByEntity.get(entityId))
    .filter((id): id is string => Boolean(id));
  if (domain === 'scene' && service === 'turn_on') {
    if (scenes.length === targetEntities.length && scenes.length > 0)
      return combineSteps(
        scenes.map((sceneId) => ({
          type: 'action',
          action: { kind: 'activate_scene', payload: { sceneId } },
        })),
      );
    if (strict) throw new Error('automation_scene_unavailable');
  }
  if (domain === 'switch' && service === 'turn_on') {
    const sceneIds = targetEntities.map((entityId) => {
      const match = /^switch\.([a-z0-9_]+)_stateful_scene$/.exec(entityId);
      if (!match?.[1]) return undefined;
      const scenesByName = [...projected.scenesById.values()].filter(
        (scene) => sceneSlug(scene.name) === match[1],
      );
      return scenesByName.length === 1 ? scenesByName[0]?.id : undefined;
    });
    if (sceneIds.length > 0 && sceneIds.every((id): id is string => Boolean(id)))
      return combineSteps(
        sceneIds.map((sceneId) => ({
          type: 'action',
          action: { kind: 'activate_scene', payload: { sceneId } },
        })),
      );
  }
  const scriptIds = targetEntities
    .map((entityId) => projected.scriptByEntity.get(entityId))
    .filter((id): id is string => Boolean(id));
  if (domain === 'script') {
    const resolved =
      scriptIds.length > 0
        ? scriptIds
        : service === 'turn_on' || service === 'toggle'
          ? []
          : [projected.scriptsById.has(service) ? service : undefined].filter((id): id is string =>
              Boolean(id),
            );
    if (
      resolved.length === targetEntities.length ||
      (targetEntities.length === 0 && resolved.length)
    )
      return combineSteps(
        resolved.map((scriptId) => ({
          type: 'action',
          action: { kind: 'call_script', payload: { scriptId } },
        })),
      );
    if (strict) throw new Error('automation_script_unavailable');
  }

  const view = ctx.getView();
  if (
    (domain === 'light' || domain === 'switch') &&
    service === 'toggle' &&
    targetEntities.length > 0 &&
    targetEntities.every((entityId) => view.bindings.has(entityId))
  ) {
    const data = isRecord(block.data)
      ? block.data
      : isRecord(block.service_data)
        ? block.service_data
        : undefined;
    return combineSteps(
      targetEntities.map((entityId) => {
        const binding = view.bindings.get(entityId);
        if (!binding) throw new Error('automation_action_target_unavailable');
        const turnOff = toHubStep(
          { action: `${domain}.turn_off`, target: { entity_id: entityId } },
          ctx,
          strict,
        );
        const turnOn = toHubStep(
          {
            action: `${domain}.turn_on`,
            target: { entity_id: entityId },
            ...(data ? { data } : {}),
          },
          ctx,
          strict,
        );
        if (!turnOff || !turnOn) throw new Error('automation_action_target_unavailable');
        return {
          type: 'choose',
          branches: [
            {
              conditions: [
                {
                  type: 'state',
                  endpointId: binding.endpointId,
                  property: binding.capability.id,
                  operator: '==',
                  value: true,
                },
              ],
              steps: [turnOff],
            },
          ],
          defaultSteps: [turnOn],
        };
      }),
    );
  }
  const effectiveDomain =
    domain === 'telegram_bot' && service === 'send_message' ? 'notify' : domain;
  const effectiveTargets =
    targetEntities.length > 0
      ? targetEntities
      : domain === 'telegram_bot' && service === 'send_message'
        ? [...view.bindings.entries()]
            .filter(
              ([, b]) => b.domain === 'notify' && b.endpointId.startsWith('notify.telegram_bot_'),
            )
            .map(([entityId]) => entityId)
        : [];
  if (
    effectiveTargets.length > 0 &&
    effectiveTargets.every((entityId) => view.bindings.has(entityId))
  ) {
    try {
      const commands = effectiveTargets.flatMap((entityId) =>
        translateService(
          view.bindings,
          {
            domain: effectiveDomain,
            service,
            target: { entity_id: entityId },
            service_data: isRecord(block.data)
              ? block.data
              : isRecord(block.service_data)
                ? block.service_data
                : {},
          },
          (id) => view.states.some((state) => state.entity_id === id && state.state === 'on'),
        ),
      );
      if (commands.length > 0)
        return combineSteps(
          commands.map((command) => ({
            type: 'action',
            action: {
              kind: 'device_command',
              payload: {
                endpointId: command.endpointId,
                capability: command.capability,
                command: command.command,
                ...(command.parameters ? { parameters: command.parameters } : {}),
              },
            },
          })),
        );
    } catch (cause: unknown) {
      if (strict) throw cause;
    }
  }
  if (strict) throw new Error('automation_action_target_unavailable');
  return {
    type: 'action',
    action: { kind: 'custom', customType: fullService, payload: block },
  };
}
