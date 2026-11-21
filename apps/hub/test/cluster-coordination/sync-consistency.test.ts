/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import type { SyncBundleKind } from '../../src/cluster/sync/service.js';
import { createLiveClusterNode, pairAndJoinPeer } from './harness.js';

describe('ClusterSyncService consistency, LWW freshness, deletion pruning, and low-overhead paths', () => {
  it('drains trailing concurrent sync pushes instead of dropping updates while a push is in flight', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-pend-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-pend-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      await coord.syncService.syncPeer(worker.hubId, { force: true });

      const originalSyncPeer = coord.syncService.syncPeer.bind(coord.syncService);
      let releaseFirstPush!: () => void;
      let firstPushStarted!: () => void;
      const firstStartedPromise = new Promise<void>((r) => {
        firstPushStarted = r;
      });
      let calls = 0;

      vi.spyOn(coord.syncService, 'syncPeer').mockImplementation(async (peerId, opts) => {
        calls += 1;
        if (calls === 1) {
          firstPushStarted();
          await new Promise<void>((resolve) => {
            releaseFirstPush = resolve;
          });
        }
        return originalSyncPeer(peerId, opts);
      });

      // First config change starts push #1 and pauses mid-flight.
      await coord.transactions.run(async (m) => {
        await m.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'room',
            entryId: 'room-1',
            value: JSON.stringify({ id: 'room-1', name: 'Kitchen' }),
            updatedAt: Date.now(),
          },
          ['kind', 'entryId'],
        );
      });
      const push1 = coord.syncService.notifyLocalCredentialOrConfigChange('config', 'room-1');
      await firstStartedPromise;

      // Second config change arrives while push #1 is still in flight — must queue trailing sync!
      await coord.transactions.run(async (m) => {
        await m.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'room',
            entryId: 'room-2',
            value: JSON.stringify({ id: 'room-2', name: 'Bedroom' }),
            updatedAt: Date.now() + 50,
          },
          ['kind', 'entryId'],
        );
      });
      const push2 = coord.syncService.notifyLocalCredentialOrConfigChange('config', 'room-2');
      releaseFirstPush();
      await Promise.all([push1, push2]);

      expect(calls).toBe(2);
      const workerRooms = await worker.transactions.read((m) =>
        m.find(StandaloneHomeEntryEntity, { where: { kind: 'room' } }),
      );
      expect(workerRooms.map((r) => r.entryId).sort()).toEqual(['room-1', 'room-2']);
    } finally {
      await worker.close();
      await coord.close();
    }
  });

  it('prunes coordinator deletions on standby, protects newer states via LWW, and scopes cache listeners', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-lww-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-lww-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      const workerHome = worker.homeService;

      const appliedEvents: Array<ReadonlySet<SyncBundleKind>> = [];
      worker.syncService.onSnapshotApplied((kinds) => {
        appliedEvents.push(kinds);
      });

      const baseTime = Date.now();
      await coord.transactions.run(async (m) => {
        await m.upsert(
          StandaloneHomeEntryEntity,
          [
            {
              kind: 'scene',
              entryId: 'scene-keep',
              value: JSON.stringify({ id: 'scene-keep', name: 'Keep', members: [] }),
              updatedAt: baseTime,
            },
            {
              kind: 'scene',
              entryId: 'scene-remove',
              value: JSON.stringify({ id: 'scene-remove', name: 'Remove', members: [] }),
              updatedAt: baseTime,
            },
            {
              kind: 'endpoint_state',
              entryId: 'ep_light_1',
              value: JSON.stringify({ state: 'on', brightness: 120 }),
              updatedAt: baseTime + 5000,
            },
            {
              kind: 'endpoint_history',
              entryId: 'ep_light_1',
              value: JSON.stringify([{ tsMs: baseTime, state: { state: 'on' } }]),
              updatedAt: baseTime,
            },
          ],
          ['kind', 'entryId'],
        );
      });

      await coord.syncService.syncPeer(worker.hubId, { force: true });
      expect(workerHome.listScenes().map((s) => s.id).sort()).toEqual([
        'scene-keep',
        'scene-remove',
      ]);

      // Delete scene-remove on coordinator and push config -> standby must prune it from DB + memory!
      await coord.transactions.run(async (m) => {
        await m.delete(StandaloneHomeEntryEntity, { kind: 'scene', entryId: 'scene-remove' });
      });
      await coord.syncService.notifyLocalCredentialOrConfigChange('config', 'scene-remove');
      expect(workerHome.listScenes().map((s) => s.id)).toEqual(['scene-keep']);

      // Lightweight cache-only sync: fires ONLY 'cache' kind and preserves existing endpoint_history!
      appliedEvents.length = 0;
      await coord.transactions.run(async (m) => {
        await m.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'endpoint_state',
            entryId: 'ep_light_1',
            value: JSON.stringify({ state: 'on', brightness: 220 }),
            updatedAt: baseTime + 10_000,
          },
          ['kind', 'entryId'],
        );
      });
      await coord.syncService.notifyLocalCredentialOrConfigChange('cache', 'ep_light_1');
      expect(appliedEvents).toHaveLength(1);
      expect([...appliedEvents[0]!]).toEqual(['cache']);
      expect(workerHome.getEndpointState('ep_light_1')?.brightness).toBe(220);

      const historyStillPresent = await worker.transactions.read((m) =>
        m.find(StandaloneHomeEntryEntity, { where: { kind: 'endpoint_history' } }),
      );
      expect(historyStillPresent).toHaveLength(1);

      // LWW protection: applying an older cache bundle must NOT roll back brightness 220 -> 50.
      const staleApplied = await worker.syncService.getCodec().applyCacheBundle({
        endpointStates: [
          {
            kind: 'endpoint_state',
            entryId: 'ep_light_1',
            value: JSON.stringify({ state: 'on', brightness: 50 }),
            updatedAt: baseTime + 1000,
          },
        ],
        endpointHistory: [],
        mediaDescriptors: [],
        backupDescriptors: [],
      });
      expect(staleApplied).toBe(0);
      const persistedRow = await worker.transactions.read((m) =>
        m.findOneBy(StandaloneHomeEntryEntity, { kind: 'endpoint_state', entryId: 'ep_light_1' }),
      );
      expect(JSON.parse(persistedRow!.value)).toMatchObject({ brightness: 220 });

      // Zero-crypto peer trust fast-path & cached channelSecret consistency.
      expect(coord.stateStore.hasTrustedPeersSync()).toBe(true);
      const firstTrust = coord.stateStore.getPeerTrustRecord(worker.hubId);
      const secondTrust = coord.stateStore.getPeerTrustRecord(worker.hubId);
      expect(firstTrust?.channelSecret).toBeTruthy();
      expect(secondTrust?.channelSecret).toBe(firstTrust?.channelSecret);
    } finally {
      await worker.close();
      await coord.close();
    }
  });

  it('returns updated endpoint state immediately when forwarding a device command from standby to owner', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-fwd-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-fwd-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      const workerHome = worker.homeService;

      // Register an integration workload owned by coordinator that returns updated state.
      coord.leases.registerWorkloadController('integration:hue-entry-1', {
        kind: 'integration',
        name: 'Hue',
        requirements: {},
        getLocalStatus: () => 'running',
        startLocal: async () => {},
        stopLocal: async () => {},
        executeRemote: async (action, payload) => {
          if (action === 'execute_device_command') {
            return {
              ok: true,
              state: {
                state: 'on',
                on_off: true,
                brightness: (payload?.parameters as { brightness?: number })?.brightness ?? 255,
              },
            };
          }
          return { ignored: true };
        },
      });
      await coord.leases.ensureLocalOwnership({
        workloadId: 'integration:hue-entry-1',
        kind: 'integration',
        name: 'Hue',
        requirements: {},
        active: true,
      });
      await coord.syncService.syncPeer(worker.hubId, { force: true });

      workerHome.registerDevice({
        id: 'dev_fwd_lamp',
        name: 'Forwarded Lamp',
        category: 'lighting',
        availability: 'online',
        connectivity: { protocol: 'virtual' },
        roomId: 'living',
        source: { instanceId: 'hue-entry-1', externalId: 'dev_fwd_lamp' },
        endpoints: [
          {
            id: 'ep_fwd_lamp',
            name: 'Forwarded Lamp',
            sourceOwner: { protocol: 'vendor', externalId: 'hue-entry-1', domain: 'hue' },
            readings: {},
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
              { id: 'brightness', kind: 'percentage', readable: true, operations: ['set'] },
            ],
          },
        ],
      });

      const receipt = await workerHome.executeDeviceCommand('ep_fwd_lamp', 'on_off', 'turn_on', {
        brightness: 185,
      });
      expect(receipt.state).toMatchObject({ state: 'on', on_off: true, brightness: 185 });
      expect(workerHome.getEndpointState('ep_fwd_lamp')).toMatchObject({
        state: 'on',
        brightness: 185,
      });
    } finally {
      await worker.close();
      await coord.close();
    }
  });
});
