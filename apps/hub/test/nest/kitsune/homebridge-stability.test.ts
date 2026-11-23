/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { ClusterLeaseService } from '../../../src/cluster/coordination/leases.js';
import { ClusterStateStore } from '../../../src/cluster/coordination/state.js';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { StandaloneKitsuneService } from '../../../src/kitsune/kitsune.service.js';

describe('Homebridge Govee stability & session conflict prevention', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn().catch(() => undefined);
    }
  });

  it('does not poison Kitsune session ownership when an unattached Homebridge outlet receives a command', async () => {
    const home = new StandaloneHomeService();
    const kitsune = new StandaloneKitsuneService(home);
    cleanups.push(async () => {
      await kitsune.onModuleDestroy();
      await home.onModuleDestroy();
    });

    await expect(
      kitsune.handleDeviceCommand(
        'homebridge:homebridge-govee:AF0447A1-A965-58FE-A924-4C7D6B790AFE:outlet_1',
        'on_off',
        'turn_on',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // No phantom active lease under 'haus-hub-standalone' was created.
    expect(kitsune.engine.getSession('homebridge', 'homebridge-govee')).toBeUndefined();
  });

  it('reclaims an orphaned non-bridge Homebridge session instead of throwing kitsune_session_conflict', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'haus-hb-reclaim-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));

    const home = new StandaloneHomeService();
    const kitsune = new StandaloneKitsuneService(home);
    cleanups.push(async () => {
      await kitsune.onModuleDestroy();
      await home.onModuleDestroy();
    });

    await kitsune.homebridgeRuntime.configure({ dataDirectory: dataDir });

    // Simulate a pre-existing orphaned lease owned by a non-bridge owner.
    kitsune.engine.acquireSession('homebridge', 'homebridge-sample', 'haus-hub-standalone');
    expect(kitsune.engine.getSession('homebridge', 'homebridge-sample')?.ownerId).toBe(
      'haus-hub-standalone',
    );

    const entry = {
      manifest: {
        id: 'homebridge-sample',
        name: 'Homebridge Sample',
        version: '1.0.0',
        image: 'kitsune://homebridge/homebridge-sample',
        architectures: ['arm64', 'amd64'] as const,
      },
      state: 'running' as const,
      logs: [] as string[],
      config: { pluginPath: join(dataDir, 'nonexistent-plugin') },
    };

    // Starting the bridge via execute() must reclaim the orphaned lease and not throw kitsune_session_conflict.
    await kitsune.homebridgeRuntime.execute(entry, 'start');
    expect(kitsune.engine.getSession('homebridge', 'homebridge-sample')?.ownerId).toBe(
      'hub-homebridge',
    );
    expect(kitsune.homebridgeRuntime.isRunning('homebridge-sample')).toBe(true);

    // Saving config while active also succeeds without conflict.
    await kitsune.homebridgeRuntime.configureApp(entry, {
      pluginPath: join(dataDir, 'nonexistent-plugin'),
      updated: true,
    });
    expect(kitsune.homebridgeRuntime.isRunning('homebridge-sample')).toBe(true);

    // Explicit stop releases the session and stops reporting running.
    await kitsune.homebridgeRuntime.execute(entry, 'stop');
    expect(kitsune.homebridgeRuntime.isRunning('homebridge-sample')).toBe(false);
    expect(kitsune.engine.getSession('homebridge', 'homebridge-sample')?.status).toBe('released');
  });

  it('reports live stopped state and start action when a Homebridge bridge is not running despite persisted running state', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'haus-hb-state-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));

    const home = new StandaloneHomeService();
    const kitsune = new StandaloneKitsuneService(home);
    cleanups.push(async () => {
      await kitsune.onModuleDestroy();
      await home.onModuleDestroy();
    });

    await kitsune.homebridgeRuntime.configure({ dataDirectory: dataDir });
    await home.appManager.installApp(
      'local-admin',
      {
        id: 'homebridge-govee',
        name: 'Homebridge Govee',
        version: '11.40.0',
        image: 'ghcr.io/haus/homebridge-govee:11.40.0',
        architectures: ['arm64', 'amd64'],
      },
      [],
      { pluginPath: join(dataDir, 'nonexistent-plugin') },
    );

    expect(home.appManager.isAppRunning('homebridge-govee')).toBe(true);

    // Stop the bridge without mutating entry.state (simulates an unexpected bridge exit / unstarted boot state).
    const entry = home.appManager.getInstalledApp('homebridge-govee');
    expect(entry).toBeDefined();
    await kitsune.homebridgeRuntime.execute(entry!, 'stop');
    entry!.state = 'running';

    expect(home.appManager.isAppRunning('homebridge-govee')).toBe(false);
    const inv = await home.apps.list('local-admin');
    const app = inv.apps.find((a) => a.source.externalId === 'homebridge-govee');
    expect(app).toBeDefined();
    expect(app?.state).toBe('stopped');
    expect(app?.actions).toContain('start');
  });

  it('renews an expired active local workload lease on coordinator reboot while keeping secondary node leases fenced', async () => {
    const coordStore = new ClusterStateStore();
    await coordStore.ensureInitialized({ hubId: 'hub-coord', homeId: 'home-test' });
    await coordStore.saveState({
      role: 'coordinator',
      coordinatorId: 'hub-coord',
      coordinatorEpoch: 2,
    });
    const expiredAt = Date.now() - 30_000;
    await coordStore.saveWorkload({
      workloadId: 'app:homebridge-govee',
      kind: 'app',
      name: 'Homebridge Govee',
      ownerHubId: 'hub-coord',
      standbyHubIdsJson: '[]',
      generation: 2,
      epoch: 2,
      state: 'active',
      leaseExpiresAt: expiredAt,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: 'hub-coord',
      updatedAt: expiredAt - 60_000,
    });

    const coordLeases = new ClusterLeaseService(coordStore);
    coordLeases.setClusterTopologyHooks({ hasPeers: () => true });
    expect(coordLeases.shouldRunLocally('app:homebridge-govee')).toBe(false);
    await coordLeases.ensureLocalOwnership({
      workloadId: 'app:homebridge-govee',
      kind: 'app',
      name: 'Homebridge Govee',
      active: true,
    });
    expect(coordLeases.shouldRunLocally('app:homebridge-govee')).toBe(true);

    // Secondary node must NOT self-renew an expired lease.
    const nodeStore = new ClusterStateStore();
    await nodeStore.ensureInitialized({ hubId: 'hub-node', homeId: 'home-test' });
    await nodeStore.saveState({
      role: 'node',
      coordinatorId: 'hub-coord',
      coordinatorEpoch: 2,
    });
    await nodeStore.saveWorkload({
      workloadId: 'app:worker-app',
      kind: 'app',
      name: 'Worker App',
      ownerHubId: 'hub-node',
      standbyHubIdsJson: '[]',
      generation: 2,
      epoch: 2,
      state: 'active',
      leaseExpiresAt: expiredAt,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: 'hub-node',
      updatedAt: expiredAt - 60_000,
    });
    const nodeLeases = new ClusterLeaseService(nodeStore);
    nodeLeases.setClusterTopologyHooks({ hasPeers: () => true });
    await nodeLeases.ensureLocalOwnership({
      workloadId: 'app:worker-app',
      kind: 'app',
      name: 'Worker App',
      active: true,
    });
    expect(nodeLeases.shouldRunLocally('app:worker-app')).toBe(false);
  });
});
