/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  ClusterAutomationSynchronizer,
  type CrossHubCommandRouter,
  type HausAutomationRule,
  type ReplicatedRulePackage,
} from '../src/index.js';

describe('ClusterAutomationSynchronizer & Cross-Hub Ownership', () => {
  const sampleRule: HausAutomationRule = {
    schemaVersion: 1,
    id: 'rule.goodnight_all',
    name: 'Goodnight All Rooms',
    enabled: true,
    triggers: [{ type: 'event', eventType: 'goodnight_button' }],
    actions: [
      {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: {
            endpointId: 'living_room:light:ceiling',
            capability: 'on_off',
            command: 'turn_off',
          },
        },
      },
      {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: {
            endpointId: 'garage:door:motor',
            capability: 'cover',
            command: 'close',
          },
        },
      },
    ],
  };

  function createMockRouter(reachableHubs: Set<string> = new Set(['hub_primary', 'hub_garage'])) {
    const localDispatched: string[] = [];
    const remoteDispatched: { targetHubId: string; endpointId: string }[] = [];

    const router: CrossHubCommandRouter = {
      dispatchLocalCommand: async (endpointId) => {
        localDispatched.push(endpointId);
      },
      dispatchRemoteCommand: async (targetHubId, endpointId) => {
        remoteDispatched.push({ targetHubId, endpointId });
      },
      isHubReachable: (hubId) => reachableHubs.has(hubId),
    };

    return { router, localDispatched, remoteDispatched };
  }

  it('synchronizes configuration package rejecting stale revisions', () => {
    const sync = new ClusterAutomationSynchronizer();

    const pkg1: ReplicatedRulePackage = {
      rules: [sampleRule],
      scenes: [],
      revision: 10,
      updatedByHubId: 'hub_coordinator',
      timestamp: new Date().toISOString(),
    };

    expect(sync.syncConfiguration(pkg1)).toBe(true);
    expect(sync.getRevision()).toBe(10);

    // Stale revision 9 ignored
    const stalePkg: ReplicatedRulePackage = {
      rules: [],
      scenes: [],
      revision: 9,
      updatedByHubId: 'hub_coordinator',
      timestamp: new Date().toISOString(),
    };

    expect(sync.syncConfiguration(stalePkg)).toBe(false);
    expect(sync.getRevision()).toBe(10);
  });

  it('elects exactly one executor per rule and prevents duplicate executions', async () => {
    const sync = new ClusterAutomationSynchronizer();

    // Mapping: living room light on hub_primary, garage door on hub_garage
    const endpointMap = new Map([
      ['living_room:light:ceiling', 'hub_primary'],
      ['garage:door:motor', 'hub_garage'],
    ]);

    const assignment = sync.electRuleExecutor(sampleRule, 'hub_primary', endpointMap, 'hub_primary');
    expect(assignment.locality).toBe('cross_hub');
    expect(assignment.executorHubId).toBe('hub_primary');

    expect(sync.shouldExecuteLocally(sampleRule.id, 'hub_primary')).toBe(true);
    expect(sync.shouldExecuteLocally(sampleRule.id, 'hub_garage')).toBe(false);

    const { router } = createMockRouter();

    // Hub garage attempts execution -> strictly rejected!
    await expect(
      sync.executeSynchronizedRule(sampleRule, 'hub_garage', router),
    ).rejects.toThrow(/NOT the elected executor/);
  });

  it('dispatches cross-hub commands through resource owners when peer is reachable', async () => {
    const sync = new ClusterAutomationSynchronizer();
    const endpointMap = new Map([
      ['living_room:light:ceiling', 'hub_primary'],
      ['garage:door:motor', 'hub_garage'],
    ]);

    sync.electRuleExecutor(sampleRule, 'hub_primary', endpointMap, 'hub_primary');
    const { router, localDispatched, remoteDispatched } = createMockRouter(
      new Set(['hub_primary', 'hub_garage']),
    );

    const report = await sync.executeSynchronizedRule(sampleRule, 'hub_primary', router);

    expect(report.status).toBe('completed');
    expect(report.localStepCount).toBe(1);
    expect(report.remoteStepCount).toBe(1);
    expect(localDispatched).toContain('living_room:light:ceiling');
    expect(remoteDispatched[0]?.targetHubId).toBe('hub_garage');
    expect(remoteDispatched[0]?.endpointId).toBe('garage:door:motor');
  });

  it('discloses partial completion when remote peer hub is unreachable', async () => {
    const sync = new ClusterAutomationSynchronizer();
    const endpointMap = new Map([
      ['living_room:light:ceiling', 'hub_primary'],
      ['garage:door:motor', 'hub_garage'],
    ]);

    sync.electRuleExecutor(sampleRule, 'hub_primary', endpointMap, 'hub_primary');
    // Garage hub is UNREACHABLE (partition)
    const { router, localDispatched, remoteDispatched } = createMockRouter(
      new Set(['hub_primary']),
    );

    const report = await sync.executeSynchronizedRule(sampleRule, 'hub_primary', router);

    expect(report.status).toBe('partial');
    expect(report.localStepCount).toBe(1);
    expect(report.remoteStepCount).toBe(1);
    expect(report.unreachableHubs).toContain('hub_garage');
    expect(localDispatched).toContain('living_room:light:ceiling');
    expect(remoteDispatched).toHaveLength(0); // Never relayed to dead peer
  });
});
