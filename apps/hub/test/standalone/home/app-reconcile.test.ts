/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { AppCatalog, Apps, type AppManifest, type DockerAppLifecycle } from '@haus/apps';
import { Identities } from '@haus/core/types';
import {
  createStandaloneAppDriver,
  StandaloneAppManager,
  type InstalledAppEntry,
} from '../../../src/home/app-driver.js';
import { applyHomeSnapshot, StandaloneHomePersistence } from '../../../src/home/home.persistence.js';

function createAqaraManifest(version = '1.6.39+haus.20261111.2'): AppManifest {
  return {
    id: 'aqara-g5pro',
    name: 'Aqara G5 Pro MQTT Bridge',
    version,
    image: 'haus-aqara:pi-20261117',
    architectures: ['amd64', 'arm64'],
    network: { mode: 'host' },
    mounts: [{ target: 'data', containerPath: '/data' }],
    services: ['mqtt:want'],
    accessories: { protocol: 'haus-camera-v2', port: 8580 },
  };
}

describe('Docker app container recovery, drift reconciliation, and honest updates', () => {
  it('recovers missing containerId by label before executing Docker update instead of silent no-op', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'aqara-g5pro',
        {
          manifest: createAqaraManifest(),
          state: 'running',
          logs: [],
          config: {},
          containerId: undefined,
        },
      ],
    ]);

    const recoveredId = '5'.repeat(64);
    const updatedId = '6'.repeat(64);
    const findContainer = vi.fn().mockResolvedValue({
      state: 'running',
      containerId: recoveredId,
      observation: {
        id: recoveredId,
        name: 'haus-app-aqara-g5pro',
        state: 'running',
        health: 'none',
        restartCount: 0,
        image: 'haus-aqara:pi-20261117',
        imageId: `sha256:${'d'.repeat(64)}`,
        version: '1.6.39+haus.20261111.2',
        ports: [],
      },
    });
    const lifecycleUpdate = vi.fn().mockResolvedValue({
      containerId: updatedId,
      rolledBack: false,
      manifest: catalog.get('aqara-g5pro')!.manifest,
      image: {
        reference: `sha256:${'9'.repeat(64)}`,
        imageId: `sha256:${'9'.repeat(64)}`,
        digest: `sha256:${'9'.repeat(64)}`,
        source: 'registry',
        platform: 'linux/arm64',
      },
    });
    const lifecycle = {
      findContainer,
      update: lifecycleUpdate,
    } as unknown as DockerAppLifecycle;
    const supervisorRegister = vi.fn().mockResolvedValue({
      SUPERVISOR_API: 'http://127.0.0.1:8790/api/supervisor',
      SUPERVISOR_TOKEN: 'token-123',
    });

    const apps = new Apps(
      new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
      { authorize: async () => true },
    );
    apps.register(
      createStandaloneAppDriver(installedApps, lifecycle, undefined, catalog, undefined, {
        register: supervisorRegister,
      }),
    );

    const inv = await apps.list('admin');
    const res = await apps.operate('admin', inv.apps[0]!.id, 'update');

    expect(res.status).toBe('ok');
    expect(findContainer).toHaveBeenCalledWith('aqara-g5pro', undefined, 'haus-aqara:pi-20261117');
    expect(lifecycleUpdate).toHaveBeenCalledWith(
      recoveredId,
      expect.objectContaining({ id: 'aqara-g5pro', version: '1.6.41' }),
      ['network:host'],
      { SUPERVISOR_API: 'http://127.0.0.1:8790/api/supervisor', SUPERVISOR_TOKEN: 'token-123' },
      undefined,
      undefined,
    );
    expect(installedApps.get('aqara-g5pro')?.containerId).toBe(updatedId);
    expect(installedApps.get('aqara-g5pro')?.manifest.version).toBe('1.6.41');
  });

  it('installs and starts a real container when update finds no existing container on host', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'aqara-g5pro',
        {
          manifest: createAqaraManifest(),
          state: 'running',
          logs: [],
          config: {},
          containerId: undefined,
        },
      ],
    ]);

    const installedId = '7'.repeat(64);
    const install = vi.fn().mockResolvedValue({
      containerId: installedId,
      manifest: catalog.get('aqara-g5pro')!.manifest,
    });
    const start = vi.fn().mockResolvedValue(undefined);
    const lifecycle = {
      findContainer: vi.fn().mockResolvedValue({ state: 'missing' }),
      install,
      start,
    } as unknown as DockerAppLifecycle;

    const apps = new Apps(
      new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
      { authorize: async () => true },
    );
    apps.register(createStandaloneAppDriver(installedApps, lifecycle, undefined, catalog));

    const inv = await apps.list('admin');
    const res = await apps.operate('admin', inv.apps[0]!.id, 'update');

    expect(res.status).toBe('ok');
    expect(install).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(installedId, undefined);
    expect(installedApps.get('aqara-g5pro')?.containerId).toBe(installedId);
    expect(installedApps.get('aqara-g5pro')?.manifest.version).toBe('1.6.41');
  });

  it('refuses update honestly when multiple running containers match the same app label', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'aqara-g5pro',
        {
          manifest: createAqaraManifest(),
          state: 'running',
          logs: [],
          config: {},
          containerId: undefined,
        },
      ],
    ]);

    const lifecycle = {
      findContainer: vi.fn().mockResolvedValue({
        state: 'ambiguous',
        containerIds: ['1'.repeat(64), '2'.repeat(64)],
      }),
      update: vi.fn(),
    } as unknown as DockerAppLifecycle;

    const apps = new Apps(
      new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
      { authorize: async () => true },
    );
    apps.register(createStandaloneAppDriver(installedApps, lifecycle, undefined, catalog));

    const inv = await apps.list('admin');
    const res = await apps.operate('admin', inv.apps[0]!.id, 'update');

    expect(res).toEqual({ status: 'error', reason: 'app_container_ambiguous' });
    expect(installedApps.get('aqara-g5pro')?.manifest.version).toBe('1.6.39+haus.20261111.2');
  });

  it('reconciles live container version drift, host data root, and containerId during boot restore', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const staleManifest: AppManifest = {
      ...catalog.get('aqara-g5pro')!.manifest,
      version: '1.6.41',
    };
    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'aqara-g5pro',
        {
          manifest: staleManifest,
          state: 'running',
          logs: [],
          config: {},
          containerId: undefined,
        },
      ],
    ]);
    const liveId = '5'.repeat(64);
    const lifecycle = {
      setDataRoot: vi.fn(),
      detectHostDataDir: vi.fn().mockResolvedValue('/var/lib/haus/hub'),
      findContainer: vi.fn().mockResolvedValue({
        state: 'running',
        containerId: liveId,
        observation: {
          id: liveId,
          name: 'haus-app-aqara-g5pro',
          state: 'running',
          health: 'none',
          restartCount: 0,
          image: 'haus-aqara:pi-20261117',
          imageId: `sha256:${'d'.repeat(64)}`,
          version: '1.6.39+haus.20261111.2',
          ports: [],
        },
      }),
    } as unknown as DockerAppLifecycle;

    const apps = new Apps(
      new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
      { authorize: async () => true },
    );
    apps.register(createStandaloneAppDriver(installedApps, lifecycle, undefined, catalog));
    const manager = new StandaloneAppManager(
      installedApps,
      apps,
      new StandaloneHomePersistence(),
      undefined,
      lifecycle,
      '/data/apps',
      undefined,
      '/data/apps',
      undefined,
      catalog,
    );

    await manager.configureSupervisor({ dataDirectory: '/data', port: 8790 });

    expect(lifecycle.setDataRoot).toHaveBeenCalledWith('/data/apps', '/var/lib/haus/hub/apps');
    const reconciled = installedApps.get('aqara-g5pro')!;
    expect(reconciled.containerId).toBe(liveId);
    expect(reconciled.manifest.version).toBe('1.6.39+haus.20261111.2');
    expect(reconciled.manifest.image).toBe('haus-aqara:pi-20261117');
    expect(manager.checkAppUpdate('aqara-g5pro').updateAvailable).toBe(true);
  });

  it('preserves local containerId across applyHomeSnapshot reloads when replicated entry omits it', async () => {
    const liveId = '5'.repeat(64);
    const catalog = AppCatalog.createDefaultCatalog();
    const manifest = catalog.get('aqara-g5pro')!.manifest;
    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'aqara-g5pro',
        {
          manifest,
          state: 'running',
          logs: [],
          config: {},
          containerId: liveId,
        },
      ],
    ]);

    await applyHomeSnapshot(
      {
        devices: [],
        endpointStates: [],
        scenes: [],
        scripts: [],
        automations: [],
        apps: [
          [
            'aqara-g5pro',
            {
              manifest,
              state: 'running',
              logs: [],
              config: { log_level: 'debug' },
              containerId: undefined,
            },
          ],
        ],
      },
      {
        devices: { registerDevice: (d) => d },
        roomCoordinator: {
          registerDevice: async () => undefined,
          putScene: async () => undefined,
          putScript: async () => undefined,
          putAutomation: async () => undefined,
        },
        endpointStates: new Map(),
        scenes: new Map(),
        scripts: new Map(),
        automations: new Map(),
        automationEngine: { updateRule: () => undefined },
        installedApps,
      },
    );

    expect(installedApps.get('aqara-g5pro')?.containerId).toBe(liveId);
    expect(installedApps.get('aqara-g5pro')?.config).toEqual({ log_level: 'debug' });
  });
});
