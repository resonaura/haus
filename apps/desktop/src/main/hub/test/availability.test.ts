/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { HausHelper } from '../../helper';

type HelperConnection = ConstructorParameters<typeof HausHelper>[0];

describe('HausHelper availability on Hub connections', () => {
  it('returns not installed and avoids calling addonSurface while Hub connection is not ready', async () => {
    const addonSurface = vi.fn(async () => {
      throw new Error('Connect to your Haus Hub first.');
    });
    const connection: HelperConnection = {
      isHub: true,
      connected: false,
      serverUrl: 'http://127.0.0.1:8790',
      credentialScope: 'http://127.0.0.1:8790',
      addonSurface,
      getSession: vi.fn(async () => null),
      connect: vi.fn(async () => ({
        url: 'http://127.0.0.1:8790',
        name: 'Haus',
        kind: 'haus-hub' as const,
      })),
      disconnect: vi.fn(async () => {}),
      request: vi.fn(),
      cameraLastSnapshot: vi.fn(async () => null),
      cameraSnapshot: vi.fn(),
      getSceneConfig: vi.fn(async () => null),
      subscribe: vi.fn(async () => 'sub'),
      unsubscribe: vi.fn(async () => {}),
      cachedHome: vi.fn(async () => null),
      brandIcon: vi.fn(async () => null),
      dispose: vi.fn(),
      management: vi.fn(),
    };
    const helper = new HausHelper(connection);

    await expect(helper.availability()).resolves.toEqual({ installed: false });
    await expect(helper.request({ method: 'GET', path: '/api/cameras' })).rejects.toThrow(
      'Install Haus to record camera events.',
    );
    expect(addonSurface).not.toHaveBeenCalled();
  });
});
