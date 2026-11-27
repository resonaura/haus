/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { EditableConfig } from '../config-editor.js';
import {
  compileConditionBlock,
  compileTargetToActions,
  extractEntityIds,
  extractScalarEventData,
  extractStringList,
  parseConditionBlock,
  parseDeviceActionTargets,
  VALID_AUTOMATION_WEEKDAYS,
} from './flow-actions.js';
import {
  asAutomationRecordList,
  formatDelayObject,
  formatOffsetString,
  normalizeTimeDisplay,
  parseDurationSeconds,
  parseOffsetMinutes,
  toFullTime,
  type AutomationActionStep,
  type AutomationConditionBlock,
  type AutomationFlowDraft,
  type AutomationRunMode,
  type AutomationTriggerBlock,
  type AutomationWeekday,
} from './flow-types.js';
import { asRecord } from './types.js';

const BUTTON_DEVICE_DOMAINS = new Set([
  'hue',
  'xiaomi_ble',
  'zha',
  'mqtt',
  'deconz',
  'matter',
  'shelly',
  'lutron_caseta',
]);

export interface ParseAutomationFlowOptions {
  readonly resolveDeviceEventEntity?: (input: {
    readonly domain: string;
    readonly deviceId: string;
    readonly triggerType: string;
    readonly subtype?: string;
  }) => string | undefined;
}

export interface CompileAutomationFlowOptions {
  readonly targetPlatform?: 'hub' | 'ha';
}

export function parseAutomationFlow(
  config: EditableConfig,
  options?: ParseAutomationFlowOptions,
): AutomationFlowDraft {
  const rawTriggers = asAutomationRecordList(config.triggers ?? config.trigger);
  let rawConditions = asAutomationRecordList(config.conditions ?? config.condition);
  let conditionLogic: 'all' | 'any' = 'all';
  if (
    rawConditions.length === 1 &&
    rawConditions[0]?.condition === 'or' &&
    Array.isArray(rawConditions[0].conditions)
  ) {
    conditionLogic = 'any';
    rawConditions = asAutomationRecordList(rawConditions[0].conditions);
  }

  const absorbedConditionIndices = new Set<number>();
  let absorbedWeekdays: AutomationWeekday[] = [];
  if (rawTriggers.length === 1 && (rawTriggers[0]?.trigger ?? rawTriggers[0]?.platform) === 'time') {
    const weekdayIdx = rawConditions.findIndex(
      (cond) =>
        cond.condition === 'time' &&
        Array.isArray(cond.weekday) &&
        !cond.after &&
        !cond.before,
    );
    if (weekdayIdx >= 0) {
      absorbedConditionIndices.add(weekdayIdx);
      absorbedWeekdays = (rawConditions[weekdayIdx]!.weekday as unknown[]).filter(
        (d): d is AutomationWeekday => typeof d === 'string' && VALID_AUTOMATION_WEEKDAYS.has(d),
      );
    }
  }

  const triggers: AutomationTriggerBlock[] = [];
  for (let idx = 0; idx < rawTriggers.length; idx += 1) {
    const item = rawTriggers[idx]!;
    const type = String(item.trigger ?? item.platform ?? '');
    const id = `when-${triggers.length}`;

    if (type === 'time' && typeof item.at === 'string') {
      triggers.push({ id, kind: 'time', at: normalizeTimeDisplay(item.at), weekdays: absorbedWeekdays });
      continue;
    }
    if (type === 'sun') {
      triggers.push({
        id,
        kind: 'sun',
        event: item.event === 'sunrise' ? 'sunrise' : 'sunset',
        offsetMinutes: parseOffsetMinutes(item.offset),
      });
      continue;
    }
    if (type === 'event.received' || (type === 'event' && extractEntityIds(item).length > 0)) {
      const entityId = extractEntityIds(item)[0] ?? '';
      const opts = asRecord(item.options);
      const parsedTypes = extractStringList(opts?.event_type ?? item.event_type);
      const eventTypes = parsedTypes.length > 0 ? parsedTypes : ['initial_press'];
      triggers.push({ id, kind: 'button_event', entityId, eventTypes });
      continue;
    }
    if (type === 'event') {
      const eventType =
        typeof item.event_type === 'string' && item.event_type.trim()
          ? item.event_type.trim()
          : 'hue_event';
      const eventData = extractScalarEventData(item.event_data);
      if (eventData !== null) {
        triggers.push({ id, kind: 'bus_event', eventType, eventData });
        continue;
      }
    }
    if (type === 'device' && typeof item.device_id === 'string' && typeof item.type === 'string') {
      const domain = typeof item.domain === 'string' ? item.domain : '';
      const subtype =
        typeof item.subtype === 'string' || typeof item.subtype === 'number'
          ? String(item.subtype)
          : undefined;
      if (
        BUTTON_DEVICE_DOMAINS.has(domain) ||
        /press|release|rotate|dimmer|click|button/i.test(item.type)
      ) {
        const eventType =
          domain === 'xiaomi_ble' && item.type === 'dimmer' && subtype ? subtype : item.type;
        const resolvedEntityId =
          options?.resolveDeviceEventEntity?.({
            domain,
            deviceId: item.device_id,
            triggerType: item.type,
            subtype,
          }) ?? '';
        const prev = triggers[triggers.length - 1];
        if (
          prev?.kind === 'button_event' &&
          prev.entityId === resolvedEntityId &&
          prev.haDeviceTrigger?.deviceId === item.device_id &&
          prev.haDeviceTrigger?.subtype === subtype
        ) {
          triggers[triggers.length - 1] = {
            ...prev,
            eventTypes: [...new Set([...prev.eventTypes, eventType])],
          };
        } else {
          triggers.push({
            id,
            kind: 'button_event',
            entityId: resolvedEntityId,
            eventTypes: [eventType],
            haDeviceTrigger: {
              domain,
              deviceId: item.device_id,
              ...(subtype ? { subtype } : {}),
            },
          });
        }
        continue;
      }
    }
    if (type === 'state') {
      const entityId = extractEntityIds(item)[0] ?? '';
      const matchingEventCondIdx =
        rawTriggers.length === 1
          ? rawConditions.findIndex(
              (cond) =>
                cond.condition === 'state' &&
                extractEntityIds(cond)[0] === entityId &&
                cond.attribute === 'event_type',
            )
          : -1;
      if (
        entityId.startsWith('event.') ||
        item.attribute === 'event_type' ||
        matchingEventCondIdx >= 0
      ) {
        let eventTypes = item.attribute === 'event_type' ? extractStringList(item.to) : [];
        if (eventTypes.length === 0 && matchingEventCondIdx >= 0) {
          absorbedConditionIndices.add(matchingEventCondIdx);
          eventTypes = extractStringList(rawConditions[matchingEventCondIdx]!.state);
        }
        triggers.push({
          id,
          kind: 'button_event',
          entityId,
          eventTypes: eventTypes.length > 0 ? eventTypes : ['short_release'],
        });
        continue;
      }
      const forSeconds = parseDurationSeconds(item.for);
      triggers.push({
        id,
        kind: 'device',
        entityId,
        toState: String(item.to ?? 'on'),
        ...(forSeconds ? { forSeconds } : {}),
      });
      continue;
    }
    if (type === 'numeric_state') {
      triggers.push({
        id,
        kind: 'threshold',
        entityId: extractEntityIds(item)[0] ?? '',
        ...(typeof item.above === 'number' ? { above: item.above } : {}),
        ...(typeof item.below === 'number' ? { below: item.below } : {}),
      });
      continue;
    }
    triggers.push({
      id,
      kind: 'raw',
      raw: item,
      summary: `${type || 'Custom trigger'}${typeof item.event_type === 'string' ? ` (${item.event_type})` : ''}`,
    });
  }

  const conditions: AutomationConditionBlock[] = rawConditions
    .filter((_, idx) => !absorbedConditionIndices.has(idx))
    .map(parseConditionBlock);

  const rawActions = asAutomationRecordList(config.actions ?? config.action);
  const steps: AutomationActionStep[] = [];
  for (let i = 0; i < rawActions.length; i += 1) {
    const item = rawActions[i]!;
    const id = `do-${steps.length}`;
    if (item.delay !== undefined) {
      steps.push({ id, kind: 'wait', seconds: parseDurationSeconds(item.delay) ?? 5 });
      continue;
    }
    const service = String(item.action ?? item.service ?? '');
    const entityIds = extractEntityIds(item);
    if (service === 'scene.turn_on' && entityIds.length === 1) {
      steps.push({ id, kind: 'activate_scene', sceneEntityId: entityIds[0]! });
      continue;
    }
    const parsedTargets = parseDeviceActionTargets(item);
    if (parsedTargets) {
      const prev = steps[steps.length - 1];
      const overlapping =
        prev?.kind === 'control_devices' &&
        Object.keys(parsedTargets).some((entityId) => entityId in prev.targets);
      if (prev?.kind === 'control_devices' && !overlapping) {
        steps[steps.length - 1] = { ...prev, targets: { ...prev.targets, ...parsedTargets } };
      } else {
        steps.push({ id, kind: 'control_devices', targets: parsedTargets });
      }
      continue;
    }
    steps.push({
      id,
      kind: 'service',
      service: service || 'homeassistant.turn_on',
      entityId: entityIds[0] ?? '',
      ...(asRecord(item.data) ? { data: asRecord(item.data) } : {}),
      raw: item,
    });
  }

  const knownKeys = new Set([
    'alias',
    'description',
    'mode',
    'triggers',
    'trigger',
    'conditions',
    'condition',
    'actions',
    'action',
  ]);
  const preservedExtra = Object.fromEntries(
    Object.entries(config).filter(([key]) => !knownKeys.has(key)),
  );
  const rawMode = String(config.mode ?? 'single');
  const mode: AutomationRunMode =
    rawMode === 'restart' || rawMode === 'queued' || rawMode === 'parallel' ? rawMode : 'single';

  return {
    alias: typeof config.alias === 'string' ? config.alias : '',
    description: typeof config.description === 'string' ? config.description : '',
    mode,
    triggers,
    conditionLogic,
    conditions,
    steps,
    preservedExtra,
  };
}

export function compileAutomationFlow(
  draft: AutomationFlowDraft,
  options?: CompileAutomationFlowOptions,
): EditableConfig {
  const targetPlatform = options?.targetPlatform ?? 'hub';
  const extraConditions: Record<string, unknown>[] = [];
  const triggers: Record<string, unknown>[] = [];

  for (const trigger of draft.triggers) {
    if (trigger.kind === 'time') {
      if (trigger.weekdays.length > 0 && trigger.weekdays.length < 7) {
        extraConditions.push({ condition: 'time', weekday: [...trigger.weekdays] });
      }
      triggers.push({ trigger: 'time', at: toFullTime(trigger.at) });
      continue;
    }
    if (trigger.kind === 'sun') {
      const offset = formatOffsetString(trigger.offsetMinutes);
      triggers.push({ trigger: 'sun', event: trigger.event, ...(offset ? { offset } : {}) });
      continue;
    }
    if (trigger.kind === 'button_event') {
      const gestures = trigger.eventTypes.length > 0 ? [...trigger.eventTypes] : ['short_release'];
      if (targetPlatform === 'ha') {
        if (trigger.haDeviceTrigger) {
          for (const gesture of gestures) {
            triggers.push({
              trigger: 'device',
              domain: trigger.haDeviceTrigger.domain,
              device_id: trigger.haDeviceTrigger.deviceId,
              type: gesture,
              ...(trigger.haDeviceTrigger.subtype !== undefined
                ? { subtype: trigger.haDeviceTrigger.subtype }
                : {}),
            });
          }
        } else {
          triggers.push({
            trigger: 'state',
            entity_id: trigger.entityId,
            not_from: ['unavailable', 'unknown'],
          });
          if (draft.triggers.length === 1 && gestures.length > 0) {
            extraConditions.push({
              condition: 'state',
              entity_id: trigger.entityId,
              attribute: 'event_type',
              state: gestures.length === 1 ? gestures[0]! : gestures,
            });
          }
        }
      } else if (trigger.haDeviceTrigger && !trigger.entityId) {
        for (const gesture of gestures) {
          triggers.push({
            trigger: 'device',
            domain: trigger.haDeviceTrigger.domain,
            device_id: trigger.haDeviceTrigger.deviceId,
            type: gesture,
            ...(trigger.haDeviceTrigger.subtype !== undefined
              ? { subtype: trigger.haDeviceTrigger.subtype }
              : {}),
          });
        }
      } else {
        triggers.push({
          trigger: 'event.received',
          target: { entity_id: trigger.entityId },
          options: { event_type: gestures },
        });
      }
      continue;
    }
    if (trigger.kind === 'bus_event') {
      const eventType = trigger.eventType.trim() || 'hue_event';
      const dataEntries = Object.entries(trigger.eventData).filter(
        ([k, v]) => k.trim().length > 0 && String(v).trim().length > 0,
      );
      triggers.push({
        trigger: 'event',
        event_type: eventType,
        ...(dataEntries.length > 0 ? { event_data: Object.fromEntries(dataEntries) } : {}),
      });
      continue;
    }
    if (trigger.kind === 'device') {
      triggers.push({
        trigger: 'state',
        entity_id: trigger.entityId,
        to: trigger.toState,
        ...(trigger.forSeconds && trigger.forSeconds > 0
          ? { for: formatDelayObject(trigger.forSeconds) }
          : {}),
      });
      continue;
    }
    if (trigger.kind === 'threshold') {
      triggers.push({
        trigger: 'numeric_state',
        entity_id: trigger.entityId,
        ...(trigger.above !== undefined ? { above: trigger.above } : {}),
        ...(trigger.below !== undefined ? { below: itemBelow(trigger.below) } : {}),
      });
      continue;
    }
    triggers.push(trigger.raw);
  }

  const explicitConditions = draft.conditions.map(compileConditionBlock);
  const allConditions =
    draft.conditionLogic === 'any' && explicitConditions.length > 1
      ? [...extraConditions, { condition: 'or', conditions: explicitConditions }]
      : [...extraConditions, ...explicitConditions];

  const actions = draft.steps.flatMap((step): Record<string, unknown>[] => {
    if (step.kind === 'control_devices') {
      return Object.entries(step.targets).flatMap(([entityId, target]) =>
        compileTargetToActions(entityId, target),
      );
    }
    if (step.kind === 'activate_scene') {
      return [{ action: 'scene.turn_on', target: { entity_id: step.sceneEntityId } }];
    }
    if (step.kind === 'wait') {
      return [{ delay: formatDelayObject(step.seconds) }];
    }
    if (
      step.raw &&
      step.raw.action === step.service &&
      extractEntityIds(step.raw)[0] === step.entityId
    ) {
      return [step.raw];
    }
    return [
      {
        action: step.service,
        ...(step.entityId ? { target: { entity_id: step.entityId } } : {}),
        ...(step.data && Object.keys(step.data).length > 0 ? { data: step.data } : {}),
      },
    ];
  });

  return {
    ...draft.preservedExtra,
    alias: draft.alias,
    description: draft.description.trim(),
    triggers,
    conditions: allConditions,
    actions,
    mode: draft.mode,
  };
}

function itemBelow(v: number): number {
  return v;
}
