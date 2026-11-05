/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  ConnectivityState,
  evaluateContinuityStatus,
  HubRole,
  HubTopologyManager,
  type HubTopologyNode,
} from '../src/index.js';

describe('Hub Roles & Local Continuity', () => {
  const baseCapacity = {
    cpuCores: 4,
    memoryBytes: 8 * 1024 * 1024 * 1024,
    storageAvailableBytes: 200 * 1024 * 1024 * 1024,
    hasHardwareTranscoder: true,
    attachedRadios: ['zigbee' as const, 'matter' as const],
  };

  it('runs cleanly in standalone single-hub home with full local continuity', () => {
    const manager = new HubTopologyManager({
      hubId: 'hub_primary',
      name: 'Living Room Hub',
      address: '192.168.1.10',
      capacity: baseCapacity,
    });

    const node = manager.getLocalNode();
    expect(node.role).toBe(HubRole.Standalone);
    expect(node.generation).toBe(1);

    const status = manager.getContinuityStatus();
    expect(status.localContinuityIntact).toBe(true);
    expect(status.canExecuteLocalAutomations).toBe(true);
    expect(status.canControlLocalRadios).toBe(true);
    expect(status.canRecordLocalMedia).toBe(true);
    expect(status.coordinatorAvailable).toBe(true);
    expect(status.connectivity).toBe(ConnectivityState.Online);
    expect(status.peerCount).toBe(0);
    expect(status.warnings).toHaveLength(0);
  });

  it('preserves 100% local continuity upon coordinator loss', () => {
    const now = Date.now();

    const localMember: HubTopologyNode = {
      hubId: 'hub_secondary',
      name: 'Basement Hub',
      role: HubRole.Member,
      address: '192.168.1.11',
      generation: 1,
      capacity: baseCapacity,
      ownedResources: ['radio:zigbee:dongle2'],
      lastHeartbeat: new Date(now).toISOString(),
      connectivity: ConnectivityState.Online,
    };

    const staleCoordinator: HubTopologyNode = {
      hubId: 'hub_coordinator',
      name: 'Main Coordinator Hub',
      role: HubRole.Coordinator,
      address: '192.168.1.10',
      generation: 1,
      capacity: baseCapacity,
      ownedResources: ['radio:zigbee:dongle1', 'token:spotify'],
      lastHeartbeat: new Date(now - 30000).toISOString(), // 30s ago -> timed out (> 15s)
      connectivity: ConnectivityState.Online,
    };

    const status = evaluateContinuityStatus(localMember, [staleCoordinator], {
      currentTime: now,
      heartbeatTimeoutMs: 15000,
    });

    expect(status.coordinatorAvailable).toBe(false);
    expect(status.unreachablePeers).toContain('hub_coordinator');
    expect(status.connectivity).toBe(ConnectivityState.PeerPartitioned);

    // CRITICAL: Local workloads continue without pause!
    expect(status.localContinuityIntact).toBe(true);
    expect(status.canExecuteLocalAutomations).toBe(true);
    expect(status.canControlLocalRadios).toBe(true);
    expect(status.canRecordLocalMedia).toBe(true);
    expect(status.warnings.some((w) => w.includes('Coordinator hub'))).toBe(true);
  });

  it('preserves local workloads upon peer loss without flapping assignments', () => {
    const now = Date.now();

    const coordinatorNode: HubTopologyNode = {
      hubId: 'hub_coordinator',
      name: 'Main Coordinator Hub',
      role: HubRole.Coordinator,
      address: '192.168.1.10',
      generation: 1,
      capacity: baseCapacity,
      ownedResources: ['radio:zigbee:dongle1'],
      lastHeartbeat: new Date(now).toISOString(),
      connectivity: ConnectivityState.Online,
    };

    const lostPeer: HubTopologyNode = {
      hubId: 'hub_garage',
      name: 'Garage Hub',
      role: HubRole.Member,
      address: '192.168.1.12',
      generation: 1,
      capacity: baseCapacity,
      ownedResources: ['radio:zigbee:dongle2'],
      lastHeartbeat: new Date(now - 25000).toISOString(),
      connectivity: ConnectivityState.Online,
    };

    const status = evaluateContinuityStatus(coordinatorNode, [lostPeer], {
      currentTime: now,
      heartbeatTimeoutMs: 15000,
    });

    expect(status.coordinatorAvailable).toBe(true);
    expect(status.unreachablePeers).toContain('hub_garage');
    expect(status.localContinuityIntact).toBe(true);
    expect(status.canExecuteLocalAutomations).toBe(true);
  });

  it('handles WAN internet loss gracefully while keeping all LAN features active', () => {
    const manager = new HubTopologyManager({
      hubId: 'hub_primary',
      name: 'Living Room Hub',
      address: '192.168.1.10',
      capacity: baseCapacity,
    });

    manager.setInternetAvailability(false);

    const status = manager.getContinuityStatus();
    expect(status.internetAvailable).toBe(false);
    expect(status.connectivity).toBe(ConnectivityState.InternetLoss);
    // Local LAN operations fully intact
    expect(status.localContinuityIntact).toBe(true);
    expect(status.canExecuteLocalAutomations).toBe(true);
    expect(status.canControlLocalRadios).toBe(true);
    expect(status.warnings.some((w) => w.includes('WAN internet unreachable'))).toBe(true);
  });

  it('functions in complete isolation when both peers and WAN are lost', () => {
    const now = Date.now();

    const isolatedNode: HubTopologyNode = {
      hubId: 'hub_guest_house',
      name: 'Guest House Hub',
      role: HubRole.Member,
      address: '192.168.1.50',
      generation: 1,
      capacity: baseCapacity,
      ownedResources: ['radio:zigbee:dongle_guest'],
      lastHeartbeat: new Date(now).toISOString(),
      connectivity: ConnectivityState.Online,
    };

    const deadPeer: HubTopologyNode = {
      hubId: 'hub_main',
      name: 'Main Hub',
      role: HubRole.Coordinator,
      address: '192.168.1.10',
      generation: 1,
      capacity: baseCapacity,
      ownedResources: [],
      lastHeartbeat: new Date(now - 60000).toISOString(),
      connectivity: ConnectivityState.Online,
    };

    const status = evaluateContinuityStatus(isolatedNode, [deadPeer], {
      currentTime: now,
      internetAvailable: false,
    });

    expect(status.connectivity).toBe(ConnectivityState.Isolated);
    expect(status.localContinuityIntact).toBe(true);
    expect(status.canExecuteLocalAutomations).toBe(true);
    expect(status.canControlLocalRadios).toBe(true);
    expect(status.warnings.some((w) => w.includes('complete isolation'))).toBe(true);
  });

  it('manages local resource claims and generation counter increments', () => {
    const manager = new HubTopologyManager({
      hubId: 'hub_1',
      name: 'Office Hub',
      address: '192.168.1.20',
      capacity: baseCapacity,
      role: HubRole.Member,
    });

    expect(manager.canExecuteLocally('zigbee:dongle')).toBe(false);

    manager.claimResource('zigbee:dongle');
    expect(manager.isResourceOwnedLocally('zigbee:dongle')).toBe(true);
    expect(manager.canExecuteLocally('zigbee:dongle')).toBe(true);

    const prevGen = manager.getLocalNode().generation;
    const nextGen = manager.incrementGeneration();
    expect(nextGen).toBe(prevGen + 1);
    expect(manager.getLocalNode().generation).toBe(nextGen);

    manager.releaseResource('zigbee:dongle');
    expect(manager.isResourceOwnedLocally('zigbee:dongle')).toBe(false);
  });
});
