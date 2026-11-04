/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { SupervisorApps } from '../src/apps.js';
it('maps managed apps without exposing Supervisor response fields to the app model', async () => {
  const request = vi.fn(async (_method: string, path: string) =>
    path === '/addons'
      ? {
          data: {
            addons: [
              {
                slug: 'test_camera',
                name: 'Camera',
                version: '1.2.3',
                state: 'started',
                options: { password: 'private' },
              },
            ],
          },
        }
      : {},
  );
  const driver = new SupervisorApps('runtime', { request: request as never });
  const apps = await driver.list();
  expect(apps[0]).toMatchObject({
    name: 'Camera',
    version: '1.2.3',
    state: 'running',
    managed: true,
  });
  expect(JSON.stringify(apps)).not.toContain('private');
  await driver.execute('test_camera', 'stop');
  expect(request).toHaveBeenLastCalledWith('POST', '/addons/test_camera/stop', undefined);
  await expect(driver.execute('../../host', 'restart')).rejects.toThrow('invalid_app_action');
});
