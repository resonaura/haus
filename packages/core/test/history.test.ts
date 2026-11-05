/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  AutomationHistoryTracker,
  compareLatencyProfiles,
  ExecutionStatus,
  sanitizePayloadForHistory,
  type AttributedExecutionHistoryRecord,
} from '../src/index.js';

describe('Automation History & Latency Attribution', () => {
  it('strictly redacts sensitive credential payloads from execution history', () => {
    const rawPayload = {
      device_id: 'lock.front_door',
      action: 'unlock',
      user_pin: '1234',
      auth_token: 'secret_jwt_bearer_token',
      api_key: 'live_sk_abcdef123456',
      normal_settings: {
        auto_lock_seconds: 30,
        master_key: 'cannot_leak_this',
      },
    };

    const sanitized = sanitizePayloadForHistory(rawPayload) as {
      device_id: string;
      action: string;
      user_pin: string;
      auth_token: string;
      api_key: string;
      normal_settings: { auto_lock_seconds: number; master_key: string };
    };

    expect(sanitized.device_id).toBe('lock.front_door');
    expect(sanitized.action).toBe('unlock');
    expect(sanitized.user_pin).toBe('[REDACTED]');
    expect(sanitized.auth_token).toBe('[REDACTED]');
    expect(sanitized.api_key).toBe('[REDACTED]');
    expect(sanitized.normal_settings.auto_lock_seconds).toBe(30);
    expect(sanitized.normal_settings.master_key).toBe('[REDACTED]');
  });

  it('records attributed execution breakdown across all 5 physical stages', () => {
    const tracker = new AutomationHistoryTracker();

    const sampleRecord: AttributedExecutionHistoryRecord = {
      executionId: 'exec_1001',
      ruleId: 'rule.porch_motion',
      ruleName: 'Porch Motion Light',
      triggeredAt: '2026-11-05T20:00:00.000Z',
      completedAt: '2026-11-05T20:00:00.045Z',
      status: ExecutionStatus.Completed,
      triggerType: 'state',
      latency: {
        eventReceipt: { durationMs: 0.5, timestamp: '2026-11-05T20:00:00.000Z' },
        conditionEvaluation: { durationMs: 0.2, timestamp: '2026-11-05T20:00:00.001Z' },
        commandDispatch: { durationMs: 1.1, timestamp: '2026-11-05T20:00:00.002Z' },
        providerConfirmation: { durationMs: 22.0, timestamp: '2026-11-05T20:00:00.024Z' },
        totalPhysicalResponse: { durationMs: 23.8, timestamp: '2026-11-05T20:00:00.025Z' },
      },
      actions: [
        {
          endpointId: 'light.porch',
          capability: 'on_off',
          command: 'turn_on',
          status: 'completed',
          durationMs: 23.1,
          parameters: { brightness: 100, access_token: 'secret123' },
        },
      ],
    };

    tracker.record(sampleRecord);

    const queried = tracker.query({ ruleId: 'rule.porch_motion' });
    expect(queried).toHaveLength(1);
    expect(queried[0]?.executionId).toBe('exec_1001');
    // Ensure nested parameters were redacted upon recording
    expect(queried[0]?.actions[0]?.parameters?.access_token).toBe('[REDACTED]');
    expect(queried[0]?.actions[0]?.parameters?.brightness).toBe(100);
  });

  it('computes accurate stage latency summaries (avg, p50, p95)', () => {
    const tracker = new AutomationHistoryTracker();

    const latencies = [10, 15, 20, 25, 30];
    for (let i = 0; i < latencies.length; i++) {
      const lat = latencies[i] ?? 10;
      tracker.record({
        executionId: `exec_${i}`,
        ruleId: 'rule.dimmer',
        ruleName: 'Dimmer Rule',
        triggeredAt: new Date(Date.now() + i * 1000).toISOString(),
        completedAt: new Date(Date.now() + i * 1000 + lat).toISOString(),
        status: ExecutionStatus.Completed,
        triggerType: 'event',
        latency: {
          eventReceipt: { durationMs: 0.1, timestamp: '' },
          conditionEvaluation: { durationMs: 0.1, timestamp: '' },
          commandDispatch: { durationMs: 0.5, timestamp: '' },
          providerConfirmation: { durationMs: lat - 0.7, timestamp: '' },
          totalPhysicalResponse: { durationMs: lat, timestamp: '' },
        },
        actions: [],
      });
    }

    const summary = tracker.getLatencySummary('rule.dimmer');
    expect(summary.totalExecutions).toBe(5);
    expect(summary.totalPhysicalResponse.avgMs).toBe(20);
    expect(summary.totalPhysicalResponse.p50Ms).toBe(20);
    expect(summary.totalPhysicalResponse.p95Ms).toBe(30);
  });

  it('truthfully compares latency profiles with identical hardware disclosure', () => {
    const hausSummary = {
      totalExecutions: 100,
      eventReceipt: { avgMs: 0.2, p50Ms: 0.1, p95Ms: 0.4 },
      conditionEvaluation: { avgMs: 0.1, p50Ms: 0.1, p95Ms: 0.2 },
      commandDispatch: { avgMs: 0.8, p50Ms: 0.6, p95Ms: 1.2 },
      providerConfirmation: { avgMs: 12.0, p50Ms: 10.5, p95Ms: 18.0 },
      totalPhysicalResponse: { avgMs: 13.1, p50Ms: 11.3, p95Ms: 19.8 },
    };

    const haSummary = {
      totalExecutions: 100,
      eventReceipt: { avgMs: 4.5, p50Ms: 4.0, p95Ms: 8.2 },
      conditionEvaluation: { avgMs: 2.1, p50Ms: 1.8, p95Ms: 4.0 },
      commandDispatch: { avgMs: 5.2, p50Ms: 4.9, p95Ms: 9.1 },
      providerConfirmation: { avgMs: 24.0, p50Ms: 22.6, p95Ms: 38.0 },
      totalPhysicalResponse: { avgMs: 35.8, p50Ms: 33.3, p95Ms: 59.3 },
    };

    const comparison = compareLatencyProfiles(hausSummary, haSummary, true);

    expect(comparison.fasterSystem).toBe('haus');
    expect(comparison.speedupRatio).toBe(2.95); // 33.3 / 11.3 ~= 2.95x
    expect(comparison.verifiedOnIdenticalHardware).toBe(true);
  });
});
