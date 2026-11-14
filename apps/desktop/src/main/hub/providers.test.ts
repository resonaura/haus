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

  it('supports Tuya bridge QR login state, start and poll routes', async () => {
    const api = vi.fn(async () => ({ ok: true }));
    const providers = new HubProviders(api);

    await providers.request({ operation: 'loginState', bridgeId: 'bridge-1' });
    await providers.request({ operation: 'loginQrStart', bridgeId: 'bridge-1', region: 'eu' });
    await providers.request({ operation: 'loginQrPoll', bridgeId: 'bridge-1', token: 'qr-123' });

    expect(api.mock.calls).toEqual([
      ['/api/providers/bridge-1/login-state'],
      ['/api/providers/bridge-1/login/qr', { method: 'POST', body: { region: 'eu' } }],
      ['/api/providers/bridge-1/login/qr/poll?token=qr-123'],
    ]);

    await expect(
      providers.request({ operation: 'loginQrStart', bridgeId: 'bridge-1', region: 'bad' }),
    ).rejects.toThrow('Invalid Tuya region.');
    await expect(
      providers.request({ operation: 'loginQrPoll', bridgeId: 'bridge-1', token: '' }),
    ).rejects.toThrow('Invalid Tuya QR token.');
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

  it('supports handover, migration review/apply/undo, and remove workflows', async () => {
    const bridgeHandover = {
      bridgeId: 'bridge-1',
      provider: 'tuya',
      state: 'ready',
      cameras: [],
    };
    const api = vi.fn(async (path: string) => {
      if (path === '/api/providers/handover') {
        return { providers: [{ id: 'bridge-1', handover: bridgeHandover }] };
      }
      return { ok: true };
    });
    const providers = new HubProviders(api);
    const rev = 'a'.repeat(64);

    await expect(providers.request({ operation: 'handoverStatus' })).resolves.toEqual({
      bridges: [bridgeHandover],
    });
    await providers.request({ operation: 'handover', bridgeId: 'bridge-1' });
    await providers.request({ operation: 'migrationStatus', bridgeId: 'bridge-1' });
    await providers.request({ operation: 'migrationReview', bridgeId: 'bridge-1' });
    await providers.request({
      operation: 'migrationApply',
      bridgeId: 'bridge-1',
      revision: rev,
      retire: ['camera.old'],
    });
    await providers.request({
      operation: 'migrationUndo',
      bridgeId: 'bridge-1',
      revision: rev,
    });
    await providers.request({ operation: 'remove', bridgeId: 'bridge-1' });

    expect(api.mock.calls).toEqual([
      ['/api/providers/handover'],
      ['/api/providers/bridge-1/handover', { method: 'POST', body: {} }],
      ['/api/providers/bridge-1/migration'],
      ['/api/providers/bridge-1/migration/review', { method: 'POST', body: {} }],
      [
        '/api/providers/bridge-1/migration/apply',
        { method: 'POST', body: { revision: rev, retire: ['camera.old'] } },
      ],
      ['/api/providers/bridge-1/migration/undo', { method: 'POST', body: { revision: rev } }],
      ['/api/providers/bridge-1/remove', { method: 'POST', body: {} }],
    ]);

    await expect(
      providers.request({
        operation: 'migrationApply',
        bridgeId: 'bridge-1',
        revision: 'bad',
        retire: [],
      }),
    ).rejects.toThrow('Invalid camera bridge migration.');
  });
});
