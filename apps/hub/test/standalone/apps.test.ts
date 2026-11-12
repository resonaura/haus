/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DockerAppLifecycle, type AppManifest, type DockerPort } from '@haus/apps';
import { Identities } from '@haus/core/types';
import {
  createStandaloneAppDriver,
  StandaloneAppManager,
  type InstalledAppEntry,
} from '../../src/home/app-driver.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';
import { AppSupervisor } from '../../src/home/supervisor.js';
import { AppOptions } from '../../src/home/options.js';

class MockDockerPort implements DockerPort {
  public requests: Array<{
    method: string;
    path: string;
    body?: unknown;
    signal?: AbortSignal;
  }> = [];
  public containers = new Map<string, { id: string; state: string; name: string }>();
  public rejectDelete?: Error;
  public abortDelete?: AbortController;

  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    this.requests.push({ method, path, body, signal });

    if (method === 'GET' && path === '/version') {
      return { ApiVersion: '1.45', MinAPIVersion: '1.24' } as T;
    }
    if (method === 'GET' && path.includes('/containers/json')) {
      return Array.from(this.containers.values()).map((c) => ({
        Id: c.id,
        Names: [c.name],
        Image: 'test-image',
        State: c.state,
        Labels: { 'io.haus.app': 'test-app' },
      })) as T;
    }
    if (method === 'POST' && path.includes('/containers/create')) {
      const id = 'a'.repeat(64);
      this.containers.set(id, { id, state: 'created', name: 'haus-app-test-app' });
      return { Id: id } as T;
    }
    if (method === 'POST' && path.endsWith('/start')) {
      const id = path.split('/')[2];
      const c = this.containers.get(id);
      if (c) c.state = 'running';
      return {} as T;
    }
    if (method === 'POST' && path.endsWith('/stop')) {
      const id = path.split('/')[2];
      const c = this.containers.get(id);
      if (c) c.state = 'stopped';
      return {} as T;
    }
    if (method === 'DELETE') {
      if (this.abortDelete) {
        this.abortDelete.abort();
        throw Error('docker_request_failed');
      }
      if (this.rejectDelete) throw this.rejectDelete;
      const id = path.split('/')[2]?.split('?')[0];
      this.containers.delete(id);
      return {} as T;
    }
    if (method === 'GET' && path.includes('/json')) {
      const id = path.split('/')[2];
      return {
        Id: id,
        Name: '/haus-app-test-app',
        State: { Status: 'running', Running: true },
        Config: { Image: 'test-image' },
      } as T;
    }
    return {} as T;
  }
}

describe('StandaloneAppManager and Hub Apps Lifecycle', () => {
  const sampleManifest: AppManifest = {
    id: 'test-app',
    name: 'Test Application',
    version: '1.0.0',
    image: 'test-image:latest',
    architectures: ['amd64'],
    network: { mode: 'host' },
    env: {
      TEST_VAR: 'hello',
    },
    mounts: [{ target: 'data', containerPath: '/data' }],
  };

  it('installs, manages, and executes app actions via Docker lifecycle', async () => {
    const mockPort = new MockDockerPort();
    const lifecycle = new DockerAppLifecycle(mockPort, { dataRoot: '/tmp/test-haus-apps' });
    const installedApps = new Map<string, InstalledAppEntry>();
    const idMap = new Map<string, string>();
    const identities = new Identities(
      {
        get: (s) => idMap.get(`${s.instanceId}:${s.externalId}`),
        putIfAbsent: (s, p) => {
          idMap.set(`${s.instanceId}:${s.externalId}`, p);
          return p;
        },
      },
      () => 'app-1',
    );

    const options = new AppOptions('/tmp/test-haus-apps');
    const driver = createStandaloneAppDriver(installedApps, lifecycle, options);
    const persistence = new StandaloneHomePersistence();
    const { Apps } = await import('@haus/apps');
    const apps = new Apps(identities, { authorize: async () => true });
    apps.register(driver);

    const manager = new StandaloneAppManager(
      installedApps,
      apps,
      persistence,
      undefined,
      lifecycle,
      '/tmp/test-haus-apps',
      undefined,
      undefined,
      options,
    );

    // 1. Install app with granted permissions and config
    const installResult = await manager.installApp('admin', sampleManifest, ['network:host'], {
      test_key: 'value',
    });

    expect(installResult.manifest.id).toBe('test-app');
    expect(installedApps.has('test-app')).toBe(true);
    expect(manager.getInstallProgress('test-app')?.stage).toBe('complete');
    const entry = installedApps.get('test-app')!;
    expect(entry.containerId).toBe('a'.repeat(64));
    expect(entry.state).toBe('running');

    await expect(
      manager.installApp('admin', { ...sampleManifest, version: '2.0.0' }, ['network:host'], {
        test_key: 'must-not-replace-options',
      }),
    ).rejects.toThrow('app_already_installed');
    expect(entry.manifest.version).toBe('1.0.0');
    expect(entry.config).toEqual({ test_key: 'value' });

    const updateResult = await manager.operateApp('admin', installResult.appId, 'update', {
      version: '2.0.0',
    });
    expect(updateResult.status).toBe('unsupported');
    expect(entry.manifest.version).toBe('1.0.0');

    // Verify Docker create call passed env and host network
    const createReq = mockPort.requests.find((r) => r.path.includes('/containers/create'));
    expect(createReq).toBeDefined();
    const payload = createReq?.body as Record<string, unknown>;
    expect(payload.Image).toBe('test-image:latest');
    expect(payload.Env).toContain('TEST_VAR=hello');

    // 2. List apps
    const inventory = await manager.listApps('admin');
    expect(inventory.apps.length).toBe(1);
    expect(inventory.apps[0].source.externalId).toBe('test-app');
    expect(inventory.apps[0].managed).toBe(true);

    // 3. Inspect app
    const inspectResult = await manager.inspectApp('admin', inventory.apps[0].id);
    expect(inspectResult.status).toBe('ok');
    if (inspectResult.status === 'ok' && inspectResult.data) {
      expect(inspectResult.data.externalId).toBe('test-app');
      expect(inspectResult.data.state).toBe('running');
    }

    // 4. Stop app
    await manager.executeApp('admin', inventory.apps[0].id, 'stop');
    expect(installedApps.get('test-app')!.state).toBe('stopped');

    // 5. Start app
    await manager.executeApp('admin', inventory.apps[0].id, 'start');
    expect(installedApps.get('test-app')!.state).toBe('running');

    // 6. Operate: configure
    const configResult = await manager.operateApp('admin', inventory.apps[0].id, 'configure', {
      new_key: 'new_val',
    });
    expect(configResult.status).toBe('ok');

    // 7. Operate: remove
    const removeResult = await manager.operateApp('admin', inventory.apps[0].id, 'remove');
    expect(removeResult.status).toBe('ok');
    expect(installedApps.has('test-app')).toBe(false);
  });

  it('retains the App entry and reports an error when Docker removal fails', async () => {
    const mockPort = new MockDockerPort();
    const lifecycle = new DockerAppLifecycle(mockPort, { dataRoot: '/tmp/test-haus-apps' });
    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'test-app',
        {
          manifest: sampleManifest,
          state: 'running',
          logs: [],
          config: {},
          containerId: 'a'.repeat(64),
        },
      ],
    ]);
    mockPort.containers.set('a'.repeat(64), {
      id: 'a'.repeat(64),
      state: 'running',
      name: 'haus-app-test-app',
    });
    const idMap = new Map<string, string>();
    const identities = new Identities(
      {
        get: (source) => idMap.get(`${source.instanceId}:${source.externalId}`),
        putIfAbsent: (source, proposedId) => {
          const key = `${source.instanceId}:${source.externalId}`;
          const existing = idMap.get(key);
          if (existing) return existing;
          idMap.set(key, proposedId);
          return proposedId;
        },
      },
      () => 'app-1',
    );
    const { Apps } = await import('@haus/apps');
    const apps = new Apps(identities, { authorize: async () => true });
    apps.register(createStandaloneAppDriver(installedApps, lifecycle));
    const manager = new StandaloneAppManager(
      installedApps,
      apps,
      new StandaloneHomePersistence(),
      undefined,
      lifecycle,
    );
    const app = (await manager.listApps('admin')).apps[0];
    if (!app) throw Error('fixture_app_missing');

    mockPort.rejectDelete = Error('docker_delete_failed');
    const result = await manager.operateApp('admin', app.id, 'remove');

    expect(result).toEqual({ status: 'error', reason: 'docker_delete_failed' });
    expect(installedApps.has('test-app')).toBe(true);
    expect(mockPort.containers.has('a'.repeat(64))).toBe(true);

    mockPort.rejectDelete = undefined;
    const controller = new AbortController();
    mockPort.abortDelete = controller;
    const cancelled = await manager.operateApp(
      'admin',
      app.id,
      'remove',
      undefined,
      controller.signal,
    );
    expect(cancelled).toEqual({ status: 'error', reason: 'app_operation_cancelled' });
    const lastDeleteRequest = mockPort.requests
      .filter((request) => request.method === 'DELETE')
      .pop();
    expect(lastDeleteRequest?.signal).toBe(controller.signal);
    expect(installedApps.has('test-app')).toBe(true);
    expect(mockPort.containers.has('a'.repeat(64))).toBe(true);
  });

  it('uses the configured Hub data directory for App options and bind mounts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-manager-'));
    try {
      const mockPort = new MockDockerPort();
      const lifecycle = new DockerAppLifecycle(mockPort, { dataRoot: '/data/apps' });
      const installedApps = new Map<string, InstalledAppEntry>();
      const idMap = new Map<string, string>();
      const identities = new Identities(
        {
          get: (source) => idMap.get(`${source.instanceId}:${source.externalId}`),
          putIfAbsent: (source, proposedId) => {
            const key = `${source.instanceId}:${source.externalId}`;
            const existing = idMap.get(key);
            if (existing) return existing;
            idMap.set(key, proposedId);
            return proposedId;
          },
        },
        () => 'app-1',
      );
      const { Apps } = await import('@haus/apps');
      const apps = new Apps(identities, { authorize: async () => true });
      apps.register(createStandaloneAppDriver(installedApps, lifecycle));
      const manager = new StandaloneAppManager(
        installedApps,
        apps,
        new StandaloneHomePersistence(),
        undefined,
        lifecycle,
        '/data/apps',
        new AppSupervisor(),
      );

      await manager.configureSupervisor({
        dataDirectory: root,
        port: 8790,
        env: { HAUS_MQTT_PORT: '1883' },
      });
      await manager.installApp('admin', { ...sampleManifest, services: ['mqtt:want'] }, [
        'network:host',
      ]);

      const createRequest = mockPort.requests.find((request) =>
        request.path.includes('/containers/create'),
      );
      const payload = createRequest?.body as
        { Env?: string[]; HostConfig?: { Binds?: string[] } } | undefined;
      expect(payload?.HostConfig?.Binds).toEqual([
        `${resolve(root, 'apps')}/test-app/data:/data:rw`,
      ]);
      expect(payload?.Env).toContain('SUPERVISOR_API=http://127.0.0.1:8790/api/supervisor');
      expect(payload?.Env?.find((entry) => entry.startsWith('SUPERVISOR_TOKEN='))).toMatch(
        /^SUPERVISOR_TOKEN=[a-f0-9]{64}$/,
      );
      await manager.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores persisted MQTT Apps after the home snapshot is hydrated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-supervisor-restore-'));
    try {
      const mockPort = new MockDockerPort();
      const lifecycle = new DockerAppLifecycle(mockPort, { dataRoot: '/data/apps' });
      const manifest: AppManifest = {
        ...sampleManifest,
        id: 'restored-camera',
        services: ['mqtt:want'],
      };
      const installedApps = new Map<string, InstalledAppEntry>();
      const identities = new Identities(
        {
          get: () => undefined,
          putIfAbsent: (_source, preferred) => preferred,
        },
        () => 'app-1',
      );
      const { Apps } = await import('@haus/apps');
      const apps = new Apps(identities, { authorize: async () => true });
      const options = new AppOptions('/data/apps');
      apps.register(createStandaloneAppDriver(installedApps, lifecycle, options));
      const supervisor = new AppSupervisor();
      const register = vi.spyOn(supervisor, 'register');
      const manager = new StandaloneAppManager(
        installedApps,
        apps,
        new StandaloneHomePersistence(),
        undefined,
        lifecycle,
        '/data/apps',
        supervisor,
        undefined,
        options,
      );

      await manager.configureSupervisor({ dataDirectory: root, port: 8790, env: {} });
      expect(register).not.toHaveBeenCalled();

      // HomeService hydrates persisted Apps after the Supervisor listener is configured.
      installedApps.set(manifest.id, {
        manifest,
        config: { camera: 'outdoor' },
        state: 'running',
        logs: [],
        containerId: 'b'.repeat(64),
      });
      await manager.restoreSupervisorApps();

      expect(register).toHaveBeenCalledOnce();
      expect(register).toHaveBeenCalledWith(manifest, { camera: 'outdoor' });

      const inventory = await manager.listApps('admin');
      await manager.operateApp('admin', inventory.apps[0].id, 'configure', { enabled: false });
      expect(register).toHaveBeenCalledTimes(2);
      expect(register).toHaveBeenLastCalledWith(manifest, { camera: 'outdoor', enabled: false });
      expect(
        JSON.parse(await readFile(join(root, 'apps', manifest.id, 'data', 'options.json'), 'utf8')),
      ).toEqual({ camera: 'outdoor', enabled: false });
      await manager.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
