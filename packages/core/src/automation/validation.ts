/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  ActionStep,
  AutomationCondition,
  AutomationTrigger,
  ChooseStep,
  ConditionOperator,
  ConditionStep,
  DelayStep,
  ExecutionMode,
  HausAutomationRule,
  HausScene,
  HausScript,
  ParallelStep,
  RepeatStep,
  SceneMemberState,
  ScriptAction,
  ScriptStep,
  SequenceStep,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Validation error: field "${field}" must be a non-empty string.`);
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Validation error: field "${field}" must be a valid number.`);
  }
}

function assertArray<T>(value: unknown, field: string): asserts value is readonly T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Validation error: field "${field}" must be an array.`);
  }
}

export function validateSceneMember(input: unknown, index: number): SceneMemberState {
  if (!isRecord(input)) {
    throw new Error(`Validation error: scene member at index ${index} must be an object.`);
  }
  assertString(input.endpointId, `members[${index}].endpointId`);
  if (!isRecord(input.targetState)) {
    throw new Error(`Validation error: members[${index}].targetState must be an object.`);
  }
  if (input.transitionSeconds !== undefined) {
    assertNumber(input.transitionSeconds, `members[${index}].transitionSeconds`);
    if (input.transitionSeconds < 0) {
      throw new Error(`Validation error: members[${index}].transitionSeconds must be >= 0.`);
    }
  }

  return {
    endpointId: input.endpointId,
    targetState: input.targetState,
    transitionSeconds: input.transitionSeconds as number | undefined,
  };
}

export function validateScene(input: unknown): HausScene {
  if (!isRecord(input)) {
    throw new Error('Validation error: scene must be an object.');
  }
  if (input.schemaVersion !== 1) {
    throw new Error(`Validation error: unsupported schemaVersion ${String(input.schemaVersion)}, expected 1.`);
  }
  assertString(input.id, 'id');
  assertString(input.name, 'name');
  assertArray(input.members, 'members');

  const members = input.members.map((m, i) => validateSceneMember(m, i));

  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    description: typeof input.description === 'string' ? input.description : undefined,
    icon: typeof input.icon === 'string' ? input.icon : undefined,
    roomId: typeof input.roomId === 'string' ? input.roomId : undefined,
    members,
    metadata: isRecord(input.metadata) ? input.metadata : undefined,
  };
}

export function validateScriptAction(input: unknown): ScriptAction {
  if (!isRecord(input)) {
    throw new Error('Validation error: action must be an object.');
  }
  assertString(input.kind, 'action.kind');

  switch (input.kind) {
    case 'device_command': {
      if (!isRecord(input.payload)) throw new Error('Action payload must be an object.');
      assertString(input.payload.endpointId, 'action.payload.endpointId');
      assertString(input.payload.capability, 'action.payload.capability');
      assertString(input.payload.command, 'action.payload.command');
      return {
        kind: 'device_command',
        payload: {
          endpointId: input.payload.endpointId,
          capability: input.payload.capability,
          command: input.payload.command,
          parameters: isRecord(input.payload.parameters) ? input.payload.parameters : undefined,
        },
      };
    }
    case 'activate_scene': {
      if (!isRecord(input.payload)) throw new Error('Action payload must be an object.');
      assertString(input.payload.sceneId, 'action.payload.sceneId');
      return {
        kind: 'activate_scene',
        payload: { sceneId: input.payload.sceneId },
      };
    }
    case 'call_script': {
      if (!isRecord(input.payload)) throw new Error('Action payload must be an object.');
      assertString(input.payload.scriptId, 'action.payload.scriptId');
      return {
        kind: 'call_script',
        payload: {
          scriptId: input.payload.scriptId,
          parameters: isRecord(input.payload.parameters) ? input.payload.parameters : undefined,
        },
      };
    }
    case 'send_notification': {
      if (!isRecord(input.payload)) throw new Error('Action payload must be an object.');
      assertString(input.payload.title, 'action.payload.title');
      assertString(input.payload.message, 'action.payload.message');
      return {
        kind: 'send_notification',
        payload: {
          title: input.payload.title,
          message: input.payload.message,
          priority: input.payload.priority as 'normal' | 'high' | 'critical' | undefined,
          actionKeys: Array.isArray(input.payload.actionKeys)
            ? (input.payload.actionKeys.filter((k): k is string => typeof k === 'string'))
            : undefined,
        },
      };
    }
    case 'custom': {
      assertString(input.customType, 'action.customType');
      if (!isRecord(input.payload)) throw new Error('Action payload must be an object.');
      return {
        kind: 'custom',
        customType: input.customType,
        payload: input.payload,
      };
    }
    default:
      throw new Error(`Validation error: unknown action kind "${input.kind}".`);
  }
}

export function validateCondition(input: unknown): AutomationCondition {
  if (!isRecord(input)) {
    throw new Error('Validation error: condition must be an object.');
  }
  assertString(input.type, 'condition.type');

  switch (input.type) {
    case 'state': {
      assertString(input.endpointId, 'condition.endpointId');
      assertString(input.property, 'condition.property');
      assertString(input.operator, 'condition.operator');
      const validOps = ['==', '!=', '>', '<', '>=', '<=', 'in', 'not_in'];
      if (!validOps.includes(input.operator)) {
        throw new Error(`Validation error: invalid condition operator "${input.operator}".`);
      }
      return {
        type: 'state',
        endpointId: input.endpointId,
        property: input.property,
        operator: input.operator as ConditionOperator,
        value: input.value,
      };
    }
    case 'time': {
      return {
        type: 'time',
        after: typeof input.after === 'string' ? input.after : undefined,
        before: typeof input.before === 'string' ? input.before : undefined,
        weekdays: Array.isArray(input.weekdays)
          ? input.weekdays.filter((d): d is number => typeof d === 'number')
          : undefined,
      };
    }
    case 'and':
    case 'or':
    case 'not': {
      assertArray(input.conditions, 'condition.conditions');
      return {
        type: input.type,
        conditions: input.conditions.map((c) => validateCondition(c)),
      };
    }
    default:
      throw new Error(`Validation error: unknown condition type "${input.type}".`);
  }
}

export function validateScriptStep(input: unknown, path: string = 'step'): ScriptStep {
  if (!isRecord(input)) {
    throw new Error(`Validation error: ${path} must be an object.`);
  }
  assertString(input.type, `${path}.type`);

  switch (input.type) {
    case 'action': {
      const action = validateScriptAction(input.action);
      const step: ActionStep = {
        type: 'action',
        action,
        timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
        continueOnError: Boolean(input.continueOnError),
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    case 'condition': {
      const condition = validateCondition(input.condition);
      const step: ConditionStep = {
        type: 'condition',
        condition,
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    case 'delay': {
      assertNumber(input.durationMs, `${path}.durationMs`);
      if (input.durationMs < 0) throw new Error(`${path}.durationMs must be >= 0.`);
      const step: DelayStep = {
        type: 'delay',
        durationMs: input.durationMs,
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    case 'sequence': {
      assertArray(input.steps, `${path}.steps`);
      const step: SequenceStep = {
        type: 'sequence',
        steps: input.steps.map((s, idx) => validateScriptStep(s, `${path}.steps[${idx}]`)),
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    case 'parallel': {
      assertArray(input.steps, `${path}.steps`);
      const step: ParallelStep = {
        type: 'parallel',
        steps: input.steps.map((s, idx) => validateScriptStep(s, `${path}.steps[${idx}]`)),
        maxConcurrency: typeof input.maxConcurrency === 'number' ? input.maxConcurrency : undefined,
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    case 'repeat': {
      assertArray(input.steps, `${path}.steps`);
      const step: RepeatStep = {
        type: 'repeat',
        count: typeof input.count === 'number' ? input.count : undefined,
        whileCondition: input.whileCondition ? validateCondition(input.whileCondition) : undefined,
        steps: input.steps.map((s, idx) => validateScriptStep(s, `${path}.steps[${idx}]`)),
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    case 'choose': {
      assertArray(input.branches, `${path}.branches`);
      const branches = input.branches.map((b, bIdx) => {
        if (!isRecord(b)) throw new Error(`${path}.branches[${bIdx}] must be an object.`);
        assertArray(b.conditions, `${path}.branches[${bIdx}].conditions`);
        assertArray(b.steps, `${path}.branches[${bIdx}].steps`);
        return {
          conditions: b.conditions.map((c) => validateCondition(c)),
          steps: b.steps.map((s, sIdx) =>
            validateScriptStep(s, `${path}.branches[${bIdx}].steps[${sIdx}]`),
          ),
        };
      });
      const step: ChooseStep = {
        type: 'choose',
        branches,
        defaultSteps: Array.isArray(input.defaultSteps)
          ? input.defaultSteps.map((s, sIdx) =>
              validateScriptStep(s, `${path}.defaultSteps[${sIdx}]`),
            )
          : undefined,
        description: typeof input.description === 'string' ? input.description : undefined,
      };
      return step;
    }
    default:
      throw new Error(`Validation error: unknown step type "${input.type}".`);
  }
}

export function validateScript(input: unknown): HausScript {
  if (!isRecord(input)) {
    throw new Error('Validation error: script must be an object.');
  }
  if (input.schemaVersion !== 1) {
    throw new Error(`Validation error: unsupported schemaVersion ${String(input.schemaVersion)}, expected 1.`);
  }
  assertString(input.id, 'id');
  assertString(input.name, 'name');
  assertArray(input.steps, 'steps');

  const steps = input.steps.map((s, idx) => validateScriptStep(s, `steps[${idx}]`));

  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    description: typeof input.description === 'string' ? input.description : undefined,
    icon: typeof input.icon === 'string' ? input.icon : undefined,
    mode: typeof input.mode === 'string' ? (input.mode as ExecutionMode) : undefined,
    maxRuns: typeof input.maxRuns === 'number' ? input.maxRuns : undefined,
    steps,
    metadata: isRecord(input.metadata) ? input.metadata : undefined,
  };
}

export function validateTrigger(input: unknown, index: number): AutomationTrigger {
  if (!isRecord(input)) {
    throw new Error(`Validation error: trigger[${index}] must be an object.`);
  }
  assertString(input.type, `triggers[${index}].type`);

  switch (input.type) {
    case 'state': {
      assertString(input.endpointId, `triggers[${index}].endpointId`);
      return {
        type: 'state',
        endpointId: input.endpointId,
        property: typeof input.property === 'string' ? input.property : undefined,
        from: input.from,
        to: input.to,
        forDurationSeconds:
          typeof input.forDurationSeconds === 'number' ? input.forDurationSeconds : undefined,
      };
    }
    case 'event': {
      assertString(input.eventType, `triggers[${index}].eventType`);
      return {
        type: 'event',
        eventType: input.eventType,
        endpointId: typeof input.endpointId === 'string' ? input.endpointId : undefined,
        data: isRecord(input.data) ? input.data : undefined,
      };
    }
    case 'time': {
      return {
        type: 'time',
        at: typeof input.at === 'string' ? input.at : undefined,
        cron: typeof input.cron === 'string' ? input.cron : undefined,
        sun: input.sun as 'sunrise' | 'sunset' | undefined,
        offsetMinutes: typeof input.offsetMinutes === 'number' ? input.offsetMinutes : undefined,
      };
    }
    case 'numeric_state': {
      assertString(input.endpointId, `triggers[${index}].endpointId`);
      assertString(input.property, `triggers[${index}].property`);
      return {
        type: 'numeric_state',
        endpointId: input.endpointId,
        property: input.property,
        above: typeof input.above === 'number' ? input.above : undefined,
        below: typeof input.below === 'number' ? input.below : undefined,
        forDurationSeconds:
          typeof input.forDurationSeconds === 'number' ? input.forDurationSeconds : undefined,
      };
    }
    default:
      throw new Error(`Validation error: unknown trigger type "${input.type}".`);
  }
}

export function validateAutomation(input: unknown): HausAutomationRule {
  if (!isRecord(input)) {
    throw new Error('Validation error: automation rule must be an object.');
  }
  if (input.schemaVersion !== 1) {
    throw new Error(`Validation error: unsupported schemaVersion ${String(input.schemaVersion)}, expected 1.`);
  }
  assertString(input.id, 'id');
  assertString(input.name, 'name');
  if (typeof input.enabled !== 'boolean') {
    throw new Error('Validation error: field "enabled" must be a boolean.');
  }
  assertArray(input.triggers, 'triggers');
  assertArray(input.actions, 'actions');

  const triggers = input.triggers.map((t, idx) => validateTrigger(t, idx));
  const conditions = Array.isArray(input.conditions)
    ? input.conditions.map((c) => validateCondition(c))
    : undefined;
  const actions = input.actions.map((a, idx) => validateScriptStep(a, `actions[${idx}]`));

  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    description: typeof input.description === 'string' ? input.description : undefined,
    enabled: input.enabled,
    mode: typeof input.mode === 'string' ? (input.mode as ExecutionMode) : undefined,
    maxRuns: typeof input.maxRuns === 'number' ? input.maxRuns : undefined,
    triggers,
    conditions,
    actions,
    metadata: isRecord(input.metadata) ? input.metadata : undefined,
  };
}
