/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it, vi } from 'vitest';
import { HausClient, type HelperPort } from '../src/helper-client.js';
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

it('validates cluster orchestration, drain-plan, safe removal and transfer operations', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const client = new HausClient({ request });
  await client.clusterWorkloads();
  await client.rebalanceCluster();
  await client.reconcileCluster();
  await client.drainPlan('hub-node-2');
  await client.drainNode('hub-node-2', serverId);
  await client.removeNode('hub-node-2', { force: true });
  const tx = await client.initiateTransfer(serverId, true);
  expect(tx).toBeTruthy();
  await client.prepareTransfer('htx_123_abc');
  await client.fenceTransfer('htx_123_abc');
  await client.commitTransfer('htx_123_abc');
  await client.rollbackTransfer('htx_123_abc', 'operator_cancelled');

  expect(request.mock.calls.map(([input]) => input)).toEqual([
    { method: 'GET', path: '/api/cluster/workloads' },
    { method: 'POST', path: '/api/cluster/rebalance', data: {} },
    { method: 'POST', path: '/api/cluster/reconcile', data: {} },
    { method: 'GET', path: '/api/cluster/nodes/hub-node-2/drain-plan' },
    {
      method: 'POST',
      path: '/api/cluster/nodes/hub-node-2/drain',
      data: { targetHubId: serverId },
    },
    { method: 'POST', path: '/api/cluster/nodes/hub-node-2/remove', data: { force: true } },
    {
      method: 'POST',
      path: '/api/cluster/transfer/initiate',
      data: { targetHubId: serverId, preservePairing: true },
    },
    { method: 'POST', path: '/api/cluster/transfer/htx_123_abc/prepare', data: {} },
    { method: 'POST', path: '/api/cluster/transfer/htx_123_abc/fence', data: {} },
    { method: 'POST', path: '/api/cluster/transfer/htx_123_abc/commit', data: {} },
    {
      method: 'POST',
      path: '/api/cluster/transfer/htx_123_abc/rollback',
      data: { reason: 'operator_cancelled' },
    },
  ]);

  await expect(
    client.request({ method: 'POST', path: '/api/cluster/rebalance', data: { cmd: 'rm -rf' } }),
  ).rejects.toThrow('unavailable');
  await expect(
    client.request({
      method: 'POST',
      path: `/api/cluster/nodes/${serverId}/remove`,
      data: { extra: 1 },
    }),
  ).rejects.toThrow('unavailable');
});

it('validates and executes cluster node attachment and key/token enrollment contracts', async () => {
  const calls = vi
    .fn()
    .mockResolvedValueOnce({
      status: 'joined',
      homeId: 'home-main',
      coordinatorHubId: serverId,
      coordinatorEpoch: 2,
    })
    .mockResolvedValueOnce({
      role: 'coordinator',
      epoch: 1,
      fenced: false,
      coordinatorId: serverId,
      nodes: [],
    });
  const client = new HausClient({ request: calls });

  const attached = await client.attachToCoordinator({
    coordinatorUrl: 'https://coord.local:8790',
    selfUrl: 'https://node.local:8790',
    coordinatorToken: 'tok-coord-1',
    roles: ['storage', 'radio', 'bridge'],
    homeId: 'home-main',
    grant: { grantId: 'grant-123', proof: 'sig-1' },
  });
  expect(attached).toMatchObject({
    status: 'joined',
    homeId: 'home-main',
    coordinatorHubId: serverId,
    coordinatorEpoch: 2,
  });

  await client.request({
    method: 'POST',
    path: '/api/cluster/nodes',
    data: {
      name: 'Radio Edge Node',
      url: 'https://edge.local:8790',
      token: 'node-token-123',
      roles: [],
    },
  });
  expect(calls).toHaveBeenCalledTimes(2);

  await expect(
    client.attachToCoordinator({
      coordinatorUrl: '',
      grant: { grantId: 'grant-123' },
    }),
  ).rejects.toThrow('unavailable');
  await expect(
    client.attachToCoordinator({
      coordinatorUrl: 'https://coord.local',
      grant: { grantId: '' },
    }),
  ).rejects.toThrow('unavailable');
  await expect(
    client.attachToCoordinator({
      coordinatorUrl: 'https://coord.local',
      roles: ['invalid_role'],
      grant: { grantId: 'grant-123' },
    }),
  ).rejects.toThrow('unavailable');
  expect(calls).toHaveBeenCalledTimes(2);
});
