/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it, vi } from 'vitest';
import { HausClient, type HelperPort } from '../src/helper-client.js';
const serverId = '11111111-1111-4111-8111-111111111111';
it('confirms storage settings with the real read protocol and rejects stale confirmations', async () => {
  const calls = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ servers: [{ id: serverId, settings: { storageLimitBytes: null } }] });
  const port: HelperPort = { request: calls };
  const client = new HausClient(port);
  await client.setStorageLimit(serverId, null);
  expect(calls.mock.calls).toEqual([
    [
      {
        method: 'PATCH',
        path: `/api/cluster/nodes/${serverId}`,
        data: { storageLimitBytes: null },
      },
    ],
    [{ method: 'GET', path: '/api/servers' }],
  ]);
  calls.mockResolvedValueOnce({}).mockResolvedValueOnce({ servers: [] });
  await expect(client.setStorageLimit(serverId, 100)).rejects.toThrow('storage-limit-unconfirmed');
});
it('uses the native allowlist before transport and discards responses after session disposal', async () => {
  let complete!: (value: unknown) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const client = new HausClient({ request });
  await expect(
    client.request({ method: 'POST', path: '/api/shell', data: { command: 'anything' } }),
  ).rejects.toThrow('unavailable');
  await expect(client.setStorageLimit(serverId, -1)).rejects.toThrow('unavailable');
  expect(request).not.toHaveBeenCalled();
  const pending = client.servers();
  const discarded = expect(pending).rejects.toThrow('session-changed');
  client.dispose();
  complete({ servers: [] });
  await discarded;
  await expect(client.cluster()).rejects.toThrow('session-changed');
  expect(request).toHaveBeenCalledOnce();
});

it('uses the authenticated status endpoint for feature negotiation', async () => {
  const request = vi.fn().mockResolvedValue({
    protocol: 1,
    name: 'Haus',
    version: '0.3.55',
    connected: true,
    features: { cluster: true, previewPreheat: false },
  });
  const client = new HausClient({ request });
  await expect(client.capabilities()).resolves.toMatchObject({
    protocol: 1,
    features: { cluster: true, previewPreheat: false },
  });
  expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/status' });
});

it('exposes only the existing typed cluster enrollment, update and removal operations', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ optional: true, nodes: [], backups: {}, sync: {}, busy: false });
  const client = new HausClient({ request });
  await client.addNode({
    name: 'NVR',
    url: 'https://nvr.example',
    key: 'k'.repeat(32),
    allowHttp: false,
    roles: ['stream'],
  });
  await client.updateNode(serverId, { enabled: false });
  await client.removeNode(serverId);
  expect(request.mock.calls.map(([input]) => input)).toEqual([
    {
      method: 'POST',
      path: '/api/cluster/nodes',
      data: {
        name: 'NVR',
        url: 'https://nvr.example',
        key: 'k'.repeat(32),
        allowHttp: false,
        roles: ['stream'],
      },
    },
    { method: 'PATCH', path: `/api/cluster/nodes/${serverId}`, data: { enabled: false } },
    { method: 'POST', path: `/api/cluster/nodes/${serverId}/remove`, data: {} },
  ]);
  expect(() => client.removeNode('../other')).toThrow('invalid-server');
  expect(request).toHaveBeenCalledTimes(3);
});

it('emits only redacted failure diagnostics, never successful polling noise', async () => {
  const report = vi.fn(() => {
    throw new Error('diagnostics must never change request outcomes');
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce({ servers: [] })
    .mockRejectedValueOnce(new Error('private URL token=secret'));
  const client = new HausClient({ request }, report);
  await client.servers();
  await expect(client.servers()).rejects.toThrow('private URL');
  expect(report).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ operation: 'list-servers', outcome: 'failure' }),
  );
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private URL|secret|\/api\/servers/);
});
