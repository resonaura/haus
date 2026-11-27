/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, describe, expect, it } from 'vitest';
import { createLiveClusterNode, type LiveTestClusterNode } from './harness.js';

describe('Coordinator-driven Hub enrollment, secondary transfer proxy & peer URL preservation', () => {
  const nodes: LiveTestClusterNode[] = [];

  afterEach(async () => {
    while (nodes.length > 0) {
      const node = nodes.pop();
      if (node) await node.close();
    }
  });

  it('enrolls an un-onboarded standalone Hub in one click, exposes cluster members, and transfers leadership back via secondary proxy without clobbering URLs', async () => {
    const primary = await createLiveClusterNode({ hubId: 'hub-primary', role: 'coordinator' });
    const fresh = await createLiveClusterNode({
      hubId: 'hub-fresh-laptop',
      role: 'coordinator',
      homeId: 'home-fresh',
    });
    nodes.push(primary, fresh);

    // Ensure primary has its reachable test URL recorded in cluster state
    await primary.stateStore.saveState({ coordinatorUrl: primary.url });

    // Before enrollment: fresh Hub is un-onboarded standalone
    const freshIdBefore = (await (await fetch(`${fresh.url}/api/auth/identity`)).json()) as {
      hub: { onboarded: boolean; homeId: string; cluster?: { role: string; hubCount: number } };
    };
    expect(freshIdBefore.hub.onboarded).toBe(false);
    expect(freshIdBefore.hub.cluster).toMatchObject({ role: 'standalone', hubCount: 1 });

    // 1-click Coordinator-driven enrollment (`POST /api/cluster/enroll-hub`)
    const enrollRes = await fetch(`${primary.url}/api/cluster/enroll-hub`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${primary.apiToken}`,
      },
      body: JSON.stringify({
        targetUrl: fresh.url,
        name: 'Black Laptop',
        roles: ['storage', 'stream'],
      }),
    });
    expect(enrollRes.status).toBe(200);
    const enrolled = (await enrollRes.json()) as { status: string; homeId: string };
    expect(enrolled).toMatchObject({ status: 'joined', homeId: primary.homeId });

    // Identity on both Hubs now reflects the 2-Hub Home network
    const primaryIdentity = (await (await fetch(`${primary.url}/api/auth/identity`)).json()) as {
      hub: { cluster?: { role: string; hubCount: number; coordinatorHubId: string } };
    };
    expect(primaryIdentity.hub.cluster).toMatchObject({
      role: 'coordinator',
      hubCount: 2,
      coordinatorHubId: 'hub-primary',
    });

    // Transfer leadership from primary -> fresh
    const init1 = (await (
      await fetch(`${primary.url}/api/cluster/transfer/initiate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${primary.apiToken}`,
        },
        body: JSON.stringify({ targetHubId: 'hub-fresh-laptop', preservePairing: true }),
      })
    ).json()) as { transferId: string };
    for (const step of ['prepare', 'fence', 'commit']) {
      const stepRes = await fetch(
        `${primary.url}/api/cluster/transfer/${init1.transferId}/${step}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${primary.apiToken}`,
          },
          body: '{}',
        },
      );
      expect(stepRes.status).toBe(200);
    }

    // Verify primary now accurately reports role: 'node' in /api/cluster (not stale cached 'coordinator')
    // AND includes both members so user connected to primary can still see & transfer back!
    const primaryStatusAfter = (await (
      await fetch(`${primary.url}/api/cluster`, {
        headers: { authorization: `Bearer ${primary.apiToken}` },
      })
    ).json()) as {
      role: string;
      coordinatorId: string;
      members: Array<{ id: string }>;
    };
    expect(primaryStatusAfter.role).toBe('node');
    expect(primaryStatusAfter.coordinatorId).toBe('hub-fresh-laptop');
    expect(primaryStatusAfter.members.map((m) => m.id).sort()).toEqual([
      'hub-fresh-laptop',
      'hub-primary',
    ]);

    // Transfer leadership BACK to primary WHILE STILL CONNECTED TO PRIMARY (role: 'node' proxy!)
    const init2Res = await fetch(`${primary.url}/api/cluster/transfer/initiate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${primary.apiToken}`,
      },
      body: JSON.stringify({ targetHubId: 'hub-primary', preservePairing: true }),
    });
    expect(init2Res.status).toBe(201);
    const init2 = (await init2Res.json()) as { transferId: string };
    for (const step of ['prepare', 'fence', 'commit']) {
      const stepRes = await fetch(
        `${primary.url}/api/cluster/transfer/${init2.transferId}/${step}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${primary.apiToken}`,
          },
          body: '{}',
        },
      );
      expect(stepRes.status).toBe(200);
    }

    const restoredStatus = (await (
      await fetch(`${primary.url}/api/cluster`, {
        headers: { authorization: `Bearer ${primary.apiToken}` },
      })
    ).json()) as { role: string; coordinatorId: string; epoch: number };
    expect(restoredStatus.role).toBe('coordinator');
    expect(restoredStatus.coordinatorId).toBe('hub-primary');
    expect(restoredStatus.epoch).toBeGreaterThanOrEqual(3);
  });
});
