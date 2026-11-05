/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ExecutionStatus } from './types.js';

export interface StageLatency {
  readonly durationMs: number;
  readonly timestamp: string;
}

export interface AutomationLatencyBreakdown {
  readonly eventReceipt: StageLatency;
  readonly conditionEvaluation: StageLatency;
  readonly commandDispatch: StageLatency;
  readonly providerConfirmation: StageLatency;
  readonly totalPhysicalResponse: StageLatency;
}

const SENSITIVE_KEY_PATTERN = /token|secret|password|key|auth|credential|pin|bearer/i;

export function sanitizePayloadForHistory(input: unknown): unknown {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(sanitizePayloadForHistory);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = sanitizePayloadForHistory(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export interface AttributedActionSummary {
  readonly endpointId: string;
  readonly capability: string;
  readonly command: string;
  readonly status: 'completed' | 'failed' | 'timed_out' | 'cancelled';
  readonly durationMs: number;
  readonly parameters?: Record<string, unknown>;
  readonly error?: string;
}

export interface AttributedExecutionHistoryRecord {
  readonly executionId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly triggeredAt: string;
  readonly completedAt: string;
  readonly status: ExecutionStatus;
  readonly triggerType: string;
  readonly latency: AutomationLatencyBreakdown;
  readonly actions: readonly AttributedActionSummary[];
  readonly error?: string;
}

export interface StageLatencySummary {
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface LatencyAttributionSummary {
  readonly totalExecutions: number;
  readonly eventReceipt: StageLatencySummary;
  readonly conditionEvaluation: StageLatencySummary;
  readonly commandDispatch: StageLatencySummary;
  readonly providerConfirmation: StageLatencySummary;
  readonly totalPhysicalResponse: StageLatencySummary;
}

function computeStageStats(values: readonly number[]): StageLatencySummary {
  if (values.length === 0) return { avgMs: 0, p50Ms: 0, p95Ms: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const count = sorted.length;
  const avgMs = Math.round((sum / count) * 1000) / 1000;
  const p50 = sorted[Math.min(Math.floor(count * 0.5), count - 1)] ?? 0;
  const p95 = sorted[Math.min(Math.floor(count * 0.95), count - 1)] ?? 0;
  return {
    avgMs,
    p50Ms: Math.round(p50 * 1000) / 1000,
    p95Ms: Math.round(p95 * 1000) / 1000,
  };
}

export class AutomationHistoryTracker {
  private readonly records: AttributedExecutionHistoryRecord[] = [];

  constructor(private readonly maxCapacity: number = 500) {}

  record(entry: AttributedExecutionHistoryRecord): void {
    // Sanitize any action parameters before persistent recording
    const sanitizedActions = entry.actions.map((act) => ({
      ...act,
      parameters: act.parameters
        ? (sanitizePayloadForHistory(act.parameters) as Record<string, unknown>)
        : undefined,
    }));

    const cleanRecord: AttributedExecutionHistoryRecord = {
      ...entry,
      actions: sanitizedActions,
    };

    if (this.records.length >= this.maxCapacity) {
      this.records.shift();
    }
    this.records.push(cleanRecord);
  }

  query(options?: {
    ruleId?: string;
    limit?: number;
    since?: string;
  }): readonly AttributedExecutionHistoryRecord[] {
    let filtered = [...this.records];

    if (options?.ruleId) {
      filtered = filtered.filter((r) => r.ruleId === options.ruleId);
    }

    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      filtered = filtered.filter((r) => new Date(r.triggeredAt).getTime() >= sinceTime);
    }

    if (options?.limit && options.limit > 0) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  getLatencySummary(ruleId?: string): LatencyAttributionSummary {
    const list = this.query({ ruleId });
    if (list.length === 0) {
      const emptyStage: StageLatencySummary = { avgMs: 0, p50Ms: 0, p95Ms: 0 };
      return {
        totalExecutions: 0,
        eventReceipt: emptyStage,
        conditionEvaluation: emptyStage,
        commandDispatch: emptyStage,
        providerConfirmation: emptyStage,
        totalPhysicalResponse: emptyStage,
      };
    }

    const eventReceiptTimes = list.map((r) => r.latency.eventReceipt.durationMs);
    const conditionTimes = list.map((r) => r.latency.conditionEvaluation.durationMs);
    const dispatchTimes = list.map((r) => r.latency.commandDispatch.durationMs);
    const providerTimes = list.map((r) => r.latency.providerConfirmation.durationMs);
    const totalTimes = list.map((r) => r.latency.totalPhysicalResponse.durationMs);

    return {
      totalExecutions: list.length,
      eventReceipt: computeStageStats(eventReceiptTimes),
      conditionEvaluation: computeStageStats(conditionTimes),
      commandDispatch: computeStageStats(dispatchTimes),
      providerConfirmation: computeStageStats(providerTimes),
      totalPhysicalResponse: computeStageStats(totalTimes),
    };
  }

  clear(): void {
    this.records.length = 0;
  }
}

export interface LatencyComparisonReport {
  readonly fasterSystem: 'haus' | 'home_assistant' | 'equal';
  readonly speedupRatio: number;
  readonly hausTotalP50Ms: number;
  readonly haTotalP50Ms: number;
  readonly verifiedOnIdenticalHardware: boolean;
}

export function compareLatencyProfiles(
  haus: LatencyAttributionSummary,
  ha: LatencyAttributionSummary,
  identicalHardwareVerified: boolean = false,
): LatencyComparisonReport {
  const hausP50 = haus.totalPhysicalResponse.p50Ms;
  const haP50 = ha.totalPhysicalResponse.p50Ms;

  let fasterSystem: 'haus' | 'home_assistant' | 'equal' = 'equal';
  let speedupRatio = 1.0;

  if (hausP50 > 0 && haP50 > 0) {
    if (hausP50 < haP50) {
      fasterSystem = 'haus';
      speedupRatio = Math.round((haP50 / hausP50) * 100) / 100;
    } else if (haP50 < hausP50) {
      fasterSystem = 'home_assistant';
      speedupRatio = Math.round((hausP50 / haP50) * 100) / 100;
    }
  }

  return {
    fasterSystem,
    speedupRatio,
    hausTotalP50Ms: hausP50,
    haTotalP50Ms: haP50,
    verifiedOnIdenticalHardware: identicalHardwareVerified,
  };
}
