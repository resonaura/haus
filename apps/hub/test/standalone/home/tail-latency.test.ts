/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HausDevice } from '@haus/core';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { HomeStatsTracker } from '../../../src/home/home-stats.js';
import { StatsRollupWorker, type StatsRollupStorePort } from '../../../src/stats/stats.worker.js';
import type { LiveService } from '../../../src/live/types.js';

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
});
