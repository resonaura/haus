/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import { createLiveClusterNode, pairAndJoinPeer } from './harness.js';

describe('ClusterSyncService bounded cache replication & selective backoff', () => {
  it('bounds >5 MiB endpoint_history inside E2EE envelopes while preserving all endpoint_state rows', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-cache-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-cache-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });

      const now = Date.now();
      const bigSample = {
        state: 'Available',
        attributes: { lan: { blob: 'x'.repeat(1800) } },
      };
      const hugeHistory = JSON.stringify(
        Array.from({ length: 350 }, (_, idx) => ({ tsMs: now - (350 - idx) * 1000, state: bigSample })),
      );
      const compactHistory = JSON.stringify(
        Array.from({ length: 40 }, (_, idx) => ({
          tsMs: now - (40 - idx) * 1000,
          state: { temperature: 20 + idx * 0.1 },
        })),
      );

      await coord.transactions.run(async (manager) => {
        for (let i = 0; i < 8; i += 1) {
          await manager.upsert(
            StandaloneHomeEntryEntity,
            {
              kind: 'endpoint_history',
              entryId: `ep_huge_${i}`,
              value: hugeHistory,
              updatedAt: now - i * 1000,
            },
            ['kind', 'entryId'],
          );
        }
        for (let i = 0; i < 12; i += 1) {
          await manager.upsert(
            StandaloneHomeEntryEntity,
            {
              kind: 'endpoint_history',
              entryId: `ep_compact_${i}`,
              value: compactHistory,
              updatedAt: now + 10_000 + i,
            },
            ['kind', 'entryId'],
          );
          await manager.upsert(
            StandaloneHomeEntryEntity,
            {
              kind: 'endpoint_state',
              entryId: `ep_compact_${i}`,
              value: JSON.stringify({ state: 'on', temperature: 21 + i }),
              updatedAt: now + 10_000 + i,
            },
            ['kind', 'entryId'],
          );
        }
      });

      const res = await coord.syncService.syncPeer(worker.hubId, { force: true });
      expect(res.accepted).toBe(3);
      expect(res.rejected).toEqual([]);

      const replicatedStates = await worker.transactions.run((manager) =>
        manager.find(StandaloneHomeEntryEntity, { where: { kind: 'endpoint_state' } }),
      );
      expect(replicatedStates.length).toBe(12);

      const replicatedHistory = await worker.transactions.run((manager) =>
        manager.find(StandaloneHomeEntryEntity, { where: { kind: 'endpoint_history' } }),
      );
      expect(replicatedHistory.length).toBeGreaterThanOrEqual(12);
      const sampleCompact = replicatedHistory.find((r) => r.entryId === 'ep_compact_0');
      expect(sampleCompact).toBeTruthy();
      const parsedCompact = JSON.parse(sampleCompact!.value) as Array<{ tsMs: number }>;
      expect(parsedCompact.length).toBe(20);
      expect(parsedCompact[parsedCompact.length - 1]!.tsMs).toBe(now - 1000);
    } finally {
      await worker.close();
      await coord.close();
    }
  });

  it('pushes only changed selective kinds and backs off when a peer is unreachable', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-sel-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-sel-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      await coord.syncService.syncPeer(worker.hubId, { force: true });

      const codec = coord.syncService.getCodec();
      const credSpy = vi.spyOn(codec, 'exportCredentialBundle');
      const cfgSpy = vi.spyOn(codec, 'exportConfigBundle');
      const cacheSpy = vi.spyOn(codec, 'exportCacheBundle');

      // Incremental cache notify must NOT export credentials or config.
      await coord.transactions.run(async (manager) => {
        await manager.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'endpoint_state',
            entryId: 'ep_sensor_1',
            value: JSON.stringify({ state: 'on' }),
            updatedAt: Date.now(),
          },
          ['kind', 'entryId'],
        );
      });
      await coord.syncService.notifyLocalCredentialOrConfigChange('cache', 'ep_sensor_1');
      expect(credSpy).not.toHaveBeenCalled();
      expect(cfgSpy).not.toHaveBeenCalled();
      expect(cacheSpy).toHaveBeenCalledTimes(1);

      // Stop worker to verify failure backoff prevents tight-loop push storms.
      await worker.close();
      const syncSpy = vi.spyOn(coord.syncService, 'syncPeer');
      await coord.transactions.run(async (manager) => {
        await manager.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'endpoint_state',
            entryId: 'ep_sensor_1',
            value: JSON.stringify({ state: 'off' }),
            updatedAt: Date.now() + 1000,
          },
          ['kind', 'entryId'],
        );
      });
      await coord.syncService.notifyLocalCredentialOrConfigChange('cache', 'ep_sensor_1');
      await coord.syncService.notifyLocalCredentialOrConfigChange('cache', 'ep_sensor_1');
      await coord.syncService.notifyLocalCredentialOrConfigChange('cache', 'ep_sensor_1');
      // Only the first failing attempt runs; subsequent immediate calls honor backoff.
      expect(syncSpy).toHaveBeenCalledTimes(1);
    } finally {
      await worker.close().catch(() => undefined);
      await coord.close();
    }
  });
});
