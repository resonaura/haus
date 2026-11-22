/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import { createLiveClusterNode, pairAndJoinPeer } from './harness.js';

const ADMIN_ACTOR = { actorId: 'cluster-room-test', role: 'admin' as const };

function sampleDevice(overrides: Partial<HausDevice> = {}): HausDevice {
  return {
    id: 'tuya:lamp_1',
    source: { instanceId: 'tuya-entry-1', externalId: 'lamp_1' },
    name: 'Floor Lamp',
    category: 'lighting',
    roomId: 'living_room',
    areaId: 'living_room',
    availability: 'online',
    connectivity: { protocol: 'local_ip' },
    endpoints: [
      {
        id: 'ep_tuya_lamp_1',
        name: 'Floor Lamp',
        capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
        readings: {},
      },
    ],
    ...overrides,
  };
}

describe('Cluster multi-hub room persistence and bidirectional config convergence', () => {
  it('propagates worker room moves to coordinator without watermark rejection and survives stale authoritativePrune sync', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-rm-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-rm-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      await coord.homeService.roomManager.createRoom({ id: 'living_room', name: 'Living Room' });
      await coord.homeService.roomManager.createRoom({ id: 'bedroom', name: 'Bedroom' });
      coord.homeService.registerDevice(sampleDevice());
      await coord.homeService.getPersistence().flush();
      await coord.syncService.syncPeer(worker.hubId, { force: true });

      expect(worker.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('living_room');

      // Advance coordinator's own outbound config revision ahead of worker (normal live cluster state).
      await coord.homeService.roomManager.createRoom({ id: 'hallway', name: 'Hallway' });
      await coord.homeService.getPersistence().flush();
      await coord.syncService.buildEnvelopesForPeer({ recipientHubId: worker.hubId, kinds: ['config'] });

      // User moves the device to 'bedroom' on the worker node.
      await worker.homeService.roomManager.updateDevice(
        'tuya:lamp_1',
        { roomId: 'bedroom' },
        ADMIN_ACTOR,
      );
      expect(worker.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('bedroom');

      // Even if coordinator pushes its stale snapshot with authoritativePrune BEFORE worker's push arrives,
      // worker MUST keep its newer explicit 'bedroom' assignment.
      await coord.syncService.syncPeer(worker.hubId, { kinds: ['config'], force: true });
      expect(worker.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('bedroom');

      // Now worker pushes its config change to coordinator: MUST NOT be rejected as stale_secret_revision!
      const pushResult = await worker.syncService.syncPeer(coord.hubId, { kinds: ['config'] });
      expect(pushResult.rejected).toEqual([]);
      expect(pushResult.accepted).toBeGreaterThanOrEqual(1);
      expect(coord.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('bedroom');
    } finally {
      await worker.close();
      await coord.close();
    }
  });

  it('prevents a stale worker availability update with newer row updatedAt from clobbering coordinator room assignment', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-race-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-race-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      await coord.homeService.roomManager.createRoom({ id: 'living_room', name: 'Living Room' });
      await coord.homeService.roomManager.createRoom({ id: 'office', name: 'Office' });
      coord.homeService.registerDevice(sampleDevice());
      await coord.homeService.getPersistence().flush();
      await coord.syncService.syncPeer(worker.hubId, { force: true });

      // Coordinator explicitly moves device to 'office'.
      await coord.homeService.roomManager.updateDevice(
        'tuya:lamp_1',
        { roomId: 'office' },
        ADMIN_ACTOR,
      );
      expect(coord.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('office');

      // Before sync reaches worker, worker persists an availability flip with the old room and newer wall-clock timestamp.
      const staleOffline = sampleDevice({ roomId: 'living_room', availability: 'offline' });
      await worker.transactions.run(async (manager) => {
        await manager.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'device',
            entryId: staleOffline.id,
            value: JSON.stringify(staleOffline),
            updatedAt: Date.now() + 60_000,
          },
          ['kind', 'entryId'],
        );
      });

      const res = await worker.syncService.syncPeer(coord.hubId, { kinds: ['config'] });
      expect(res.rejected).toEqual([]);

      // Coordinator receives the availability update ('offline') while preserving 'office'!
      const coordDev = coord.homeService.getDevice('tuya:lamp_1');
      expect(coordDev?.availability).toBe('offline');
      expect(coordDev?.roomId).toBe('office');
    } finally {
      await worker.close();
      await coord.close();
    }
  });

  it('propagates strictly newer explicit room moves and room deletion (to unassigned) cleanly across hubs', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-del-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({ hubId: 'hub-del-worker', role: 'node' });
    try {
      await pairAndJoinPeer({ coordinator: coord, secondary: worker });
      await coord.homeService.roomManager.createRoom({ id: 'bedroom', name: 'Bedroom' });
      coord.homeService.registerDevice(sampleDevice({ roomId: 'unassigned', areaId: 'unassigned' }));
      await coord.homeService.roomManager.updateDevice(
        'tuya:lamp_1',
        { roomId: 'bedroom' },
        ADMIN_ACTOR,
      );
      await coord.syncService.syncPeer(worker.hubId, { kinds: ['config'], force: true });
      expect(worker.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('bedroom');
      expect(worker.homeService.roomManager.getRoom('bedroom')).toBeDefined();

      // Deleting 'bedroom' on coordinator explicitly moves device to 'unassigned' with a newer timestamp.
      await coord.homeService.roomManager.deleteRoom('bedroom', ADMIN_ACTOR);
      await coord.homeService.getPersistence().flush();
      await coord.syncService.syncPeer(worker.hubId, { kinds: ['config'], force: true });

      expect(worker.homeService.getDevice('tuya:lamp_1')?.roomId).toBe('unassigned');
      expect(worker.homeService.roomManager.getRoom('bedroom')).toBeUndefined();
    } finally {
      await worker.close();
      await coord.close();
    }
  });
});
