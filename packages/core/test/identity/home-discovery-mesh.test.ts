/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  ResourcePlacementScheduler,
  groupDiscoveredHomeTargets,
  orderClusterCandidateUrls,
  validateSessionCredentials,
} from '../../src/index.js';

describe('Home vs Hub network discovery grouping & mesh session helpers', () => {
  it('collapses multi-Hub clusters into one Home network, shows single configured Hub as Home, and keeps fresh Hub separate', () => {
    const targets = groupDiscoveredHomeTargets([
      {
        id: 'haus-hub:hub-miku-worker-01',
        hubId: 'hub-miku-worker-01',
        homeId: 'home-default',
        name: 'Miku (2)',
        url: 'http://192.168.5.117:8792',
        host: '192.168.5.117',
        port: 8792,
        kind: 'haus-hub',
        onboarded: true,
        clusterRole: 'node',
        coordinatorHubId: 'hub-standalone-01',
        hubCount: 2,
      },
      {
        id: 'haus-hub:hub-standalone-01',
        hubId: 'hub-standalone-01',
        homeId: 'home-default',
        homeName: 'Haus',
        name: 'Haus (2)',
        url: 'http://192.168.4.44:8790',
        host: '192.168.4.44',
        port: 8790,
        kind: 'haus-hub',
        onboarded: true,
        clusterRole: 'coordinator',
        coordinatorHubId: 'hub-standalone-01',
        hubCount: 2,
      },
      {
        id: 'haus-hub:hub-cabin',
        hubId: 'hub-cabin',
        homeId: 'home-cabin',
        name: 'Cabin',
        url: 'http://192.168.4.90:8790',
        host: '192.168.4.90',
        port: 8790,
        kind: 'haus-hub',
        onboarded: true,
        clusterRole: 'standalone',
        hubCount: 1,
      },
      {
        id: 'haus-hub:hub-black-laptop',
        hubId: 'hub-black-laptop',
        homeId: 'home-fresh',
        name: 'Haus Hub',
        url: 'http://192.168.5.115:8790',
        host: '192.168.5.115',
        port: 8790,
        kind: 'haus-hub',
        onboarded: false,
        clusterRole: 'standalone',
        hubCount: 1,
      },
    ]);

    expect(targets).toHaveLength(3);
    expect(targets[0]).toMatchObject({
      id: 'haus-home:home-cabin',
      name: 'Cabin',
      targetType: 'home',
      hubCount: 1,
      onboarded: true,
      url: 'http://192.168.4.90:8790',
    });
    expect(targets[1]).toMatchObject({
      id: 'haus-home:home-default',
      name: 'Haus',
      targetType: 'home-network',
      hubCount: 2,
      onboarded: true,
      url: 'http://192.168.4.44:8790',
      memberUrls: ['http://192.168.4.44:8790', 'http://192.168.5.117:8792'],
      memberNames: ['Haus', 'Miku'],
    });
    expect(targets[2]).toMatchObject({
      id: 'haus-hub:hub-black-laptop',
      name: 'Haus Hub',
      targetType: 'standalone-hub',
      onboarded: false,
      url: 'http://192.168.5.115:8790',
    });
  });

  it('orders cluster candidate URLs coordinator-first while skipping loopback for LAN sessions', () => {
    expect(
      orderClusterCandidateUrls(
        'http://192.168.5.117:8792/',
        ['http://127.0.0.1:8790', 'http://192.168.5.117:8792', 'http://192.168.4.44:8790/'],
        'http://192.168.4.44:8790',
      ),
    ).toEqual(['http://192.168.4.44:8790', 'http://192.168.5.117:8792']);
  });

  it('preserves clusterUrls in validateSessionCredentials', () => {
    const validated = validateSessionCredentials({
      hubUrl: 'http://192.168.4.44:8790',
      clusterUrls: ['http://192.168.4.44:8790/', 'http://192.168.5.117:8792'],
      sessionId: 'sess-1',
      sessionToken: 'tok-1',
      refreshToken: 'ref-1',
      hubId: 'hub-1',
      homeId: 'home-default',
      clientId: 'client-1',
      clientName: 'Desktop',
      clientRole: 'admin',
      expiresAt: Date.now() + 60_000,
    });
    expect(validated?.clusterUrls).toEqual([
      'http://192.168.4.44:8790',
      'http://192.168.5.117:8792',
    ]);
  });

  it('enforces requiredArch in ResourcePlacementScheduler so arm64 containers never land on x64', () => {
    const scheduler = new ResourcePlacementScheduler();
    const decision = scheduler.scheduleWorkload(
      {
        id: 'app:haus-kettle',
        name: 'Haus Kettle',
        kind: 'app',
        requirements: { minMemoryMb: 128, requiredArch: 'arm64' },
      },
      [
        {
          hubId: 'hub-miku-x64',
          name: 'Miku',
          available: true,
          isWeakHub: false,
          capacity: {
            cpuCores: 8,
            memoryBytes: 16 * 1024 ** 3,
            storageAvailableBytes: 100 * 1024 ** 3,
            hasHardwareTranscoder: true,
            attachedRadios: [],
            cpuArch: 'x64',
          },
          currentLoad: { assignedWorkloadCount: 0, reservedMemoryMb: 0, reservedStorageGb: 0 },
        },
        {
          hubId: 'hub-pi-arm64',
          name: 'Haus Pi',
          available: true,
          isWeakHub: false,
          capacity: {
            cpuCores: 4,
            memoryBytes: 4 * 1024 ** 3,
            storageAvailableBytes: 32 * 1024 ** 3,
            hasHardwareTranscoder: false,
            attachedRadios: [],
            cpuArch: 'arm64',
          },
          currentLoad: { assignedWorkloadCount: 5, reservedMemoryMb: 512, reservedStorageGb: 0 },
        },
      ],
    );
    expect(decision.status).toBe('assigned');
    expect(decision.assignedHubId).toBe('hub-pi-arm64');
  });
});
