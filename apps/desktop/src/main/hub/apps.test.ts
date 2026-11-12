/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { HubApps } from './apps';

it('restricts renderer App access to supported operations on enrolled Apps', async () => {
  const api = vi.fn(async () => ({ status: 'ok' }));
  const apps = new HubApps(api);
  await apps.request({ method: 'GET', path: 'apps' });
  await apps.request({ method: 'POST', path: 'apps/app-1/execute', data: { action: 'restart' } });
  await apps.request({ method: 'POST', path: 'apps/app-1/accessories/sync', data: {} });
  expect(api.mock.calls).toEqual([
    ['/api/apps'],
    ['/api/apps/app-1/execute', { method: 'POST', body: { action: 'restart' } }],
    ['/api/apps/app-1/accessories/sync', { method: 'POST', body: {} }],
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
  ])
    await expect(apps.request(request)).rejects.toThrow();
  expect(api).not.toHaveBeenCalled();
});
