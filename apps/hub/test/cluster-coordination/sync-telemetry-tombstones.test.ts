/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import { createLiveClusterNode, pairAndJoinPeer } from './harness.js';

describe('ClusterSyncService deletion tombstones & watermarked telemetry/history replication', () => {
  it('propagates deletion tombstones and blocks stale resurrection while allowing newer recreations', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-tomb-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-tomb-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      const coordPersistence = coord.homeService.getPersistence();

      // Create room and replicate to worker
      await coordPersistence.save('room', 'room-guest', { id: 'room-guest', name: 'Guest Room' });
      await coordPersistence.flush();
      await coord.syncService.syncPeer(worker.hubId, { force: true });

      const beforeDelete = await worker.transactions.read((m) =>
        m.findOneBy(StandaloneHomeEntryEntity, { kind: 'room', entryId: 'room-guest' }),
      );
      expect(beforeDelete).toBeTruthy();

      // Delete on coordinator -> creates a config_tombstone row and syncs to worker
      await coordPersistence.remove('room', 'room-guest');
      await coord.syncService.notifyLocalCredentialOrConfigChange('config', 'room-guest');

      const afterDelete = await worker.transactions.read((m) =>
        m.findOneBy(StandaloneHomeEntryEntity, { kind: 'room', entryId: 'room-guest' }),
      );
      expect(afterDelete).toBeNull();

      const tombstone = await worker.transactions.read((m) =>
        m.findOneBy(StandaloneHomeEntryEntity, {
          kind: 'config_tombstone',
          entryId: 'room:room-guest',
        }),
      );
      expect(tombstone).toBeTruthy();

      // Simulate stale failover push carrying an older copy of room-guest -> MUST NOT resurrect!
      await worker.syncService.getCodec().applyConfigBundle(
        {
          entries: [
            {
              kind: 'room',
              entryId: 'room-guest',
              value: JSON.stringify({ id: 'room-guest', name: 'Zombie Room' }),
              updatedAt: tombstone!.updatedAt - 1000,
            },
          ],
        },
        worker.hubId,
        { authoritativePrune: false },
      );
      const afterStale = await worker.transactions.read((m) =>
        m.findOneBy(StandaloneHomeEntryEntity, { kind: 'room', entryId: 'room-guest' }),
      );
      expect(afterStale).toBeNull();

      // Re-create room with a strictly newer timestamp -> clears tombstone and applies cleanly!
      await worker.syncService.getCodec().applyConfigBundle(
        {
          entries: [
            {
              kind: 'room',
              entryId: 'room-guest',
              value: JSON.stringify({ id: 'room-guest', name: 'New Guest Room' }),
              updatedAt: tombstone!.updatedAt + 5000,
            },
          ],
        },
        worker.hubId,
        { authoritativePrune: false },
      );
      const recreated = await worker.transactions.read((m) =>
        m.findOneBy(StandaloneHomeEntryEntity, { kind: 'room', entryId: 'room-guest' }),
      );
      expect(recreated).toBeTruthy();
      expect(JSON.parse(recreated!.value).name).toBe('New Guest Room');
    } finally {
      await worker.close();
      await coord.close();
    }
  });

  it('replicates stats metadata, raw/5m/1h telemetry, and deep endpoint_history_events incrementally with durable watermarks', async () => {
    const coord = await createLiveClusterNode({
      hubId: 'hub-tel-coord',
      role: 'coordinator',
      includeStats: true,
    });
    const worker = await createLiveClusterNode({
      hubId: 'hub-tel-worker',
      role: 'node',
      includeStats: true,
    });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      const nowSec = Math.floor(Date.now() / 1000);
      const sixtyDaysAgoMs = Date.now() - 60 * 86_400_000;

      const meta = await coord.statsStore!.registerMetadata({
        statisticId: 'device.ep_temp.temperature',
        source: 'device',
        unit: '°C',
        kind: 'gauge',
        displayName: 'Living Room Temp',
        hasMean: true,
        hasSum: false,
      });
      await coord.statsStore!.insertRawSamples([
        { metadataId: meta.id, timestamp: nowSec - 60, value: 21.2 },
        { metadataId: meta.id, timestamp: nowSec - 30, value: 21.8 },
      ]);
      await coord.statsStore!.insert5mRollups([
        {
          metadataId: meta.id,
          startTs: nowSec - 600,
          min: 20.5,
          max: 21.5,
          mean: 21.0,
          first: 20.5,
          last: 21.5,
          sum: null,
          count: 10,
        },
      ]);
      await coord.statsStore!.insert1hRollups([
        {
          metadataId: meta.id,
          startTs: nowSec - 7200,
          min: 19.0,
          max: 22.0,
          mean: 20.5,
          first: 19.5,
          last: 21.5,
          sum: null,
          count: 120,
        },
      ]);
      await coord.statsStore!.insertEndpointHistory([
        {
          endpointId: 'ep_temp',
          tsMs: sixtyDaysAgoMs,
          stateJson: JSON.stringify({ temperature: 18.4 }),
        },
        {
          endpointId: 'ep_temp',
          tsMs: sixtyDaysAgoMs + 3_600_000,
          stateJson: JSON.stringify({ temperature: 21.8 }),
        },
      ]);

      // First incremental telemetry sync replicates all 5 tables to worker
      const first = await coord.syncService.syncPeer(worker.hubId, { kinds: ['telemetry'] });
      expect(first.accepted).toBe(1);
      expect(first.appliedItems).toBe(7); // 1 meta + 2 raw + 1 5m + 1 1h + 2 history

      // Worker StatsEngine metadata cache + StatsStore queries reflect synced data immediately
      expect(worker.statsEngine!.getMetadata('device.ep_temp.temperature')?.unit).toBe('°C');
      const workerRaw = await worker.statsStore!.queryRawSamples(meta.id, nowSec - 120, nowSec);
      expect(workerRaw.map((s) => s.value)).toEqual([21.2, 21.8]);
      const worker5m = await worker.statsStore!.query5mRollups(meta.id, nowSec - 1200, nowSec);
      expect(worker5m).toHaveLength(1);
      const worker1h = await worker.statsStore!.query1hRollups(meta.id, nowSec - 10_000, nowSec);
      expect(worker1h).toHaveLength(1);
      const workerHistory = await worker.statsStore!.queryEndpointHistory(
        ['ep_temp'],
        sixtyDaysAgoMs + 1_000,
        sixtyDaysAgoMs + 7_200_000,
      );
      expect(workerHistory['ep_temp']).toHaveLength(2); // includes baseline before fromMs + in-range!
      expect(workerHistory['ep_temp']![0]!.state.temperature).toBe(18.4);
      expect(workerHistory['ep_temp']![1]!.state.temperature).toBe(21.8);

      // Second sync with zero new data sends 0 envelopes (watermark held steady)
      const second = await coord.syncService.syncPeer(worker.hubId, { kinds: ['telemetry'] });
      expect(second.accepted).toBe(0);
      expect(second.appliedItems).toBe(0);

      // Adding 1 new history transition sends ONLY the 1 new row
      await coord.statsStore!.insertEndpointHistory([
        {
          endpointId: 'ep_temp',
          tsMs: sixtyDaysAgoMs + 7_200_000,
          stateJson: JSON.stringify({ temperature: 22.3 }),
        },
      ]);
      const third = await coord.syncService.syncPeer(worker.hubId, { kinds: ['telemetry'] });
      expect(third.accepted).toBe(1);
      expect(third.appliedItems).toBe(1);
    } finally {
      await worker.close();
      await coord.close();
    }
  });
});
