/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { Apps, type AppDriver } from '../src/index.js';
import { DockerApps } from '../src/docker.js';
import { Identities, type SourceRef } from '@haus/core/types';

function identities() {
  const values = new Map<string, string>();
  let sequence = 0;
  const key = (source: SourceRef) => JSON.stringify(source);
  return new Identities(
    {
      get: (source) => values.get(key(source)),
      putIfAbsent(source, id) {
        if (!values.has(key(source))) values.set(key(source), id);
        return values.get(key(source))!;
      },
    },
    () => `app-${++sequence}`,
  );
}
it('keeps Docker usable without another app runtime, validates ownership and never proxies arbitrary operations', async () => {
  const owned = 'a'.repeat(64),
    foreign = 'b'.repeat(64);
  const request = vi.fn(async (_method: string, path: string) =>
    path === '/version'
      ? { ApiVersion: '1.56', MinAPIVersion: '1.44' }
      : path.includes('/json')
        ? [
            {
              Id: owned,
              Names: ['/camera'],
              Image: 'test:1',
              State: 'running',
              Labels: { 'io.haus.app': 'camera' },
            },
            { Id: foreign, Names: ['/foreign'], State: 'running' },
          ]
        : undefined,
  );
  const driver = new DockerApps('docker-host', { request: request as never });
  const apps = new Apps(identities(), { authorize: async (actor) => actor === 'owner' });
  apps.register(driver);
  const inventory = await apps.list('owner');
  expect(inventory.drivers).toEqual([
    { id: 'docker-host', available: true, capabilities: driver.capabilities },
  ]);
  expect(inventory.apps).toHaveLength(2);
  const app = inventory.apps.find((app) => app.managed)!;
  await apps.execute('owner', app.id, 'restart');
  expect(request).toHaveBeenCalledWith('POST', `/v1.56/containers/${owned}/restart`, undefined);
  await expect(apps.execute('guest', app.id, 'stop')).rejects.toThrow('permission_denied');
  const other = inventory.apps.find((app) => !app.managed)!;
  await expect(apps.execute('owner', other.id, 'stop')).rejects.toThrow('unavailable');
  expect(await apps.list('guest')).toEqual({ apps: [], drivers: [] });
  await expect(driver.execute('../escape', 'start')).rejects.toThrow('invalid_app_action');
});
it('retains last-known apps as unavailable when their runtime disconnects and preserves other runtimes', async () => {
  const defaultCaps = {
    lifecycle: true as const,
    install: false,
    remove: false,
    update: false,
    configure: false,
    logs: false,
    info: false,
  };
  const first: AppDriver = {
    id: 'one',
    capabilities: defaultCaps,
    list: vi.fn(async () => [
      {
        externalId: 'physical',
        name: 'Camera',
        state: 'running',
        managed: true,
        actions: ['start'],
      },
    ]),
    execute: vi.fn(),
    inspect: vi.fn(async () => ({ status: 'unsupported' as const, reason: 'unsupported' })),
    operate: vi.fn(async () => ({ status: 'unsupported' as const, reason: 'unsupported' })),
  };
  const second: AppDriver = {
    ...first,
    id: 'two',
    list: vi.fn(async () => [
      {
        externalId: 'physical',
        name: 'Other',
        state: 'running',
        managed: true,
        actions: ['start'],
      },
    ]),
  };
  const apps = new Apps(identities(), { authorize: async () => true });
  apps.register(first);
  apps.register(second);
  const before = await apps.list('owner');
  expect(new Set(before.apps.map((app) => app.id)).size).toBe(2);
  vi.mocked(first.list).mockRejectedValue(Error('private transport detail'));
  const after = await apps.list('owner');
  expect(after.drivers.map((driver) => driver.available)).toEqual([false, true]);
  expect(after.apps[0].available).toBe(false);
  expect(after.apps[0].actions).toEqual([]);
  expect(after.apps[1].available).toBe(true);
  expect(JSON.stringify(after)).not.toContain('private');
});
