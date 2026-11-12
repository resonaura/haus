/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordingMaintenance } from '../../src/events/maintenance.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture(overrides: { prune?: () => Promise<number> } = {}) {
  const calls: string[] = [];
  const store = {
    prune:
      overrides.prune ??
      (async () => {
        calls.push('prune');
        return 0;
      }),
  };
  const cluster = {
    recordingCache: {
      trim: async () => {
        calls.push('trim');
      },
    },
    tick: async () => {
      calls.push('cluster');
    },
  };
  const backups = {
    tick: async () => {
      calls.push('backups');
    },
  };
  const recent = {
    tick: async () => {
      calls.push('recent');
    },
  };
  const config = { retention_days: 7, max_storage_gb: 10 };
  return { calls, maintenance: new RecordingMaintenance(store, cluster, backups, recent, config) };
}

it('runs the legacy cadences and stops scheduling after destroy', async () => {
  const { calls, maintenance } = fixture();
  maintenance.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(calls).toEqual(['recent']);
  await vi.advanceTimersByTimeAsync(58_000);
  expect(calls).toContain('prune');
  expect(calls).toContain('trim');
  expect(calls).toContain('backups');
  expect(calls).toContain('cluster');
  maintenance.onModuleDestroy();
  calls.length = 0;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(calls).toEqual([]);
});

it('keeps each loop single-flight and survives a failing run', async () => {
  let release!: () => void;
  let started = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { maintenance } = fixture({
    prune: async () => {
      started++;
      await gate;
      throw Error('prune failed');
    },
  });
  maintenance.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(started).toBe(1);
  release();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(started).toBe(2);
  maintenance.onModuleDestroy();
});
