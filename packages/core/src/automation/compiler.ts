/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AutomationEvaluationContext } from './evaluator.js';
import type {
  AutomationCondition,
  AutomationTrigger,
  ConditionOperator,
  ExecutionMode,
  HausAutomationRule,
  HausScript,
  ScriptStep,
} from './types.js';

export type CompiledCondition = (ctx: AutomationEvaluationContext) => boolean;

function fastCompare(actual: unknown, operator: ConditionOperator, expected: unknown): boolean {
  switch (operator) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '<':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '>=':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case '<=':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    default:
      return false;
  }
}

function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map((p) => Number.parseInt(p, 10));
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

export function compileCondition(cond: AutomationCondition): CompiledCondition {
  switch (cond.type) {
    case 'state': {
      const endpointId = cond.endpointId;
      const property = cond.property;
      const op = cond.operator;
      const expected = cond.value;
      return (ctx) => {
        const actual = ctx.getEndpointState(endpointId, property);
        return fastCompare(actual, op, expected);
      };
    }
    case 'time': {
      const afterSec = cond.after ? parseTimeToSeconds(cond.after) : undefined;
      const beforeSec = cond.before ? parseTimeToSeconds(cond.before) : undefined;
      const weekdays = cond.weekdays;
      return (ctx) => {
        const now = ctx.now();
        if (weekdays && !weekdays.includes(now.getDay())) return false;
        const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        if (afterSec !== undefined && currentSeconds < afterSec) return false;
        if (beforeSec !== undefined && currentSeconds > beforeSec) return false;
        return true;
      };
    }
    case 'and': {
      const compiled = cond.conditions.map((c) => compileCondition(c));
      return (ctx) => {
        for (let i = 0; i < compiled.length; i++) {
          const fn = compiled[i];
          if (fn && !fn(ctx)) return false;
        }
        return true;
      };
    }
    case 'or': {
      const compiled = cond.conditions.map((c) => compileCondition(c));
      return (ctx) => {
        for (let i = 0; i < compiled.length; i++) {
          const fn = compiled[i];
          if (fn && fn(ctx)) return true;
        }
        return false;
      };
    }
    case 'not': {
      const compiled = cond.conditions.map((c) => compileCondition(c));
      return (ctx) => {
        for (let i = 0; i < compiled.length; i++) {
          const fn = compiled[i];
          if (fn && fn(ctx)) return false;
        }
        return true;
      };
    }
  }
}

export interface CompiledAutomationRule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly mode?: ExecutionMode;
  readonly maxRuns?: number;
  readonly triggers: readonly AutomationTrigger[];
  readonly conditionCheck: CompiledCondition;
  readonly actions: readonly ScriptStep[];
  readonly syntheticScript: HausScript;
}

export function compileRule(rule: HausAutomationRule): CompiledAutomationRule {
  let conditionCheck: CompiledCondition = () => true;

  if (rule.conditions && rule.conditions.length > 0) {
    if (rule.conditions.length === 1) {
      const first = rule.conditions[0];
      if (first) {
        conditionCheck = compileCondition(first);
      }
    } else {
      const compiledAll = rule.conditions.map((c) => compileCondition(c));
      conditionCheck = (ctx) => {
        for (let i = 0; i < compiledAll.length; i++) {
          const fn = compiledAll[i];
          if (fn && !fn(ctx)) return false;
        }
        return true;
      };
    }
  }

  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    mode: rule.mode,
    maxRuns: rule.maxRuns,
    triggers: rule.triggers,
    conditionCheck,
    actions: rule.actions,
    syntheticScript: {
      schemaVersion: 1,
      id: rule.id,
      name: rule.name,
      mode: rule.mode,
      maxRuns: rule.maxRuns,
      steps: rule.actions,
    },
  };
}
