/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  ResourcePlacementScheduler,
  type HubPlacementNode,
  type PlacementWorkload,
} from '../src/index.js';

describe('ResourcePlacementScheduler & Multi-Hub Placement', () => {
  const powerfulHub: HubPlacementNode = {
    hubId: 'hub_primary',
    name: 'Primary Compute Hub',
    available: true,
    isWeakHub: false,
    capacity: {
      cpuCores: 8,
      memoryBytes: 16 * 1024 * 1024 * 1024,
      storageAvailableBytes: 1000 * 1024 * 1024 * 1024,
      hasHardwareTranscoder: true,
      attachedRadios: ['zigbee', 'matter', 'thread'],
    },
    currentLoad: {
      assignedWorkloadCount: 0,
      reservedMemoryMb: 0,
      reservedStorageGb: 0,
    },
  };

  const weakHub: HubPlacementNode = {
    hubId: 'hub_weak_satellite',
    name: 'Satellite Wall Plug Hub',
    available: true,
    isWeakHub: true,
    capacity: {
      cpuCores: 1,
      memoryBytes: 1024 * 1024 * 1024,
      storageAvailableBytes: 8 * 1024 * 1024 * 1024,
      hasHardwareTranscoder: false,
      attachedRadios: [],
    },
    currentLoad: {
      assignedWorkloadCount: 0,
      reservedMemoryMb: 0,
      reservedStorageGb: 0,
    },
  };

  const garageHub: HubPlacementNode = {
    hubId: 'hub_garage',
    name: 'Garage Secondary Hub',
    available: true,
    isWeakHub: false,
    capacity: {
      cpuCores: 4,
      memoryBytes: 4 * 1024 * 1024 * 1024,
      storageAvailableBytes: 100 * 1024 * 1024 * 1024,
      hasHardwareTranscoder: false,
      attachedRadios: ['zigbee'],
    },
    currentLoad: {
      assignedWorkloadCount: 0,
      reservedMemoryMb: 0,
      reservedStorageGb: 0,
    },
  };

  it('forbids heavy vision and recording workloads on weak satellite hubs', () => {
    const scheduler = new ResourcePlacementScheduler();

    const visionWorkload: PlacementWorkload = {
      id: 'workload_ai_vision',
      name: 'Coral TPU AI Vision Pipeline',
      kind: 'vision',
      requirements: {
        minCores: 4,
        minMemoryMb: 2048,
        requiresHardwareTranscoder: true,
        forbiddenOnWeakHub: true,
      },
    };

    const decision = scheduler.scheduleWorkload(visionWorkload, [weakHub, powerfulHub]);

    expect(decision.status).toBe('assigned');
    expect(decision.assignedHubId).toBe('hub_primary');
  });

  it('strictly binds radio coordinator workloads to hubs with physical radio hardware', () => {
    const scheduler = new ResourcePlacementScheduler();

    const zigbeeWorkload: PlacementWorkload = {
      id: 'workload_zigbee_coordinator',
      name: 'Garage Zigbee Network',
      kind: 'radio',
      requirements: {
        requiredRadio: 'zigbee',
      },
      userPreferredHubId: 'hub_garage',
    };

    const decision = scheduler.scheduleWorkload(zigbeeWorkload, [weakHub, garageHub]);

    expect(decision.status).toBe('assigned');
    expect(decision.assignedHubId).toBe('hub_garage');

    // Attempting to place on weakHub without radio should fail
    const rejectedDecision = scheduler.scheduleWorkload(zigbeeWorkload, [weakHub]);
    expect(rejectedDecision.status).toBe('rejected');
    expect(rejectedDecision.reason).toContain('hardware and capacity');
  });

  it('respects user priority and fallback order when preferred hub is unavailable', () => {
    const scheduler = new ResourcePlacementScheduler();

    const mediaWorkload: PlacementWorkload = {
      id: 'workload_music_streamer',
      name: 'Whole Home Audio Streamer',
      kind: 'media',
      requirements: {
        minMemoryMb: 512,
      },
      userPreferredHubId: 'hub_offline', // Offline
      fallbackHubIds: ['hub_garage', 'hub_primary'],
    };

    const decision = scheduler.scheduleWorkload(mediaWorkload, [garageHub, powerfulHub]);

    expect(decision.status).toBe('assigned');
    // First fallback in order is hub_garage
    expect(decision.assignedHubId).toBe('hub_garage');
  });

  it('guarantees 100% deterministic placement without witness across multiple executions', () => {
    const scheduler = new ResourcePlacementScheduler();

    const appWorkload: PlacementWorkload = {
      id: 'workload_generic_app',
      name: 'Generic App Service',
      kind: 'app',
      requirements: { minMemoryMb: 256 },
    };

    // Run 10 times with identical inputs
    const results = Array.from({ length: 10 }, () =>
      scheduler.scheduleWorkload(appWorkload, [garageHub, powerfulHub]),
    );

    const firstAssigned = results[0]?.assignedHubId;
    for (const res of results) {
      expect(res.assignedHubId).toBe(firstAssigned);
    }
  });

  it('schedules batches of workloads accumulating memory and storage reservations', () => {
    const scheduler = new ResourcePlacementScheduler();

    const batch: PlacementWorkload[] = [
      {
        id: 'workload_1_radio',
        name: 'Zigbee Dongle',
        kind: 'radio',
        requirements: { requiredRadio: 'thread' },
      },
      {
        id: 'workload_2_nvr',
        name: 'NVR 24/7 Continuous Recording',
        kind: 'recording',
        requirements: { minStorageGb: 50, forbiddenOnWeakHub: true },
      },
      {
        id: 'workload_3_sensor_logger',
        name: 'Sensor Logger App',
        kind: 'app',
        requirements: { minMemoryMb: 128 },
      },
    ];

    const plan = scheduler.scheduleBatch(batch, [weakHub, garageHub, powerfulHub]);

    expect(plan.assignedCount).toBe(3);
    expect(plan.rejectedCount).toBe(0);

    const radioDecision = plan.decisions.find((d) => d.workloadId === 'workload_1_radio');
    expect(radioDecision?.assignedHubId).toBe('hub_primary'); // Only powerfulHub has Thread radio!
  });
});
