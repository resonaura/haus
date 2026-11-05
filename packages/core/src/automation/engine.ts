/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { compileRule, type CompiledAutomationRule } from './compiler.js';
import { matchesTrigger, type TriggerEvent } from './evaluator.js';
import {
  AutomationExecutor,
  type AutomationExecutorEnvironment,
} from './executor.js';
import type {
  ExecutionHistoryRecord,
  HausAutomationRule,
  HausScript,
} from './types.js';

export interface LatencyMetrics {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export function calculatePercentiles(samples: readonly number[]): LatencyMetrics {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[count - 1] ?? 0;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avgMs = sum / count;

  const getPercentile = (pct: number) => {
    const idx = Math.min(Math.floor((pct / 100) * count), count - 1);
    return sorted[idx] ?? 0;
  };

  return {
    count,
    minMs: Math.round(minMs * 1000) / 1000,
    maxMs: Math.round(maxMs * 1000) / 1000,
    avgMs: Math.round(avgMs * 1000) / 1000,
    p50Ms: Math.round(getPercentile(50) * 1000) / 1000,
    p95Ms: Math.round(getPercentile(95) * 1000) / 1000,
    p99Ms: Math.round(getPercentile(99) * 1000) / 1000,
  };
}

export class LocalAutomationEngine {
  private readonly rulesById = new Map<string, CompiledAutomationRule>();
  private readonly stateIndex = new Map<string, Set<string>>();
  private readonly eventIndex = new Map<string, Set<string>>();
  private readonly numericIndex = new Map<string, Set<string>>();
  private readonly executor: AutomationExecutor;

  constructor(private readonly env: AutomationExecutorEnvironment) {
    this.executor = new AutomationExecutor(env);
  }

  registerRule(rule: HausAutomationRule): void {
    if (!rule.enabled) return;
    const compiled = compileRule(rule);
    this.rulesById.set(rule.id, compiled);

    for (const trigger of rule.triggers) {
      switch (trigger.type) {
        case 'state': {
          let set = this.stateIndex.get(trigger.endpointId);
          if (!set) {
            set = new Set();
            this.stateIndex.set(trigger.endpointId, set);
          }
          set.add(rule.id);
          break;
        }
        case 'event': {
          let set = this.eventIndex.get(trigger.eventType);
          if (!set) {
            set = new Set();
            this.eventIndex.set(trigger.eventType, set);
          }
          set.add(rule.id);
          break;
        }
        case 'numeric_state': {
          let set = this.numericIndex.get(trigger.endpointId);
          if (!set) {
            set = new Set();
            this.numericIndex.set(trigger.endpointId, set);
          }
          set.add(rule.id);
          break;
        }
      }
    }
  }

  unregisterRule(ruleId: string): void {
    this.rulesById.delete(ruleId);
    for (const set of this.stateIndex.values()) set.delete(ruleId);
    for (const set of this.eventIndex.values()) set.delete(ruleId);
    for (const set of this.numericIndex.values()) set.delete(ruleId);
  }

  updateRule(rule: HausAutomationRule): void {
    this.unregisterRule(rule.id);
    this.registerRule(rule);
  }

  async dispatch(event: TriggerEvent): Promise<readonly ExecutionHistoryRecord[]> {
    const candidateRuleIds = new Set<string>();

    switch (event.type) {
      case 'state': {
        if (event.endpointId) {
          const ruleIds = this.stateIndex.get(event.endpointId);
          if (ruleIds) for (const id of ruleIds) candidateRuleIds.add(id);
        }
        break;
      }
      case 'event': {
        if (event.eventType) {
          const ruleIds = this.eventIndex.get(event.eventType);
          if (ruleIds) for (const id of ruleIds) candidateRuleIds.add(id);
        }
        break;
      }
      case 'numeric_state': {
        if (event.endpointId) {
          const ruleIds = this.numericIndex.get(event.endpointId);
          if (ruleIds) for (const id of ruleIds) candidateRuleIds.add(id);
        }
        break;
      }
    }

    if (candidateRuleIds.size === 0) return [];

    const executionResults: ExecutionHistoryRecord[] = [];

    for (const ruleId of candidateRuleIds) {
      const rule = this.rulesById.get(ruleId);
      if (!rule || !rule.enabled) continue;

      const triggerMatched = rule.triggers.some((t) => matchesTrigger(t, event));
      if (!triggerMatched) continue;

      const conditionsMet = rule.conditionCheck(this.env);
      if (!conditionsMet) continue;

      // Synthesize script to run rule actions
      const syntheticScript: HausScript = {
        schemaVersion: 1,
        id: rule.id,
        name: rule.name,
        mode: rule.mode,
        steps: rule.actions,
      };

      const result = await this.executor.executeScript(syntheticScript);
      executionResults.push(result);
    }

    return executionResults;
  }

  async measureSoftwarePathLatency(
    event: TriggerEvent,
    iterations: number = 100,
  ): Promise<LatencyMetrics> {
    const latencies: number[] = [];

    // Warm-up run
    await this.dispatch(event);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await this.dispatch(event);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }

    return calculatePercentiles(latencies);
  }
}
