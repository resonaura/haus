/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HausDevice } from '@haus/core';
import { ClusterSnapshotCodec } from '../../../src/cluster/sync/snapshot.js';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { HomeStatsTracker, compactHistoryState } from '../../../src/home/home-stats.js';
import { StatsRollupWorker, type StatsRollupStorePort } from '../../../src/stats/stats.worker.js';
import type { LiveService } from '../../../src/live/types.js';
import type { Transactions } from '../../../src/storage/transactions.js';

const KETTLE_DEVICE: HausDevice = {
  id: 'mqtt_kettle_1',
  name: 'Kitchen Kettle',
  category: 'appliances',
  availability: 'online',
  source: { instanceId: 'mqtt', externalId: 'kettle_1' },
  connectivity: { protocol: 'mqtt' },
  endpoints: [
    {
      id: 'ep_kettle_temp',
      name: 'Temperature',
      capabilities: [
        {
          id: 'temperature',
          kind: 'numeric',
          operations: ['read'],
          readable: true,
          unit: '°C',
        },
      ],
      readings: {},
    },
  ],
};

describe('Tail-latency & event-loop stall guards', () => {
  it('short-circuits identical unchanged endpoint state patches without redundant live/history churn', async () => {
    const published: string[] = [];
    const liveService: LiveService = {
      publish: (topic) => {
        published.push(topic);
      },
      getState: () => ({
        protocol: 1,
        instance: 'test',
        sequence: 1,
        topic: 'home',
        revision: '1',
        connected: true,
      }),
      setConnected: () => {},
      setRevision: () => {},
      setSourcesProvider: () => {},
      authorize: () => true,
      addClient: () => {},
      removeClient: () => {},
      getClientCount: () => 0,
    };
    const home = new StandaloneHomeService(liveService);
    home.registerDevice(KETTLE_DEVICE);
    published.length = 0;

    await home.updateEndpointState('ep_kettle_temp', { temperature: 23 }, false);
    const firstPublishCount = published.length;
    expect(firstPublishCount).toBeGreaterThan(0);

    // Repeating the exact same patch must not re-publish or grow history.
    for (let i = 0; i < 10; i += 1) {
      await home.updateEndpointState('ep_kettle_temp', { temperature: 23 }, false);
    }
    expect(published.length).toBe(firstPublishCount);

    // Real value change still publishes immediately.
    await home.updateEndpointState('ep_kettle_temp', { temperature: 24 }, false);
    expect(published.length).toBeGreaterThan(firstPublishCount);
  });

  it('deduplicates unchanged metric writes within 60s heartbeat while recording real changes immediately', () => {
    const tracker = new HomeStatsTracker();
    const ingestDeviceReading = vi.fn();
    const collector = { ingestDeviceReading };

    tracker.recordUpdate(
      'ep_kettle_temp',
      { temperature: 23 },
      { temperature: 23 },
      KETTLE_DEVICE,
      undefined,
      collector,
      10_000,
    );
    tracker.recordUpdate(
      'ep_kettle_temp',
      { temperature: 23 },
      { temperature: 23 },
      KETTLE_DEVICE,
      undefined,
      collector,
      12_000,
    );
    expect(ingestDeviceReading).toHaveBeenCalledTimes(1);

    // Value change records immediately
    tracker.recordUpdate(
      'ep_kettle_temp',
      { temperature: 24 },
      { temperature: 24 },
      KETTLE_DEVICE,
      undefined,
      collector,
      14_000,
    );
    expect(ingestDeviceReading).toHaveBeenCalledTimes(2);

    // Unchanged value after 60s heartbeat records once
    tracker.recordUpdate(
      'ep_kettle_temp',
      { temperature: 24 },
      { temperature: 24 },
      KETTLE_DEVICE,
      undefined,
      collector,
      80_000,
    );
    expect(ingestDeviceReading).toHaveBeenCalledTimes(3);
  });

  it('StatsRollupWorker batches raw queries per metric and skips idle metrics after initial sweep', async () => {
    const queryRawSamples = vi.fn(async () => []);
    const listMetadata = vi.fn(async () => [
      {
        id: 'm1',
        statisticId: 'device.a.temp',
        source: 'device' as const,
        kind: 'gauge' as const,
        hasMean: true,
        hasSum: false,
        createdAt: 0,
      },
      {
        id: 'm2',
        statisticId: 'device.b.temp',
        source: 'device' as const,
        kind: 'gauge' as const,
        hasMean: true,
        hasSum: false,
        createdAt: 0,
      },
    ]);
    const store: StatsRollupStorePort = {
      listMetadata,
      query5mRollups: vi.fn(async () => []),
      query1hRollups: vi.fn(async () => []),
      queryRawSamples,
      insert5mRollups: vi.fn(async () => {}),
      insert1hRollups: vi.fn(async () => {}),
      purgeOldRawSamples: vi.fn(async () => 0),
      purgeOld5mRollups: vi.fn(async () => 0),
    };

    const worker = new StatsRollupWorker(store);
    // Initial boot sweep: 1 single range query per metric instead of 24 per-bucket queries!
    await worker.processRollups();
    expect(queryRawSamples).toHaveBeenCalledTimes(2);

    // Second sweep with no dirty metrics: ZERO database queries!
    queryRawSamples.mockClear();
    listMetadata.mockClear();
    await worker.processRollups();
    expect(listMetadata).not.toHaveBeenCalled();
    expect(queryRawSamples).not.toHaveBeenCalled();

    // Mark only m1 dirty: only m1 is queried (1 query, not 48!).
    worker.markDirty('m1');
    await worker.processRollups();
    expect(queryRawSamples).toHaveBeenCalledTimes(1);
  });

  it('removing a stale duplicate device preserves shared endpoint index and state for the live parent device', async () => {
    const home = new StandaloneHomeService();
    const sharedEp: HausDevice['endpoints'][number] = {
      id: 'switch.strip_channel_2',
      name: 'Wall Garland',
      capabilities: [
        { id: 'power', kind: 'boolean', operations: ['read', 'write'], readable: true },
      ],
      readings: {},
    };
    home.registerDevice({
      id: 'ha:meross:parent',
      name: 'Bedroom Desk Surge Protector',
      category: 'appliances',
      availability: 'online',
      source: { instanceId: 'ha:meross', externalId: 'parent' },
      connectivity: { protocol: 'mqtt' },
      endpoints: [sharedEp],
    });
    // Register stale duplicate AFTER parent so byEndpointId initially points to duplicate.
    home.registerDevice({
      id: 'ha:meross:dup_channel_2',
      name: 'Power strip Channel 2',
      category: 'appliances',
      availability: 'offline',
      source: { instanceId: 'ha:meross', externalId: 'dup_channel_2' },
      connectivity: { protocol: 'mqtt' },
      endpoints: [sharedEp],
    });
    await home.updateEndpointState('switch.strip_channel_2', { power: true }, false);

    expect(home.removeDevice('ha:meross:dup_channel_2')).toBe(true);
    expect(home.devices.getDeviceByEndpointId('switch.strip_channel_2')?.id).toBe('ha:meross:parent');
    expect(home.getEndpointState('switch.strip_channel_2')).toEqual({ power: true });
  });

  it('registerDevice ignores reading-only observedAt churn without rewriting device/state or firing registryChanged', async () => {
    const published: Array<{ topic: string; registryChanged?: boolean }> = [];
    const liveService: LiveService = {
      publish: (topic, opts) => {
        published.push({ topic, registryChanged: opts?.registryChanged });
      },
      getState: () => ({
        protocol: 1,
        instance: 'test',
        sequence: 1,
        topic: 'home',
        revision: '1',
        connected: true,
      }),
      setConnected: () => {},
      setRevision: () => {},
      setSourcesProvider: () => {},
      authorize: () => true,
      addClient: () => {},
      removeClient: () => {},
      getClientCount: () => 0,
    };
    const home = new StandaloneHomeService(liveService);
    const saveSpy = vi.spyOn(home.getPersistence(), 'save');
    try {
      const makeTuya = (observedAt: string, onOff = true): HausDevice => ({
        id: 'tuya:plug1',
        name: 'Tuya Plug',
        category: 'power',
        availability: 'online',
        source: { instanceId: 'tuya-entry', externalId: 'plug1' },
        connectivity: { protocol: 'local_ip' },
        endpoints: [
          {
            id: 'ep_tuya_plug1_switch',
            name: 'Tuya Plug',
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
            ],
            readings: { on_off: { value: onOff, observedAt, freshness: 'live' } },
          },
        ],
      });

      home.registerDevice(makeTuya('2026-11-21T12:00:00.000Z', true));
      await new Promise((r) => setImmediate(r));
      saveSpy.mockClear();
      published.length = 0;

      // Polling again with a fresh observedAt timestamp but identical metadata & values must do ZERO work.
      home.registerDevice(makeTuya('2026-11-21T12:00:15.000Z', true));
      await new Promise((r) => setImmediate(r));
      expect(saveSpy).not.toHaveBeenCalled();
      expect(published).toHaveLength(0);

      // A changed reading value updates endpoint_state and publishes state delta, NOT registryChanged.
      home.registerDevice(makeTuya('2026-11-21T12:00:30.000Z', false));
      await new Promise((r) => setImmediate(r));
      expect(saveSpy).toHaveBeenCalledWith('endpoint_state', 'ep_tuya_plug1_switch', { on_off: false });
      expect(saveSpy).not.toHaveBeenCalledWith('device', expect.anything(), expect.anything());
      expect(published.some((e) => e.registryChanged === true)).toBe(false);
    } finally {
      await home.onModuleDestroy();
    }
  });

  it('compacts oversized metadata blobs out of endpoint_history snapshots', () => {
    const compact = compactHistoryState({
      state: 'on',
      brightness: 180,
      hs_color: [120, 50],
      attributes: { huge: 'x'.repeat(2000) },
      effect_list: Array.from({ length: 40 }, (_, i) => `fx_${i}`),
      platform_metadata: { a: 1, b: 2 },
      platform_state: { raw: true },
      oversized_text: 'y'.repeat(1000),
    });
    expect(compact).toEqual({ state: 'on', brightness: 180, hs_color: [120, 50] });

    const tracker = new HomeStatsTracker();
    const saved: Array<{ id: string; entries: unknown[] }> = [];
    tracker.recordUpdate(
      'ep_light_1',
      { state: 'on', brightness: 200, attributes: { foo: 'bar' }, platform_state: { raw: 1 } },
      { brightness: 200 },
      undefined,
      (id, entries) => saved.push({ id, entries }),
      undefined,
      100_000,
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.entries).toEqual([{ tsMs: 100_000, state: { state: 'on', brightness: 200 } }]);
  });

  it('coalesces queued relative brightness_step_pct commands by summing deltas clamped to [-100, 100]', async () => {
    const home = new StandaloneHomeService();
    try {
      home.registerDevice({
        id: 'dev_dim_1',
        name: 'Narnia Lamp',
        category: 'lighting',
        availability: 'online',
        source: { instanceId: 'ha:meross', externalId: 'dim_1' },
        connectivity: { protocol: 'local_ip' },
        endpoints: [
          {
            id: 'light.narnia_rgb',
            name: 'Narnia Lamp',
            sourceOwner: { protocol: 'vendor', externalId: 'meross-1', domain: 'ha' },
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
            ],
            readings: {},
          },
        ],
      });
      const executed: Array<{ command: string; params?: Record<string, unknown> }> = [];
      let releaseFirst!: () => void;
      const gate = new Promise<void>((r) => {
        releaseFirst = r;
      });
      let first = true;
      home.registerCommandHandler(
        { protocol: 'vendor', externalId: 'meross-1', domain: 'ha' },
        async (_ep, _cap, cmd, params) => {
          if (first) {
            first = false;
            await gate;
          }
          executed.push({ command: cmd, params: params ? { ...params } : undefined });
        },
        { optimistic: false },
      );

      const p1 = home.executeDeviceCommand('light.narnia_rgb', 'on_off', 'turn_on', {
        brightness_step_pct: 20,
        transition: 1,
      });
      const p2 = home.executeDeviceCommand('light.narnia_rgb', 'on_off', 'turn_on', {
        brightness_step_pct: 20,
        transition: 1,
      });
      const p3 = home.executeDeviceCommand('light.narnia_rgb', 'on_off', 'turn_on', {
        brightness_step_pct: 20,
        transition: 1,
      });
      const p4 = home.executeDeviceCommand('light.narnia_rgb', 'on_off', 'turn_on', {
        brightness_step_pct: 80,
        transition: 1,
      });

      releaseFirst();
      await Promise.all([p1, p2, p3, p4]);

      expect(executed).toEqual([
        { command: 'turn_on', params: { brightness_step_pct: 20, transition: 1 } },
        { command: 'turn_on', params: { brightness_step_pct: 100, transition: 1 } },
      ]);
    } finally {
      await home.onModuleDestroy();
    }
  });

  it('ClusterSnapshotCodec.exportConfigBundle strips local-only app logs before cluster sync', async () => {
    const fakeTx = {
      read: async <T>(fn: (manager: unknown) => Promise<T>) =>
        fn({
          find: async () => [
            {
              kind: 'app',
              entryId: 'govee',
              value: JSON.stringify({
                manifest: { id: 'govee' },
                state: 'running',
                logs: ['line1', 'line2', 'line3'],
              }),
              updatedAt: 1000,
            },
          ],
          findOneBy: async () => null,
        }),
    } as unknown as Transactions;

    const codec = new ClusterSnapshotCodec(fakeTx);
    const bundle = await codec.exportConfigBundle();
    expect(bundle.entries).toHaveLength(1);
    const parsed = JSON.parse(bundle.entries[0]!.value) as { logs: string[]; state: string };
    expect(parsed.state).toBe('running');
    expect(parsed.logs).toEqual([]);
  });
});
