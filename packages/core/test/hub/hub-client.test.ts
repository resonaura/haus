/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  HausHubClient,
  validateHubServiceOperation,
  validateHubServiceRequest,
  type HubServicePort,
} from '../../src/hub/index.js';

const serverId = '11111111-1111-4111-8111-111111111111';

describe('@haus/core/hub — HausHubClient & Hub service boundary', () => {
  it('validates cluster orchestration, drain-plan, safe removal and coordinator transfer operations', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const client = new HausHubClient({ request });
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

  it('validates Hub cluster attachment, enroll-hub, and full radio/bridge/storage/stream roles', async () => {
    const calls = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'joined',
        homeId: 'home-main',
        coordinatorHubId: serverId,
        coordinatorEpoch: 2,
      })
      .mockResolvedValueOnce({
        status: 'joined',
        node: { id: 'hub-edge', name: 'Radio Edge Hub' },
      })
      .mockResolvedValueOnce({
        role: 'coordinator',
        epoch: 1,
        fenced: false,
        coordinatorId: serverId,
        nodes: [],
      });
    const port: HubServicePort = { request: calls };
    const client = new HausHubClient(port);

    const attached = await client.attachToCoordinator({
      coordinatorUrl: 'https://coord.local:8790',
      selfUrl: 'https://node.local:8790',
      coordinatorToken: 'tok-coord-1',
      roles: ['storage', 'radio', 'bridge'],
      homeId: 'home-main',
      grant: { grantId: 'grant-123', proof: 'sig-1' },
    });
    expect(attached.status).toBe('joined');

    const enrolled = await client.enrollHub({
      targetUrl: 'https://edge.local:8790',
      name: 'Radio Edge Hub',
      roles: ['radio', 'bridge'],
      pairingCode: '123456',
    });
    expect(enrolled.status).toBe('joined');

    await client.addNode({
      name: 'Radio Edge Node',
      url: 'https://edge.local:8790',
      token: 'node-token-123',
      roles: ['storage', 'stream', 'radio', 'bridge'],
    });
    expect(calls).toHaveBeenCalledTimes(3);

    expect(validateHubServiceOperation('GET', '/api/kitsune/catalog', undefined)).toBe(true);
    expect(() =>
      validateHubServiceRequest({
        method: 'POST',
        path: '/api/ha-integration',
        data: { action: 'setup' },
      }),
    ).toThrow('unavailable');
  });
});
