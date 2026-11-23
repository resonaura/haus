/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { HubApps } from './apps';

it('restricts renderer App access to supported operations on enrolled Apps', async () => {
  const api = vi.fn(async () => ({ status: 'ok' }));
  const apps = new HubApps(api);
  await apps.request({ method: 'GET', path: 'apps' });
  await apps.request({ method: 'POST', path: 'apps/app-1/execute', data: { action: 'restart' } });
  await apps.request({ method: 'POST', path: 'apps/app-1/accessories/sync', data: {} });
  await apps.request({ method: 'GET', path: 'apps/catalog' });
  await apps.request({ method: 'GET', path: 'apps/catalog/aqara-cameras' });
  await apps.request({ method: 'GET', path: 'apps/app-1/update-check' });
  await apps.request({
    method: 'POST',
    path: 'apps/app-1/update',
    data: { grantedPermissions: ['network:host'] },
  });

  expect(api.mock.calls).toEqual([
    ['/api/apps'],
    ['/api/apps/app-1/execute', { method: 'POST', body: { action: 'restart' } }],
    ['/api/apps/app-1/accessories/sync', { method: 'POST', body: {} }],
    ['/api/apps/catalog'],
    ['/api/apps/catalog/aqara-cameras'],
    ['/api/apps/app-1/update-check'],
    ['/api/apps/app-1/update', { method: 'POST', body: { grantedPermissions: ['network:host'] } }],
  ]);
  api.mockClear();
  for (const request of [
    { method: 'GET', path: 'apps/../auth/sessions' },
    { method: 'GET', path: 'apps/../inspect' },
    {
      method: 'POST',
      path: 'apps/app-1/execute',
      data: { action: 'restart', url: 'http://other' },
    },
    { method: 'POST', path: 'apps/app-1/operate', data: { operation: 'remove' } },
    { method: 'POST', path: 'apps/app-1/accessories/sync', data: { url: 'http://other' } },
    { method: 'GET', path: 'apps', token: 'must-not-be-forwarded' },
    { method: 'GET', path: 'apps/catalog/../secret' },
    { method: 'POST', path: 'apps/app-1/update-check', data: {} },
  ])
    await expect(apps.request(request)).rejects.toThrow();
  expect(api).not.toHaveBeenCalled();
});

it('permits explicit custom add-on repository lifecycle requests and rejects invalid repository inputs', async () => {
  const api = vi.fn(async () => ({ ok: true }));
  const apps = new HubApps(api);

  await apps.request({ method: 'GET', path: 'apps/repositories' });
  await apps.request({
    method: 'POST',
    path: 'apps/repositories',
    data: { url: 'https://github.com/example/addons#main' },
  });
  await apps.request({ method: 'POST', path: 'apps/repositories/reload', data: {} });
  await apps.request({ method: 'POST', path: 'apps/repositories/a1b2c3d4/reload', data: {} });
  await apps.request({ method: 'POST', path: 'apps/repositories/a1b2c3d4/remove', data: {} });

  expect(api.mock.calls).toEqual([
    ['/api/apps/repositories'],
    [
      '/api/apps/repositories',
      { method: 'POST', body: { url: 'https://github.com/example/addons#main' } },
    ],
    ['/api/apps/repositories/reload', { method: 'POST', body: {} }],
    ['/api/apps/repositories/a1b2c3d4/reload', { method: 'POST', body: {} }],
    ['/api/apps/repositories/a1b2c3d4/remove', { method: 'POST', body: {} }],
  ]);

  api.mockClear();
  for (const bad of [
    { method: 'POST', path: 'apps/repositories', data: { url: '', extra: true } },
    { method: 'POST', path: 'apps/repositories/not-hex!/remove', data: {} },
    { method: 'POST', path: 'apps/repositories/../../etc/remove', data: {} },
    { method: 'POST', path: 'apps/repositories/a1b2c3d4/remove', data: { token: 'leak' } },
  ]) {
    await expect(apps.request(bad)).rejects.toThrow();
  }
  expect(api).not.toHaveBeenCalled();
});
