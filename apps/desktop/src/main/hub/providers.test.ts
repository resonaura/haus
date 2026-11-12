/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { HubProviders } from './providers';

describe('Hub camera provider API', () => {
  it('maps supported workflows to fixed authenticated Hub routes', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    const providers = new HubProviders(api);

    await providers.request({ operation: 'list' });
    await providers.request({ operation: 'discover' });
    await providers.request({ operation: 'connect', bridgeId: 'bridge-1' });
    await providers.request({ operation: 'preview', bridgeId: 'bridge-1' });
    await providers.request({
      operation: 'enroll',
      url: 'http://192.168.5.117:8580',
      code: '123456',
      allowHttp: true,
    });
    await providers.request({ operation: 'import', bridgeId: 'bridge-1', cameras: ['cam-1'] });

    expect(api.mock.calls).toEqual([
      ['/api/providers'],
      ['/api/providers/discover', { method: 'POST', body: {} }],
      ['/api/providers/connect', { method: 'POST', body: { bridgeId: 'bridge-1' } }],
      ['/api/providers/bridge-1'],
      [
        '/api/providers/enroll',
        {
          method: 'POST',
          body: { url: 'http://192.168.5.117:8580', code: '123456', allowHttp: true },
        },
      ],
      ['/api/providers/bridge-1/import', { method: 'POST', body: { cameras: ['cam-1'] } }],
    ]);
  });

  it('rejects unknown operations, extra fields and malformed camera IDs', async () => {
    const api = vi.fn();
    const providers = new HubProviders(api);

    await expect(
      providers.request({ operation: 'delete', path: '/api/providers' }),
    ).rejects.toThrow('Unsupported camera bridge operation.');
    await expect(providers.request({ operation: 'list', path: '/api/devices' })).rejects.toThrow(
      'Invalid camera bridge request.',
    );
    await expect(
      providers.request({ operation: 'import', bridgeId: 'bridge-1', cameras: ['bad/id'] }),
    ).rejects.toThrow('Invalid camera selection.');
    expect(api).not.toHaveBeenCalled();
  });
});
