/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { HubCommissioningClient } from './commissioning';

it('routes valid commissioning requests and rejects traversal or invalid operations', async () => {
  const api = vi.fn(async () => ({ status: 'ok' }));
  const client = new HubCommissioningClient(api);

  // 1. Create session
  await client.request({
    method: 'POST',
    path: 'commissioning/sessions',
    data: { code: 'MT:Y.K9042C00KA0648G00' },
  });

  // 2. Get session
  await client.request({
    method: 'GET',
    path: 'commissioning/sessions/sess-123',
    data: { sinceSeq: 5 },
  });

  // 3. Resume session
  await client.request({
    method: 'POST',
    path: 'commissioning/sessions/sess-123/resume',
  });

  // 4. Cancel session
  await client.request({
    method: 'POST',
    path: 'commissioning/sessions/sess-123/cancel',
  });

  // 5. Select candidate
  await client.request({
    method: 'POST',
    path: 'commissioning/sessions/sess-123/select',
    data: { candidateId: 'cand-456' },
  });

  // 6. Provide credentials
  await client.request({
    method: 'POST',
    path: 'commissioning/sessions/sess-123/credentials',
    data: { ssid: 'HausNet', password: 'secretpassword', saveForReuse: true },
  });

  // 7. Manual address fallback
  await client.request({
    method: 'POST',
    path: 'commissioning/sessions/sess-123/manual-address',
    data: { address: '192.168.1.100', port: 5540 },
  });

  // 8. Vendor classification & provisioning
  await client.request({
    method: 'POST',
    path: 'commissioning/vendor/classify',
    data: { host: '192.168.33.1', model: 'SHSW-1' },
  });
  await client.request({
    method: 'POST',
    path: 'commissioning/vendor/provision',
    data: {
      protocol: 'shelly-rpc',
      targetHost: '192.168.33.1',
      wifi: { ssid: 'HausNet', password: 'secret' },
    },
  });

  // 9. Stored credentials
  await client.request({ method: 'GET', path: 'commissioning/credentials/wifi' });
  await client.request({ method: 'GET', path: 'commissioning/credentials/thread' });

  expect(api.mock.calls).toEqual([
    ['/api/commissioning/sessions', { method: 'POST', body: { code: 'MT:Y.K9042C00KA0648G00' } }],
    ['/api/commissioning/sessions/sess-123?sinceSeq=5'],
    ['/api/commissioning/sessions/sess-123/resume', { method: 'POST', body: {} }],
    ['/api/commissioning/sessions/sess-123/cancel', { method: 'POST', body: {} }],
    ['/api/commissioning/sessions/sess-123/select', { method: 'POST', body: { candidateId: 'cand-456' } }],
    [
      '/api/commissioning/sessions/sess-123/credentials',
      {
        method: 'POST',
        body: { ssid: 'HausNet', password: 'secretpassword', saveForReuse: true },
      },
    ],
    [
      '/api/commissioning/sessions/sess-123/manual-address',
      { method: 'POST', body: { address: '192.168.1.100', port: 5540 } },
    ],
    ['/api/commissioning/vendor/classify', { method: 'POST', body: { host: '192.168.33.1', model: 'SHSW-1' } }],
    [
      '/api/commissioning/vendor/provision',
      {
        method: 'POST',
        body: {
          protocol: 'shelly-rpc',
          targetHost: '192.168.33.1',
          wifi: { ssid: 'HausNet', password: 'secret' },
        },
      },
    ],
    ['/api/commissioning/credentials/wifi'],
    ['/api/commissioning/credentials/thread'],
  ]);

  api.mockClear();

  // Test that traversal attacks and unsupported operations throw errors
  for (const invalidRequest of [
    { method: 'GET', path: 'commissioning/sessions/../../../etc/passwd' },
    { method: 'POST', path: 'commissioning/sessions', data: {} }, // missing code
    { method: 'POST', path: 'commissioning/sessions/sess-1/select', data: {} }, // missing candidateId
    { method: 'POST', path: 'commissioning/sessions/sess-1/manual-address', data: {} }, // missing address
    { method: 'DELETE', path: 'commissioning/sessions/sess-1' },
    { method: 'GET', path: 'commissioning/unknown' },
  ]) {
    await expect(client.request(invalidRequest)).rejects.toThrow();
  }
  expect(api).not.toHaveBeenCalled();
});
