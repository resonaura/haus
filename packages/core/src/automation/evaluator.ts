/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  AutomationCondition,
  AutomationTrigger,
  ConditionOperator,
  StateCondition,
  TimeCondition,
} from './types.js';

export interface AutomationEvaluationContext {
  getEndpointState(endpointId: string, property: string): unknown;
  now(): Date;
}

export interface TriggerEvent {
  readonly type: 'state' | 'event' | 'time' | 'numeric_state';
  readonly endpointId?: string;
  readonly property?: string;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly value?: unknown;
  readonly eventType?: string;
  readonly data?: Record<string, unknown>;
}

function compareValues(actual: unknown, operator: ConditionOperator, expected: unknown): boolean {
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
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function evaluateTimeCondition(condition: TimeCondition, now: Date): boolean {
  if (condition.weekdays && !condition.weekdays.includes(now.getDay())) {
    return false;
  }

  const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  if (condition.after) {
    const afterSec = parseTimeToSeconds(condition.after);
    if (currentSeconds < afterSec) return false;
  }

  if (condition.before) {
    const beforeSec = parseTimeToSeconds(condition.before);
    if (currentSeconds > beforeSec) return false;
  }

  return true;
}

function evaluateStateCondition(
  condition: StateCondition,
  context: AutomationEvaluationContext,
): boolean {
  const actual = context.getEndpointState(condition.endpointId, condition.property);
  return compareValues(actual, condition.operator, condition.value);
}

export function evaluateCondition(
  condition: AutomationCondition,
  context: AutomationEvaluationContext,
): boolean {
  switch (condition.type) {
    case 'state':
      return evaluateStateCondition(condition, context);
    case 'time':
      return evaluateTimeCondition(condition, context.now());
    case 'and':
      return condition.conditions.every((c) => evaluateCondition(c, context));
    case 'or':
      return condition.conditions.some((c) => evaluateCondition(c, context));
    case 'not':
      return !condition.conditions.some((c) => evaluateCondition(c, context));
    default:
      return false;
  }
}

export function matchesTrigger(
  trigger: AutomationTrigger,
  event: TriggerEvent,
  resolveEndpointId?: (id: string) => string,
): boolean {
  if (trigger.type !== event.type) return false;

  const matchEp = (targetId?: string, eventId?: string): boolean => {
    if (!targetId || !eventId) return false;
    if (targetId === eventId) return true;
    return (
      Boolean(resolveEndpointId) && resolveEndpointId!(targetId) === resolveEndpointId!(eventId)
    );
  };

  switch (trigger.type) {
    case 'state': {
      if (!matchEp(trigger.endpointId, event.endpointId)) return false;
      if (trigger.property && trigger.property !== event.property) return false;
      if (trigger.from !== undefined && trigger.from !== event.from) return false;
      if (trigger.to !== undefined && trigger.to !== event.to) return false;
      return true;
    }
    case 'event': {
      if (trigger.eventType !== event.eventType) return false;
      if (trigger.endpointId && !matchEp(trigger.endpointId, event.endpointId)) return false;
      if (trigger.data && event.data) {
        for (const [key, val] of Object.entries(trigger.data)) {
          if (event.data[key] !== val) return false;
        }
      }
      return true;
    }
    case 'numeric_state': {
      if (!matchEp(trigger.endpointId, event.endpointId)) return false;
      if (trigger.property !== event.property) return false;
      if (typeof event.value !== 'number') return false;
      if (trigger.above !== undefined && event.value <= trigger.above) return false;
      if (trigger.below !== undefined && event.value >= trigger.below) return false;
      return true;
    }
    case 'time':
      // Time triggers are handled by scheduler timers rather than event bus
      return false;
    default:
      return false;
  }
}
