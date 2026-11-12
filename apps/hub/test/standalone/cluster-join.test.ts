/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import { HubAuthService } from '../../src/auth/service.js';
import type {
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
  JoinClusterResponseDto,
} from '../../src/cluster/cluster.dto.js';

describe('Add Another Hub to Existing Home — Multi-Hub Join (P19.2)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('joins secondary Hub into existing home cluster, preserves home identity, enforces explicit permissions, and survives reboot', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-multi-hub-join-'));

    // --- Boot Coordinator Hub (Primary) ---
    const primaryApp = await createNestApp({ dataDirectory: dir });
    await primaryApp.listen(0, '127.0.0.1');
    const primaryPort = (primaryApp.getHttpServer().address() as AddressInfo).port;
    const primaryBase = `http://127.0.0.1:${primaryPort}`;
    const primaryAuth = primaryApp.get<HubAuthService>(HUB_AUTH_SERVICE);

    const coordinatorHubId = primaryAuth.getIdentity().hubId;
    const coordinatorHomeId = primaryAuth.getIdentity().homeId;

    try {
      // 1. Initial admin onboarding on Coordinator Hub
      const challengeRes = await fetch(`${primaryBase}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = primaryAuth.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${primaryBase}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-client', clientName: 'Admin Desktop', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: Record<string, unknown> };

      const pairRes = await fetch(`${primaryBase}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const adminToken = paired.credentials.sessionToken;
      const adminHeaders = {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      };

      // 2. Initial cluster status shows single coordinator node
      const initialStatusRes = await fetch(`${primaryBase}/api/cluster`, { headers: adminHeaders });
      expect(initialStatusRes.status).toBe(200);
      const initialStatus = (await initialStatusRes.json()) as ClusterStatusResponseDto;
      expect(initialStatus.role).toBe('coordinator');
      expect(initialStatus.id).toBe(coordinatorHubId);
      expect(initialStatus.nodes).toHaveLength(0);

      // 3. Coordinator issues a node pairing grant for the secondary Hub
      const nodeChallenge = primaryAuth.openChallenge(undefined, {
        sessionId: 'admin-sess',
        hubId: coordinatorHubId,
        homeId: coordinatorHomeId,
        clientId: 'admin-client',
        clientRole: 'admin',
        clientName: 'Admin',
        token: 'admin-tok',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        revoked: false,
      });

      const secondaryHubId = 'hub-upstairs-02';
      const nodeGrant = primaryAuth.confirmChallenge({
        sessionId: nodeChallenge.sessionId,
        challengeCode: nodeChallenge.challengeCode!,
        client: {
          clientId: secondaryHubId,
          clientName: 'Upstairs Secondary Hub',
          role: 'node',
        },
        expectedHomeId: coordinatorHomeId,
      });
      expect(nodeGrant.clientRole).toBe('node');
      expect(nodeGrant.homeId).toBe(coordinatorHomeId);

      // 4. Invariant: Rogue Hub with wrong homeId is rejected fail-closed (403 Forbidden)
      const wrongHomeRes = await fetch(`${primaryBase}/api/cluster/join`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          hubId: 'hub-rogue-99',
          url: 'http://192.168.5.200:8790',
          homeId: 'home-different-household',
          roles: ['storage'],
        }),
      });
      expect(wrongHomeRes.status).toBe(403);
      expect(await wrongHomeRes.json()).toMatchObject({ error: 'wrong_home' });

      // 5. Invariant: Node attempting to claim invalid/unauthorized roles is rejected (400 Bad Request)
      const invalidRolesRes = await fetch(`${primaryBase}/api/cluster/join`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          hubId: secondaryHubId,
          url: 'http://192.168.5.118:8790',
          homeId: coordinatorHomeId,
          roles: ['superuser', 'admin'],
        }),
      });
      expect(invalidRolesRes.status).toBe(400);
      expect(await invalidRolesRes.json()).toMatchObject({ error: 'invalid_node_roles' });

      // 6. Secondary Hub joins cluster presenting valid credentials and explicit roles
      const joinRes = await fetch(`${primaryBase}/api/cluster/join`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          hubId: secondaryHubId,
          name: 'Upstairs Secondary Hub',
          url: 'http://192.168.5.118:8790',
          homeId: coordinatorHomeId,
          roles: ['storage', 'stream'],
          grant: nodeGrant,
        }),
      });
      expect(joinRes.status).toBe(201);
      const joinBody = (await joinRes.json()) as JoinClusterResponseDto;
      expect(joinBody.status).toBe('joined');
      expect(joinBody.homeId).toBe(coordinatorHomeId); // Home identity preserved
      expect(joinBody.coordinatorHubId).toBe(coordinatorHubId);
      expect(joinBody.node.id).toBe(secondaryHubId);
      expect(joinBody.node.roles).toEqual(['storage', 'stream']);
      expect(joinBody.node.enabled).toBe(true);
      expect(joinBody.node.online).toBe(true);

      // 7. Verify cluster status now lists the secondary Hub
      const updatedStatusRes = await fetch(`${primaryBase}/api/cluster`, { headers: adminHeaders });
      expect(updatedStatusRes.status).toBe(200);
      const updatedStatus = (await updatedStatusRes.json()) as ClusterStatusResponseDto;
      expect(updatedStatus.nodes).toHaveLength(1);
      expect(updatedStatus.nodes[0]?.id).toBe(secondaryHubId);
      expect(updatedStatus.nodes[0]?.homeId).toBe(coordinatorHomeId);

      // 8. Query single node details via GET /api/cluster/nodes/:id
      const nodeDetailRes = await fetch(`${primaryBase}/api/cluster/nodes/${secondaryHubId}`, {
        headers: adminHeaders,
      });
      expect(nodeDetailRes.status).toBe(200);
      const nodeDetail = (await nodeDetailRes.json()) as ClusterNodeRecordDto;
      expect(nodeDetail.id).toBe(secondaryHubId);
      expect(nodeDetail.name).toBe('Upstairs Secondary Hub');

      // 9. Update node roles (e.g. adding 'radio' capability)
      const patchNodeRes = await fetch(`${primaryBase}/api/cluster/nodes/${secondaryHubId}`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ roles: ['storage', 'stream', 'radio'] }),
      });
      expect(patchNodeRes.status).toBe(200);
      const patchedNode = (await patchNodeRes.json()) as ClusterNodeRecordDto;
      expect(patchedNode.roles).toEqual(['storage', 'stream', 'radio']);
    } finally {
      await primaryApp.get(CatalogLifetime).close();
      await primaryApp.close();
    }

    // --- Boot 2: Cold restart on same data directory ---
    const rebootedApp = await createNestApp({ dataDirectory: dir });
    await rebootedApp.listen(0, '127.0.0.1');
    const rebootedPort = (rebootedApp.getHttpServer().address() as AddressInfo).port;
    const rebootedBase = `http://127.0.0.1:${rebootedPort}`;
    const rebootedAuth = rebootedApp.get<HubAuthService>(HUB_AUTH_SERVICE);

    try {
      // 10. Authenticate admin using cold-restored session or challenge
      const cRes = await fetch(`${rebootedBase}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const c = (await cRes.json()) as { sessionId: string };
      const code = rebootedAuth.pairing.getSession(c.sessionId)!.challengeCode;
      const conf = await (
        await fetch(`${rebootedBase}/api/auth/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: c.sessionId,
            challengeCode: code,
            client: { clientId: 'admin-client', clientName: 'Admin', role: 'admin' },
          }),
        })
      ).json();
      const p = await (
        await fetch(`${rebootedBase}/api/auth/pair`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant: conf.grant }),
        })
      ).json();
      const newAdminHeaders = {
        authorization: `Bearer ${p.credentials.sessionToken}`,
        'content-type': 'application/json',
      };

      const nodesRes = await fetch(`${rebootedBase}/api/cluster`, { headers: newAdminHeaders });
      expect(nodesRes.status).toBe(200);
      const clusterStatus = (await nodesRes.json()) as ClusterStatusResponseDto;
      expect(clusterStatus.nodes).toHaveLength(1);
      expect(clusterStatus.nodes[0]?.id).toBe('hub-upstairs-02');
      expect(clusterStatus.nodes[0]?.homeId).toBe(coordinatorHomeId);
      expect(clusterStatus.nodes[0]?.roles).toEqual(['storage', 'stream', 'radio']);

      // 11. Clean node removal via POST /api/cluster/nodes/:id/remove
      const removeRes = await fetch(`${rebootedBase}/api/cluster/nodes/hub-upstairs-02/remove`, {
        method: 'POST',
        headers: newAdminHeaders,
      });
      expect(removeRes.status).toBe(200);
      expect(await removeRes.json()).toEqual({ removed: true, id: 'hub-upstairs-02' });

      const finalStatus = await (
        await fetch(`${rebootedBase}/api/cluster`, { headers: newAdminHeaders })
      ).json();
      expect(finalStatus.nodes).toHaveLength(0);
    } finally {
      await rebootedApp.get(CatalogLifetime).close();
      await rebootedApp.close();
    }
  });
});
