/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { compileRule, type CompiledAutomationRule } from './compiler.js';
import { matchesTrigger, type TriggerEvent } from './evaluator.js';
import { AutomationExecutor, type AutomationExecutorEnvironment } from './executor.js';
import type { ExecutionHistoryRecord, HausAutomationRule } from './types.js';

export interface LatencyMetrics {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface ExecutionResourceMetrics {
  readonly heapUsedBeforeBytes: number;
  readonly heapUsedAfterBytes: number;
  readonly heapDeltaBytes: number;
  readonly rssBytes: number;
  readonly cppHotspotRequired: false;
}

export interface ExecutionProfileReport {
  readonly latency: LatencyMetrics;
  readonly resources: ExecutionResourceMetrics;
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

export interface LocalAutomationEngineOptions {
  readonly maxQueuedPerRule?: number;
}

export class LocalAutomationEngine {
  private readonly rulesById = new Map<string, CompiledAutomationRule>();
  private readonly stateIndex = new Map<string, Set<string>>();
  private readonly eventIndex = new Map<string, Set<string>>();
  private readonly numericIndex = new Map<string, Set<string>>();
  private readonly executor: AutomationExecutor;
  private readonly maxQueuedPerRule: number;

  private readonly activeCountByRule = new Map<string, number>();
  private readonly activeAbortByRule = new Map<string, AbortController>();
  private readonly queueTailByRule = new Map<string, Promise<unknown>>();

  constructor(
    private readonly env: AutomationExecutorEnvironment,
    options: LocalAutomationEngineOptions = {},
  ) {
    this.executor = new AutomationExecutor(env);
    this.maxQueuedPerRule = options.maxQueuedPerRule ?? 32;
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
    this.activeAbortByRule.get(ruleId)?.abort();
    this.activeAbortByRule.delete(ruleId);
    this.activeCountByRule.delete(ruleId);
    this.queueTailByRule.delete(ruleId);
  }

  updateRule(rule: HausAutomationRule): void {
    this.unregisterRule(rule.id);
    this.registerRule(rule);
  }

  private getCandidateRuleIds(event: TriggerEvent): ReadonlySet<string> | undefined {
    switch (event.type) {
      case 'state':
        return event.endpointId ? this.stateIndex.get(event.endpointId) : undefined;
      case 'event':
        return event.eventType ? this.eventIndex.get(event.eventType) : undefined;
      case 'numeric_state':
        return event.endpointId ? this.numericIndex.get(event.endpointId) : undefined;
    }
  }

  private async runCompiledRule(
    rule: CompiledAutomationRule,
  ): Promise<ExecutionHistoryRecord | undefined> {
    const mode = rule.mode ?? 'parallel';
    const maxRuns = rule.maxRuns ?? this.maxQueuedPerRule;
    const active = this.activeCountByRule.get(rule.id) ?? 0;

    if (mode === 'single' && active > 0) {
      return undefined;
    }

    if ((mode === 'queued' || mode === 'parallel') && active >= maxRuns) {
      throw new Error('automation_queue_overflow');
    }

    if (mode === 'restart' && active > 0) {
      this.activeAbortByRule.get(rule.id)?.abort();
    }

    const ctrl = new AbortController();
    this.activeAbortByRule.set(rule.id, ctrl);
    this.activeCountByRule.set(rule.id, active + 1);

    const runAction = async (): Promise<ExecutionHistoryRecord> => {
      try {
        return await this.executor.executeScript(rule.syntheticScript, ctrl.signal);
      } finally {
        const nextActive = (this.activeCountByRule.get(rule.id) ?? 1) - 1;
        if (nextActive <= 0) {
          this.activeCountByRule.delete(rule.id);
          if (this.activeAbortByRule.get(rule.id) === ctrl) {
            this.activeAbortByRule.delete(rule.id);
          }
        } else {
          this.activeCountByRule.set(rule.id, nextActive);
        }
      }
    };

    if (mode === 'queued') {
      const prev = this.queueTailByRule.get(rule.id) ?? Promise.resolve();
      const next = prev.catch(() => {}).then(runAction);
      this.queueTailByRule.set(rule.id, next);
      void next.finally(() => {
        if (this.queueTailByRule.get(rule.id) === next) {
          this.queueTailByRule.delete(rule.id);
        }
      });
      return next;
    }

    return runAction();
  }

  async dispatch(event: TriggerEvent): Promise<readonly ExecutionHistoryRecord[]> {
    const candidateRuleIds = this.getCandidateRuleIds(event);
    if (!candidateRuleIds || candidateRuleIds.size === 0) return [];

    const executionResults: ExecutionHistoryRecord[] = [];

    for (const ruleId of candidateRuleIds) {
      const rule = this.rulesById.get(ruleId);
      if (!rule || !rule.enabled) continue;

      let triggerMatched = false;
      for (let i = 0; i < rule.triggers.length; i++) {
        const trigger = rule.triggers[i];
        if (trigger && matchesTrigger(trigger, event)) {
          triggerMatched = true;
          break;
        }
      }
      if (!triggerMatched) continue;

      if (!rule.conditionCheck(this.env)) continue;

      const result = await this.runCompiledRule(rule);
      if (result) {
        executionResults.push(result);
      }
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

  async profileEventToAction(
    event: TriggerEvent,
    iterations: number = 200,
  ): Promise<ExecutionProfileReport> {
    await this.dispatch(event);
    const readMem = (): { heapUsed: number; rss: number } => {
      const proc = (
        globalThis as {
          process?: { memoryUsage?: () => { heapUsed: number; rss: number } };
        }
      ).process;
      return proc?.memoryUsage ? proc.memoryUsage() : { heapUsed: 0, rss: 0 };
    };
    const memBefore = readMem();
    const latency = await this.measureSoftwarePathLatency(event, iterations);
    const memAfter = readMem();

    return {
      latency,
      resources: {
        heapUsedBeforeBytes: memBefore.heapUsed,
        heapUsedAfterBytes: memAfter.heapUsed,
        heapDeltaBytes: Math.max(0, memAfter.heapUsed - memBefore.heapUsed),
        rssBytes: memAfter.rss,
        cppHotspotRequired: false,
      },
    };
  }
}
