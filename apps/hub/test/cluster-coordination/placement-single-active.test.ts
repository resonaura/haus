/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ClusterPlacementPlanner } from '../../src/cluster/coordination/placement.js';
import {
  createLiveClusterNode,
  pairAndJoinPeer,
  type LiveTestClusterNode,
} from './harness.js';

describe('Cluster load balancing, single-active execution, Fence-Before-Promote & forwarding', () => {
  const nodes: LiveTestClusterNode[] = [];
  afterEach(async () => {
    for (const node of nodes.splice(0)) {
      await node.close();
    }
  });

  it('distributes workloads across heterogeneous hubs respecting capacity, memory & exclusive radios', () => {
    const planner = new ClusterPlacementPlanner();
    const summary = planner.planDistribution({
      currentOwners: new Map(),
      workloads: [
        {
          id: 'integration:zigbee:main',
          kind: 'integration',
          name: 'Zigbee',
          requirements: { requiredRadio: 'zigbee' },
        },
        {
          id: 'app:scrypted-nvr',
          kind: 'vision',
          name: 'Vision NVR',
          requirements: { minMemoryMb: 2048, forbiddenOnWeakHub: true },
        },
        {
          id: 'app:media-transcoder',
          kind: 'media',
          name: 'Transcoder',
          requirements: { requiresHardwareTranscoder: true, minMemoryMb: 1024 },
        },
        {
          id: 'app:homebridge-hue',
          kind: 'app',
          name: 'Hue Bridge',
          requirements: { minMemoryMb: 256 },
        },
      ],
      nodes: [
        {
          hubId: 'hub-pi',
          name: 'Pi',
          available: true,
          capacity: {
            cpuCores: 2,
            memoryBytes: 1024 * 1024 * 1024,
            storageAvailableBytes: 10 * 1024 ** 3,
            hasHardwareTranscoder: false,
            attachedRadios: ['zigbee'],
          },
          isWeakHub: true,
        },
        {
          hubId: 'hub-server',
          name: 'Server',
          available: true,
          capacity: {
            cpuCores: 8,
            memoryBytes: 16 * 1024 ** 3,
            storageAvailableBytes: 500 * 1024 ** 3,
            hasHardwareTranscoder: true,
            attachedRadios: [],
          },
          isWeakHub: false,
        },
      ],
    });

    const ownerOf = (id: string) =>
      summary.plans.find((p) => p.workload.id === id)?.decision.assignedHubId;

    // Exclusive Zigbee radio pins Zigbee to hub-pi despite weak CPU
    expect(ownerOf('integration:zigbee:main')).toBe('hub-pi');
    // Heavy memory & transcoder workloads land on strong hub-server
    expect(ownerOf('app:scrypted-nvr')).toBe('hub-server');
    expect(ownerOf('app:media-transcoder')).toBe('hub-server');
    expect(ownerOf('app:homebridge-hue')).toBe('hub-server');

    // Equal-strength cluster spreads multiple apps across both nodes
    const equalSummary = planner.planDistribution({
      currentOwners: new Map(),
      workloads: ['a', 'b', 'c', 'd'].map((id) => ({
        id: `app:${id}`,
        kind: 'app' as const,
        name: id,
        requirements: { minMemoryMb: 128 },
      })),
      nodes: [
        {
          hubId: 'hub-1',
          name: 'Hub 1',
          available: true,
          capacity: {
            cpuCores: 4,
            memoryBytes: 8 * 1024 ** 3,
            storageAvailableBytes: 100 * 1024 ** 3,
            hasHardwareTranscoder: false,
            attachedRadios: [],
          },
          isWeakHub: false,
        },
        {
          hubId: 'hub-2',
          name: 'Hub 2',
          available: true,
          capacity: {
            cpuCores: 4,
            memoryBytes: 8 * 1024 ** 3,
            storageAvailableBytes: 100 * 1024 ** 3,
            hasHardwareTranscoder: false,
            attachedRadios: [],
          },
          isWeakHub: false,
        },
      ],
    });
    const owners = equalSummary.plans.map((p) => p.decision.assignedHubId);
    expect(owners.filter((o) => o === 'hub-1').length).toBe(2);
    expect(owners.filter((o) => o === 'hub-2').length).toBe(2);
  });

  it('enforces single-active ownership over HTTP, forwards commands from standby, and fences before promote', async () => {
    const hub1 = await createLiveClusterNode({ hubId: 'hub-main', role: 'coordinator' });
    const hub2 = await createLiveClusterNode({ hubId: 'hub-worker', role: 'node', homeId: hub1.homeId });
    nodes.push(hub1, hub2);
    await pairAndJoinPeer({ coordinator: hub1, secondary: hub2 });

    const events: string[] = [];
    let state1: 'running' | 'stopped' = 'running';
    let state2: 'running' | 'stopped' = 'stopped';

    hub1.leases.registerWorkloadController('app:sonos', {
      kind: 'app',
      name: 'Sonos Bridge',
      async startLocal() {
        events.push('hub1:start');
        state1 = 'running';
      },
      async stopLocal(reason) {
        events.push(`hub1:stop:${reason}`);
        state1 = 'stopped';
      },
      getLocalStatus() {
        return state1;
      },
      async executeRemote(action, payload) {
        events.push(`hub1:exec:${action}`);
        return { handledBy: 'hub-main', action, payload };
      },
    });

    hub2.leases.registerWorkloadController('app:sonos', {
      kind: 'app',
      name: 'Sonos Bridge',
      async startLocal() {
        events.push('hub2:start');
        state2 = 'running';
      },
      async stopLocal(reason) {
        events.push(`hub2:stop:${reason}`);
        state2 = 'stopped';
      },
      getLocalStatus() {
        return state2;
      },
      async executeRemote(action, payload) {
        events.push(`hub2:exec:${action}`);
        return { handledBy: 'hub-worker', action, payload };
      },
    });

    await hub1.leases.ensureLocalOwnership({
      workloadId: 'app:sonos',
      kind: 'app',
      name: 'Sonos Bridge',
    });

    // Migrate owner from hub-main -> hub-worker using Fence-Before-Promote + E2EE sync
    const migrated = await hub1.leases.handoffWorkload({
      workloadId: 'app:sonos',
      targetHubId: 'hub-worker',
      beforePromoteSync: async (targetHubId) => {
        events.push(`sync:${targetHubId}`);
        await hub1.syncService.syncPeer(targetHubId);
      },
    });
    expect(migrated.ownerHubId).toBe('hub-worker');
    expect(state1).toBe('stopped');
    expect(state2).toBe('running');

    // Verify exact Fence-Before-Promote causal ordering:
    // 1. hub1 stopped -> 2. encrypted sync pushed -> 3. hub2 started
    const stopIdx = events.findIndex((e) => e.startsWith('hub1:stop:'));
    const syncIdx = events.indexOf('sync:hub-worker');
    const startIdx = events.indexOf('hub2:start');
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeGreaterThan(stopIdx);
    expect(startIdx).toBeGreaterThan(syncIdx);

    // Sync lease metadata to hub1 & verify hub1 delegates rather than running locally
    expect(hub1.leases.shouldRunLocally('app:sonos')).toBe(false);
    expect(hub2.leases.shouldRunLocally('app:sonos')).toBe(true);

    const forwarded = await hub1.orchestrator.forwardWorkloadCommand('app:sonos', 'play_chime', {
      volume: 42,
    });
    expect(forwarded).toEqual({
      handledBy: 'hub-worker',
      action: 'play_chime',
      payload: { volume: 42 },
    });
    expect(events).toContain('hub2:exec:play_chime');
    expect(events).not.toContain('hub1:exec:play_chime');

    // Persisted workload lease remains durable across reboot
    expect(hub1.stateStore.getWorkloadSync('app:sonos')?.ownerHubId).toBe('hub-worker');
  });
});
