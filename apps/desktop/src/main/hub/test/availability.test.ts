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
      request: vi.fn(),
    };
    const helper = new HausHelper(connection);

    await expect(helper.availability()).resolves.toEqual({ installed: false });
    await expect(helper.request({ method: 'GET', path: '/api/cameras' })).rejects.toThrow(
      'Connect Haus Hub to record camera events.',
    );
    expect(addonSurface).not.toHaveBeenCalled();
  });
});
