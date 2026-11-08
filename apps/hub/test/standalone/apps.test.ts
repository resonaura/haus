/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  DockerAppLifecycle,
  type AppManifest,
  type DockerPort,
} from '@haus/apps';
import { Identities } from '@haus/core/types';
import {
  createStandaloneAppDriver,
  StandaloneAppManager,
  type InstalledAppEntry,
} from '../../src/home/app-driver.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';

class MockDockerPort implements DockerPort {
  public requests: Array<{ method: string; path: string; body?: unknown }> = [];
  public containers = new Map<string, { id: string; state: string; name: string }>();

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    this.requests.push({ method, path, body });

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

    const driver = createStandaloneAppDriver(installedApps, lifecycle);
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
    );

    // 1. Install app with granted permissions and config
    const installResult = await manager.installApp(
      'admin',
      sampleManifest,
      ['network:host'],
      { test_key: 'value' },
    );

    expect(installResult.manifest.id).toBe('test-app');
    expect(installedApps.has('test-app')).toBe(true);
    const entry = installedApps.get('test-app')!;
    expect(entry.containerId).toBe('a'.repeat(64));
    expect(entry.state).toBe('running');

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
});
