/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  AdapterConcurrencyLimiter,
  type BoundedTask,
} from '../src/index.js';

describe('AdapterConcurrencyLimiter & Bounded Execution', () => {
  it('enforces maximum concurrency limit per adapter', async () => {
    const limiter = new AdapterConcurrencyLimiter();
    limiter.setAdapterConfig('zigbee_coordinator', {
      maxConcurrency: 2,
      minIntervalMs: 0,
    });

    let currentActive = 0;
    let maxObservedActive = 0;

    const tasks: BoundedTask[] = Array.from({ length: 6 }, (_, i) => ({
      id: `task_${i}`,
      endpointId: `endpoint_${i}`, // Distinct endpoints -> eligible for concurrency
      adapterId: 'zigbee_coordinator',
      run: async () => {
        currentActive++;
        if (currentActive > maxObservedActive) {
          maxObservedActive = currentActive;
        }
        await new Promise((r) => setTimeout(r, 20));
        currentActive--;
        return `result_${i}`;
      },
    }));

    const report = await limiter.executeBatch(tasks);

    expect(report.completed).toBe(6);
    expect(report.status).toBe('completed');
    expect(maxObservedActive).toBeLessThanOrEqual(2);
  });

  it('preserves strict FIFO execution order for tasks targeting the same endpoint', async () => {
    const limiter = new AdapterConcurrencyLimiter();
    const executionOrder: string[] = [];

    const tasks: BoundedTask[] = [
      {
        id: 'step_1_dim',
        endpointId: 'living_room:light:overhead',
        run: async () => {
          await new Promise((r) => setTimeout(r, 30));
          executionOrder.push('step_1_dim');
        },
      },
      {
        id: 'step_2_color',
        endpointId: 'living_room:light:overhead',
        run: async () => {
          await new Promise((r) => setTimeout(r, 5));
          executionOrder.push('step_2_color');
        },
      },
      {
        id: 'step_3_off',
        endpointId: 'living_room:light:overhead',
        run: async () => {
          await new Promise((r) => setTimeout(r, 1));
          executionOrder.push('step_3_off');
        },
      },
    ];

    const report = await limiter.executeBatch(tasks);

    expect(report.completed).toBe(3);
    // Order must strictly be 1 -> 2 -> 3 despite shorter delays in 2 and 3
    expect(executionOrder).toEqual(['step_1_dim', 'step_2_color', 'step_3_off']);
  });

  it('respects explicit task dependencies across different endpoints', async () => {
    const limiter = new AdapterConcurrencyLimiter();
    const order: string[] = [];

    const tasks: BoundedTask[] = [
      {
        id: 'power_strip_on',
        endpointId: 'plug:outlet:1',
        run: async () => {
          await new Promise((r) => setTimeout(r, 25));
          order.push('power_strip_on');
        },
      },
      {
        id: 'amplifier_unmute',
        endpointId: 'audio:amp:main',
        dependencies: ['power_strip_on'],
        run: async () => {
          order.push('amplifier_unmute');
        },
      },
    ];

    const report = await limiter.executeBatch(tasks);

    expect(report.completed).toBe(2);
    expect(order).toEqual(['power_strip_on', 'amplifier_unmute']);
  });

  it('isolates failures and reports partial completion for independent actions', async () => {
    const limiter = new AdapterConcurrencyLimiter();

    const tasks: BoundedTask[] = [
      {
        id: 'light_1',
        endpointId: 'light:1',
        run: async () => 'ok_1',
      },
      {
        id: 'light_2_failed',
        endpointId: 'light:2',
        run: async () => {
          throw new Error('Zigbee delivery timeout: NO_ACK');
        },
      },
      {
        id: 'light_3',
        endpointId: 'light:3',
        run: async () => 'ok_3',
      },
    ];

    const report = await limiter.executeBatch(tasks);

    expect(report.total).toBe(3);
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.status).toBe('partial');

    const failedResult = report.results.find((r) => r.id === 'light_2_failed');
    expect(failedResult?.status).toBe('failed');
    expect(failedResult?.error).toContain('NO_ACK');
  });

  it('cancels pending actions when AbortSignal triggers mid-flight', async () => {
    const limiter = new AdapterConcurrencyLimiter();
    const controller = new AbortController();

    const tasks: BoundedTask[] = [
      {
        id: 'fast_task',
        endpointId: 'fast:1',
        run: async () => {
          controller.abort(); // Cancel the batch during execution
          return 'done';
        },
      },
      {
        id: 'slow_task_1',
        endpointId: 'slow:1',
        run: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return 'slow_done';
        },
      },
      {
        id: 'pending_task',
        endpointId: 'pending:1',
        dependencies: ['slow_task_1'],
        run: async () => 'pending_done',
      },
    ];

    const report = await limiter.executeBatch(tasks, controller.signal);

    expect(report.cancelled).toBeGreaterThan(0);
    expect(['partial', 'cancelled']).toContain(report.status);
  });

  it('enforces per-task timeout without stalling subsequent batch items', async () => {
    const limiter = new AdapterConcurrencyLimiter();

    const tasks: BoundedTask[] = [
      {
        id: 'hanging_device',
        endpointId: 'unresponsive:switch:1',
        timeoutMs: 15,
        run: async (signal) => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 300);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Aborted by timeout.'));
            });
          });
        },
      },
      {
        id: 'healthy_device',
        endpointId: 'responsive:switch:1',
        timeoutMs: 500,
        run: async () => 'healthy_ok',
      },
    ];

    const report = await limiter.executeBatch(tasks);

    expect(report.timedOut).toBe(1);
    expect(report.completed).toBe(1);
    expect(report.status).toBe('partial');

    const timeoutRes = report.results.find((r) => r.id === 'hanging_device');
    expect(timeoutRes?.status).toBe('timed_out');
  });
});
