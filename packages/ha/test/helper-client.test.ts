/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it, vi } from 'vitest';
import { HaHelperClient, HausClient, type HelperPort } from '../src/helper-client.js';

const serverId = '11111111-1111-4111-8111-111111111111';

it('allows only explicit bounded metadata migration steps without arbitrary HA writes', async () => {
  const request = vi.fn().mockResolvedValue({});
  const client = new HausClient({ request });
  const path = `/api/providers/${serverId}/migration`,
    revision = 'a'.repeat(64);
  await client.request({ method: 'GET', path });
  await client.request({ method: 'POST', path: `${path}/review`, data: {} });
  await client.request({
    method: 'POST',
    path: `${path}/apply`,
    data: { revision, retire: ['sensor.old'] },
  });
  await client.request({ method: 'POST', path: `${path}/undo`, data: { revision } });
  for (const [operation, data] of [
    ['review', { delete: true }],
    ['apply', { revision, retire: ['bad/id'] }],
    ['undo', { revision, force: true }],
    ['apply', { revision: 'old', retire: [] }],
  ] as const)
    await expect(
      client.request({ method: 'POST', path: `${path}/${operation}`, data }),
    ).rejects.toThrow('unavailable');
  expect(request).toHaveBeenCalledTimes(4);
});

it('allows only read-only native handover review and explicit per-bridge confirmation', async () => {
  const request = vi.fn().mockResolvedValue({ bridges: [] });
  const client = new HausClient({ request });
  await client.request({ method: 'GET', path: '/api/providers/handover' });
  await client.request({ method: 'POST', path: `/api/providers/${serverId}/handover`, data: {} });
  await expect(
    client.request({ method: 'POST', path: '/api/providers/handover', data: {} }),
  ).rejects.toThrow('unavailable');
  await expect(
    client.request({ method: 'GET', path: '/api/providers/handover?token=secret' }),
  ).rejects.toThrow('query');
  expect(request).toHaveBeenCalledTimes(2);
});

it('confirms storage settings with the real read protocol and rejects stale confirmations', async () => {
  const calls = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ servers: [{ id: serverId, settings: { storageLimitBytes: null } }] });
  const port: HelperPort = { request: calls };
  const client = new HaHelperClient(port);
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
  const client = new HaHelperClient({ request });
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
  const client = new HaHelperClient({ request });
  await expect(client.capabilities()).resolves.toMatchObject({
    protocol: 1,
    features: { cluster: true, previewPreheat: false },
  });
  expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/status' });
});

it('supports video-only NVR cluster operations (storage/stream) and Home Assistant camera sharing (/api/ha-integration)', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ optional: true, nodes: [], backups: {}, sync: {}, busy: false });
  const client = new HaHelperClient({ request });

  await client.setupHaIntegration({ nativeEntities: true });
  await client.revokeHaIntegration('a'.repeat(24));

  await client.addNode({
    name: 'NVR',
    url: 'https://nvr.example',
    key: 'k'.repeat(32),
    allowHttp: false,
    roles: ['storage', 'stream'],
  });
  await client.updateNode(serverId, { enabled: false });
  await client.drainPlan(serverId);
  await client.drainNode(serverId);
  await client.removeNode(serverId);

  expect(request.mock.calls.map(([input]) => input)).toEqual([
    {
      method: 'POST',
      path: '/api/ha-integration',
      data: { action: 'setup', nativeEntities: true },
    },
    {
      method: 'POST',
      path: '/api/ha-integration',
      data: { action: 'revoke', clientId: 'a'.repeat(24) },
    },
    {
      method: 'POST',
      path: '/api/cluster/nodes',
      data: {
        name: 'NVR',
        url: 'https://nvr.example',
        key: 'k'.repeat(32),
        allowHttp: false,
        roles: ['storage', 'stream'],
      },
    },
    { method: 'PATCH', path: `/api/cluster/nodes/${serverId}`, data: { enabled: false } },
    { method: 'GET', path: `/api/cluster/nodes/${serverId}/drain-plan` },
    { method: 'POST', path: `/api/cluster/nodes/${serverId}/drain`, data: {} },
    { method: 'POST', path: `/api/cluster/nodes/${serverId}/remove`, data: {} },
  ]);
  expect(() => client.removeNode('../other')).toThrow('invalid-server');
  expect(() => client.removeNode('hub-node-2')).toThrow('invalid-server');
  expect(() => client.revokeHaIntegration('not-hex')).toThrow(
    'Invalid Home Assistant camera integration request.',
  );
});

it('strictly rejects Haus Hub mesh/coordinator/radio/bridge/kitsune operations on Home Assistant hubs', async () => {
  const request = vi.fn().mockResolvedValue({});
  const client = new HaHelperClient({ request });

  for (const forbidden of [
    {
      method: 'POST' as const,
      path: '/api/cluster/nodes',
      data: {
        name: 'Radio Hub',
        url: 'https://hub.local',
        token: 'tok-123',
        roles: ['radio'],
      },
    },
    {
      method: 'POST' as const,
      path: '/api/cluster/nodes',
      data: {
        name: 'Bridge Hub',
        url: 'https://hub.local',
        token: 'tok-123',
        roles: ['bridge'],
      },
    },
    { method: 'GET' as const, path: '/api/cluster/workloads' },
    { method: 'POST' as const, path: '/api/cluster/rebalance', data: {} },
    { method: 'POST' as const, path: '/api/cluster/reconcile', data: {} },
    {
      method: 'POST' as const,
      path: '/api/cluster/enroll-hub',
      data: { targetUrl: 'https://hub2.local', roles: ['storage'] },
    },
    {
      method: 'POST' as const,
      path: '/api/cluster/attach',
      data: { coordinatorUrl: 'https://coord.local', grant: { grantId: 'g-1' } },
    },
    {
      method: 'POST' as const,
      path: '/api/cluster/transfer/initiate',
      data: { targetHubId: serverId, preservePairing: true },
    },
    { method: 'POST' as const, path: '/api/cluster/transfer/htx_1/prepare', data: {} },
    { method: 'GET' as const, path: '/api/kitsune/catalog' },
  ]) {
    await expect(client.request(forbidden)).rejects.toThrow('unavailable');
  }
  expect(request).not.toHaveBeenCalled();
});

it('emits only redacted failure diagnostics, never successful polling noise', async () => {
  const report = vi.fn(() => {
    throw new Error('diagnostics must never change request outcomes');
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce({ servers: [] })
    .mockRejectedValueOnce(new Error('private URL token=secret'));
  const client = new HaHelperClient({ request }, report);
  await client.servers();
  await expect(client.servers()).rejects.toThrow('private URL');
  expect(report).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ operation: 'list-servers', outcome: 'failure' }),
  );
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private URL|secret|\/api\/servers/);
});

it('validates shared icon appearance preferences in PATCH /api/preferences', async () => {
  const request = vi.fn().mockResolvedValue({ revision: '1', value: {}, updatedAt: 1 });
  const client = new HaHelperClient({ request });

  await client.request({ method: 'GET', path: '/api/brands/status' });
  await client.request({
    method: 'PATCH',
    path: '/api/preferences',
    data: {
      baseRevision: '0',
      patch: {
        iconAppearance: 'tinted',
        iconVariation: 'dark',
        iconTintColor: 'blue',
      },
    },
  });
  expect(request).toHaveBeenCalledTimes(2);

  for (const patch of [
    { iconAppearance: 'neon' },
    { iconVariation: 'sepia' },
    { iconTintColor: 'rainbow' },
    { access_token: 'secret' },
  ]) {
    await expect(
      client.request({
        method: 'PATCH',
        path: '/api/preferences',
        data: { baseRevision: '0', patch },
      }),
    ).rejects.toThrow('unavailable');
  }
  expect(request).toHaveBeenCalledTimes(2);
});
