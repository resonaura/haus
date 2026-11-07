/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  Commands,
  ConditionOperator,
  EntityActionQueue,
  ExecutionStatus,
  LocalAutomationEngine,
  SessionOwnership,
  type AutomationExecutorEnvironment,
  type CommandEntry,
  type CommandJournal,
  type CommandPolicy,
  type CommandProvider,
  type IntegrationRef,
  type SessionRecord,
  type SessionRepository,
} from '../../src/index.js';

class InMemorySessionRepo implements SessionRepository {
  private readonly records = new Map<string, SessionRecord>();

  async read(resource: IntegrationRef): Promise<SessionRecord | undefined> {
    return this.records.get(`${resource.homeId}:${resource.kind}:${resource.id}`);
  }

  async update(
    resource: IntegrationRef,
    transform: (current: SessionRecord | undefined) => SessionRecord,
  ): Promise<SessionRecord> {
    const key = `${resource.homeId}:${resource.kind}:${resource.id}`;
    const next = transform(this.records.get(key));
    this.records.set(key, structuredClone(next));
    return structuredClone(next);
  }
}

class InMemoryCommandJournal implements CommandJournal {
  private readonly entries = new Map<string, CommandEntry>();
  public failSettle = false;

  private key(e: CommandEntry): string {
    return `${e.scope.homeId}:${e.scope.actorId}:${e.scope.idempotencyKey}`;
  }

  async reserve(proposed: CommandEntry): Promise<{ created: boolean; entry: CommandEntry }> {
    const k = this.key(proposed);
    const existing = this.entries.get(k);
    if (existing) {
      return { created: false, entry: structuredClone(existing) };
    }
    this.entries.set(k, structuredClone(proposed));
    return { created: true, entry: structuredClone(proposed) };
  }

  async settle(entry: CommandEntry) {
    if (this.failSettle) {
      throw new Error('journal_disk_error');
    }
    const k = this.key(entry);
    this.entries.set(k, structuredClone(entry));
    return structuredClone(entry.outcome);
  }
}

describe('Local Execution Profiling, Bounded Queues & Resilience (P16.4)', () => {
  it('profiles event-to-rule-to-action path with reproducible p50/p95/p99 and memory metrics', async () => {
    let dispatchedCount = 0;
    const states = new Map<string, Record<string, unknown>>([
      ['sensor::hallway:motion:main', { motion: true, lux: 15 }],
    ]);

    const env: AutomationExecutorEnvironment = {
      getEndpointState: (epId, prop) => states.get(epId)?.[prop],
      executeDeviceCommand: async () => {
        dispatchedCount++;
      },
      activateScene: async () => {},
      callScript: async () => {},
      sendNotification: async () => {},
      now: () => new Date('2026-11-07T02:00:00.000Z'),
    };

    const engine = new LocalAutomationEngine(env);

    // Register 50 rules across various endpoints to verify O(1) index lookup + precompiled script
    for (let i = 0; i < 50; i++) {
      const targetEp = i === 0 ? 'sensor::hallway:motion:main' : `sensor::room-${i}:motion:main`;
      engine.registerRule({
        schemaVersion: 1,
        id: `rule-perf-${i}`,
        name: `Perf Rule ${i}`,
        enabled: true,
        triggers: [{ type: 'state', endpointId: targetEp, property: 'motion', to: true }],
        conditions: [
          {
            type: 'state',
            endpointId: targetEp,
            property: 'lux',
            operator: ConditionOperator.LessThan,
            value: 50,
          },
        ],
        actions: [
          {
            type: 'action',
            action: {
              kind: 'device_command',
              payload: {
                endpointId: `lighting::room-${i}:ceiling:main`,
                capability: 'on_off',
                command: 'turn_on',
              },
            },
          },
        ],
      });
    }

    const report = await engine.profileEventToAction(
      {
        type: 'state',
        endpointId: 'sensor::hallway:motion:main',
        property: 'motion',
        from: false,
        to: true,
      },
      500,
    );

    expect(report.latency.count).toBe(500);
    expect(report.latency.p50Ms).toBeLessThan(1.0);
    expect(report.latency.p95Ms).toBeLessThan(2.5);
    expect(report.latency.p99Ms).toBeLessThan(5.0);
    expect(report.resources.rssBytes).toBeGreaterThan(0);
    expect(report.resources.cppHotspotRequired).toBe(false);
    expect(dispatchedCount).toBe(502); // 2 warmups + 500 measured runs
  });

  it('enforces per-entity FIFO ordering, cross-entity parallelism, and bounded queue depth in EntityActionQueue', async () => {
    const queue = new EntityActionQueue({ maxDepthPerEntity: 3 });
    const order: string[] = [];

    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const p1 = queue.run('light.kitchen', async () => {
      await gate;
      order.push('kitchen:1');
      return 1;
    });
    const p2 = queue.run('light.kitchen', async () => {
      order.push('kitchen:2');
      return 2;
    });
    const p3 = queue.run('light.kitchen', async () => {
      order.push('kitchen:3');
      return 3;
    });

    expect(queue.getDepth('light.kitchen')).toBe(3);

    // 4th queued operation on the same entity exceeds maxDepthPerEntity=3
    await expect(
      queue.run('light.kitchen', async () => {
        order.push('kitchen:4');
        return 4;
      }),
    ).rejects.toThrow('entity_action_queue_overflow');

    // Different entity runs immediately in parallel even while light.kitchen is blocked
    const otherRes = await queue.run('light.patio', async () => {
      order.push('patio:1');
      return 'patio-ok';
    });
    expect(otherRes).toBe('patio-ok');
    expect(order).toEqual(['patio:1']);

    releaseFirst();
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual(['patio:1', 'kitchen:1', 'kitchen:2', 'kitchen:3']);
    expect(queue.getDepth('light.kitchen')).toBe(0);
  });

  it('enforces single, restart, and bounded queued modes in LocalAutomationEngine', async () => {
    let activeStepGate!: () => void;
    const waitGate = () =>
      new Promise<void>((resolve) => {
        activeStepGate = resolve;
      });

    const env: AutomationExecutorEnvironment = {
      getEndpointState: () => true,
      executeDeviceCommand: async () => {},
      activateScene: async () => {},
      callScript: async () => {},
      sendNotification: async () => {},
      now: () => new Date(),
      sleep: async (_ms, signal) => {
        if (signal?.aborted) throw new Error('Execution was aborted.');
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error('Execution was aborted.'));
          signal?.addEventListener('abort', onAbort, { once: true });
          void waitGate().then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      },
    };

    const engine = new LocalAutomationEngine(env, { maxQueuedPerRule: 2 });

    // 1. Single mode skips concurrent re-entry
    engine.registerRule({
      schemaVersion: 1,
      id: 'rule-single',
      name: 'Single Rule',
      enabled: true,
      mode: 'single',
      triggers: [{ type: 'event', eventType: 'btn_single' }],
      actions: [{ type: 'delay', durationMs: 50 }],
    });

    const firstRun = engine.dispatch({ type: 'event', eventType: 'btn_single' });
    const skippedRun = await engine.dispatch({ type: 'event', eventType: 'btn_single' });
    expect(skippedRun).toHaveLength(0);
    activeStepGate();
    const firstResult = await firstRun;
    expect(firstResult).toHaveLength(1);
    expect(firstResult[0]?.status).toBe(ExecutionStatus.Completed);

    // 2. Restart mode cancels the previous in-flight run
    engine.registerRule({
      schemaVersion: 1,
      id: 'rule-restart',
      name: 'Restart Rule',
      enabled: true,
      mode: 'restart',
      triggers: [{ type: 'event', eventType: 'btn_restart' }],
      actions: [{ type: 'delay', durationMs: 50 }],
    });

    const cancelledRunPromise = engine.dispatch({ type: 'event', eventType: 'btn_restart' });
    await Promise.resolve();
    const secondRestartPromise = engine.dispatch({ type: 'event', eventType: 'btn_restart' });
    const cancelledRes = await cancelledRunPromise;
    expect(cancelledRes[0]?.status).toBe(ExecutionStatus.Cancelled);
    activeStepGate();
    const secondRes = await secondRestartPromise;
    expect(secondRes[0]?.status).toBe(ExecutionStatus.Completed);

    // 3. Queued mode bounds queue depth and rejects overflow
    engine.registerRule({
      schemaVersion: 1,
      id: 'rule-queued',
      name: 'Queued Rule',
      enabled: true,
      mode: 'queued',
      maxRuns: 2,
      triggers: [{ type: 'event', eventType: 'btn_queued' }],
      actions: [{ type: 'delay', durationMs: 50 }],
    });

    const q1 = engine.dispatch({ type: 'event', eventType: 'btn_queued' });
    const q2 = engine.dispatch({ type: 'event', eventType: 'btn_queued' });
    await expect(engine.dispatch({ type: 'event', eventType: 'btn_queued' })).rejects.toThrow(
      'automation_queue_overflow',
    );
    activeStepGate();
    await q1;
    activeStepGate();
    await q2;
  });

  it('preserves durable ownership and never replays physical actions on timeout, partition, or unknown acknowledgement', async () => {
    const sessionRepo = new InMemorySessionRepo();
    const ownership = new SessionOwnership(sessionRepo);
    const resource: IntegrationRef = {
      homeId: 'home-1',
      kind: 'integration',
      id: 'zigbee-coord',
    };

    const grant1 = await ownership.acquire(resource, {
      hubId: 'hub-primary',
      processId: 'pid-1',
    });
    await ownership.connected(grant1);

    let physicalSendCount = 0;
    let simulateTransportDrop = true;
    const provider: CommandProvider = {
      resource,
      execute: async () => {
        physicalSendCount++;
        if (simulateTransportDrop) {
          throw new Error('socket_hang_up_after_wire_write');
        }
        return { status: 'confirmed', correlationId: 'corr-1' };
      },
    };

    const policy: CommandPolicy = {
      authorize: async () => true,
      fingerprint: async (intent) => JSON.stringify(intent),
    };

    const journal = new InMemoryCommandJournal();
    const commands = new Commands(ownership, policy, journal, provider, 100);

    const request = {
      actorId: 'user-1',
      idempotencyKey: 'idem-unlock-front-door',
      grant: grant1,
      command: {
        id: 'cmd-101',
        endpointId: 'ep-front-lock',
        capabilityId: 'lock',
        operation: 'unlock',
        arguments: {},
      },
    };

    // First attempt experiences transport partition after sending physical frame -> unknown outcome
    const outcome1 = await commands.execute(request);
    expect(outcome1.status).toBe('unknown');
    expect(outcome1.reason).toBe('transport-lost');
    expect(physicalSendCount).toBe(1);

    // Retry with same idempotencyKey after restart/partition returns journaled 'unknown' without re-sending physical command
    simulateTransportDrop = false;
    const commandsAfterRestart = new Commands(ownership, policy, journal, provider, 100);
    const outcome2 = await commandsAfterRestart.execute(request);
    expect(outcome2.status).toBe('unknown');
    expect(outcome2.reason).toBe('transport-lost');
    expect(physicalSendCount).toBe(1); // Strictly 1 physical execution, never replayed!

    // Fencing takeover by hub-secondary invalidates grant1 for new commands
    await ownership.revoke(grant1, async () => {});
    const grant2 = await ownership.acquire(resource, {
      hubId: 'hub-secondary',
      processId: 'pid-2',
    });
    await ownership.connected(grant2);
    expect(grant2.generation).toBe(grant1.generation + 1);

    await expect(
      commandsAfterRestart.execute({
        ...request,
        idempotencyKey: 'idem-stale-owner',
        grant: grant1,
      }),
    ).rejects.toThrow();
    expect(physicalSendCount).toBe(1);
  });
});
