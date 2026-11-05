/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  ActionStep,
  AutomationCondition,
  AutomationTrigger,
  ChooseStep,
  DelayStep,
  ExecutionMode,
  HausAutomationRule,
  RepeatStep,
  ScriptAction,
  ScriptStep,
} from '@haus/core/automation';
import { miredsToKelvin } from '@haus/core/device';
import type { HaAutomationDefinition, MigrationItem } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseDurationMs(input: unknown): number {
  if (typeof input === 'number') {
    return input > 1000 ? input : input * 1000;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const isNegative = trimmed.startsWith('-');
    const clean = trimmed.replace(/^[+-]/, '');
    const parts = clean.split(':').map((p) => Number.parseFloat(p));
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    const s = parts[2] ?? 0;
    const totalMs = (h * 3600 + m * 60 + s) * 1000;
    return isNegative ? -totalMs : totalMs;
  }
  if (isRecord(input)) {
    const h = typeof input.hours === 'number' ? input.hours : 0;
    const m = typeof input.minutes === 'number' ? input.minutes : 0;
    const s = typeof input.seconds === 'number' ? input.seconds : 0;
    const ms = typeof input.milliseconds === 'number' ? input.milliseconds : 0;
    return (h * 3600 + m * 60 + s) * 1000 + ms;
  }
  return 0;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function convertTrigger(t: unknown, unsupported: string[]): AutomationTrigger | undefined {
  if (!isRecord(t)) return undefined;
  const platform = String(t.platform ?? t.trigger ?? '');

  switch (platform) {
    case 'state': {
      const entityId = String(t.entity_id ?? '');
      if (!entityId) {
        unsupported.push('State trigger missing entity_id.');
        return undefined;
      }
      return {
        type: 'state',
        endpointId: entityId,
        property: typeof t.attribute === 'string' ? t.attribute : undefined,
        from: t.from,
        to: t.to,
        forDurationSeconds: t.for ? parseDurationMs(t.for) / 1000 : undefined,
      };
    }
    case 'sun': {
      const event = String(t.event ?? 'sunset') as 'sunrise' | 'sunset';
      const offset = t.offset ? Math.round(parseDurationMs(t.offset) / 60000) : undefined;
      return {
        type: 'time',
        sun: event === 'sunrise' ? 'sunrise' : 'sunset',
        offsetMinutes: offset,
      };
    }
    case 'time': {
      return {
        type: 'time',
        at: typeof t.at === 'string' ? t.at : undefined,
      };
    }
    case 'numeric_state': {
      const entityId = String(t.entity_id ?? '');
      if (!entityId) {
        unsupported.push('Numeric state trigger missing entity_id.');
        return undefined;
      }
      return {
        type: 'numeric_state',
        endpointId: entityId,
        property: typeof t.attribute === 'string' ? t.attribute : 'state',
        above: typeof t.above === 'number' ? t.above : undefined,
        below: typeof t.below === 'number' ? t.below : undefined,
        forDurationSeconds: t.for ? parseDurationMs(t.for) / 1000 : undefined,
      };
    }
    case 'event': {
      const eventType = String(t.event_type ?? '');
      if (!eventType) {
        unsupported.push('Event trigger missing event_type.');
        return undefined;
      }
      return {
        type: 'event',
        eventType,
        data: isRecord(t.event_data) ? t.event_data : undefined,
      };
    }
    default:
      unsupported.push(`Unsupported trigger platform: "${platform}".`);
      return undefined;
  }
}

function convertCondition(c: unknown, unsupported: string[]): AutomationCondition | undefined {
  if (!isRecord(c)) return undefined;
  const conditionType = String(c.condition ?? '');

  switch (conditionType) {
    case 'state': {
      const entityId = String(c.entity_id ?? '');
      if (!entityId) {
        unsupported.push('State condition missing entity_id.');
        return undefined;
      }
      return {
        type: 'state',
        endpointId: entityId,
        property: typeof c.attribute === 'string' ? c.attribute : 'state',
        operator: '==',
        value: c.state,
      };
    }
    case 'numeric_state': {
      const entityId = String(c.entity_id ?? '');
      if (!entityId) {
        unsupported.push('Numeric condition missing entity_id.');
        return undefined;
      }
      const prop = typeof c.attribute === 'string' ? c.attribute : 'state';
      if (typeof c.above === 'number') {
        return {
          type: 'state',
          endpointId: entityId,
          property: prop,
          operator: '>',
          value: c.above,
        };
      }
      if (typeof c.below === 'number') {
        return {
          type: 'state',
          endpointId: entityId,
          property: prop,
          operator: '<',
          value: c.below,
        };
      }
      return undefined;
    }
    case 'time': {
      return {
        type: 'time',
        after: typeof c.after === 'string' ? c.after : undefined,
        before: typeof c.before === 'string' ? c.before : undefined,
        weekdays: Array.isArray(c.weekday)
          ? c.weekday.map((w: string | number) => (typeof w === 'number' ? w : 0))
          : undefined,
      };
    }
    case 'and':
    case 'or':
    case 'not': {
      const inner = Array.isArray(c.conditions)
        ? c.conditions
            .map((sub) => convertCondition(sub, unsupported))
            .filter((x): x is AutomationCondition => Boolean(x))
        : [];
      return {
        type: conditionType,
        conditions: inner,
      };
    }
    default:
      unsupported.push(`Unsupported condition type: "${conditionType}".`);
      return undefined;
  }
}

function convertAction(a: unknown, unsupported: string[]): ScriptStep | undefined {
  if (!isRecord(a)) return undefined;

  // 1. Delay
  if (a.delay !== undefined) {
    const durationMs = parseDurationMs(a.delay);
    const step: DelayStep = { type: 'delay', durationMs };
    return step;
  }

  // 2. Choose
  if (Array.isArray(a.choose)) {
    const branches = a.choose.map((branch: unknown) => {
      if (!isRecord(branch)) return { conditions: [], steps: [] };
      const conds = Array.isArray(branch.conditions)
        ? branch.conditions
            .map((c) => convertCondition(c, unsupported))
            .filter((x): x is AutomationCondition => Boolean(x))
        : [];
      const steps = Array.isArray(branch.sequence)
        ? branch.sequence
            .map((s) => convertAction(s, unsupported))
            .filter((x): x is ScriptStep => Boolean(x))
        : [];
      return { conditions: conds, steps };
    });

    const defaultSteps = Array.isArray(a.default)
      ? a.default
          .map((s) => convertAction(s, unsupported))
          .filter((x): x is ScriptStep => Boolean(x))
      : undefined;

    const step: ChooseStep = {
      type: 'choose',
      branches,
      defaultSteps,
    };
    return step;
  }

  // 3. Repeat
  if (isRecord(a.repeat)) {
    const innerSteps = Array.isArray(a.repeat.sequence)
      ? a.repeat.sequence
          .map((s) => convertAction(s, unsupported))
          .filter((x): x is ScriptStep => Boolean(x))
      : [];
    const step: RepeatStep = {
      type: 'repeat',
      count: typeof a.repeat.count === 'number' ? a.repeat.count : undefined,
      steps: innerSteps,
    };
    return step;
  }

  // 4. Service Call
  const service = String(a.service ?? a.action ?? '');
  if (!service) {
    unsupported.push('Action missing service / action field.');
    return undefined;
  }

  const [domain, actionName] = service.split('.');
  const target = isRecord(a.target) ? a.target : {};
  const data = isRecord(a.data) ? a.data : {};
  const entityId = String(target.entity_id ?? data.entity_id ?? a.entity_id ?? '');

  if (domain === 'scene') {
    const action: ScriptAction = {
      kind: 'activate_scene',
      payload: { sceneId: entityId || 'scene.unspecified' },
    };
    const step: ActionStep = { type: 'action', action };
    return step;
  }

  if (domain === 'script') {
    const action: ScriptAction = {
      kind: 'call_script',
      payload: { scriptId: entityId || `script.${actionName}` },
    };
    const step: ActionStep = { type: 'action', action };
    return step;
  }

  if (domain === 'notify') {
    const action: ScriptAction = {
      kind: 'send_notification',
      payload: {
        title: String(data.title ?? 'Home Notification'),
        message: String(data.message ?? ''),
      },
    };
    const step: ActionStep = { type: 'action', action };
    return step;
  }

  // Standard device command (light, switch, lock, cover, fan, etc.)
  const params: Record<string, unknown> = { ...data };
  delete params.entity_id;

  // Convert Kelvin / Mireds if specified in HA format
  if (typeof params.color_temp === 'number') {
    // HA color_temp is in Mireds (153-500) -> convert to Haus absolute Kelvin
    params.color_temp = miredsToKelvin(params.color_temp);
  }

  const action: ScriptAction = {
    kind: 'device_command',
    payload: {
      endpointId: entityId || 'device.unspecified',
      capability: domain || 'generic',
      command: actionName || 'execute',
      parameters: Object.keys(params).length > 0 ? params : undefined,
    },
  };

  const step: ActionStep = { type: 'action', action };
  return step;
}

export function convertHaAutomation(input: unknown): MigrationItem {
  if (!isRecord(input)) {
    return {
      haId: 'unknown',
      haAlias: 'Unknown',
      status: 'unsupported',
      unsupportedReasons: ['Input is not an automation object.'],
    };
  }

  const auto = input as HaAutomationDefinition;
  const haId = String(auto.id || `auto_${Date.now()}`);
  const haAlias = String(auto.alias || haId);
  const unsupported: string[] = [];

  // Triggers
  const rawTriggers = Array.isArray(auto.trigger)
    ? auto.trigger
    : auto.trigger
      ? [auto.trigger]
      : [];
  const triggers: AutomationTrigger[] = [];

  for (const t of rawTriggers) {
    const converted = convertTrigger(t, unsupported);
    if (converted) triggers.push(converted);
  }

  if (triggers.length === 0) {
    unsupported.push('No supported triggers found in automation.');
  }

  // Conditions
  const rawConditions = Array.isArray(auto.condition)
    ? auto.condition
    : auto.condition
      ? [auto.condition]
      : [];
  const conditions: AutomationCondition[] = [];

  for (const c of rawConditions) {
    const converted = convertCondition(c, unsupported);
    if (converted) conditions.push(converted);
  }

  // Actions
  const rawActions = Array.isArray(auto.action) ? auto.action : auto.action ? [auto.action] : [];
  const actions: ScriptStep[] = [];

  for (const a of rawActions) {
    const converted = convertAction(a, unsupported);
    if (converted) actions.push(converted);
  }

  if (actions.length === 0) {
    unsupported.push('No supported actions found in automation.');
  }

  if (unsupported.length > 0) {
    return {
      haId,
      haAlias,
      status: 'unsupported',
      unsupportedReasons: unsupported,
    };
  }

  const hausId = `automation.ha_${slugify(haAlias)}`;
  const mode =
    auto.mode === 'restart' || auto.mode === 'queued' || auto.mode === 'parallel'
      ? (auto.mode as ExecutionMode)
      : 'single';

  const hausRule: HausAutomationRule = {
    schemaVersion: 1,
    id: hausId,
    name: haAlias,
    description: auto.description || `Migrated from Home Assistant (${haId})`,
    enabled: auto.initial_state ?? true,
    mode,
    triggers,
    conditions: conditions.length > 0 ? conditions : undefined,
    actions,
  };

  return {
    haId,
    haAlias,
    status: 'supported',
    hausRule,
  };
}
