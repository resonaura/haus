/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Not, In } from 'typeorm';
import { buildSignedPeerHeaders } from '../../src/cluster/crypto/transport.js';
import {
  ClusterPeerKeyEntity,
  ClusterSyncStateEntity,
  ClusterTransferEntity,
  ClusterWorkloadEntity,
} from '../../src/storage/cluster/entities.js';
import { ClusterNodeEntity, HomeKitIdentityEntity } from '../../src/storage/entities/domains.js';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import {
  createLiveClusterNode,
  pairAndJoinPeer,
  type LiveTestClusterNode,
} from './harness.js';

async function pairClient(
  node: LiveTestClusterNode,
  client: { readonly clientId: string; readonly clientName: string; readonly role: 'admin' | 'member' },
): Promise<string> {
  const challengeRes = await fetch(`${node.url}/api/auth/challenge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${node.apiToken}`,
    },
    body: JSON.stringify({}),
  });
  expect(challengeRes.status).toBe(201);
  const challenge = (await challengeRes.json()) as {
    sessionId: string;
    challengeCode: string;
  };
  const confirmRes = await fetch(`${node.url}/api/auth/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${node.apiToken}`,
    },
    body: JSON.stringify({
      sessionId: challenge.sessionId,
      challengeCode: challenge.challengeCode,
      client,
      expectedHomeId: node.homeId,
    }),
  });
  expect(confirmRes.status).toBe(201);
  const confirmed = (await confirmRes.json()) as { grant: Record<string, unknown> };
  const pairRes = await fetch(`${node.url}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant: confirmed.grant }),
  });
  expect(pairRes.status).toBe(201);
  const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
  return paired.credentials.sessionToken;
}

describe('Cluster join authorization, replay resistance & decommission secret wipe', () => {
  const nodes: LiveTestClusterNode[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const node of nodes.splice(0)) {
      await node.close();
    }
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('requires admin authZ on POST /api/cluster/join, blocks self-join, and persists single-use grants across reboot', async () => {
    const coordDir = await mkdtemp(join(tmpdir(), 'haus-sec-coord-'));
    tempDirs.push(coordDir);

    const coord = await createLiveClusterNode({
      hubId: 'hub-sec-coord',
      role: 'coordinator',
      dataDir: coordDir,
      keepDirOnClose: true,
    });
    const sec = await createLiveClusterNode({
      hubId: 'hub-sec-worker',
      role: 'node',
      homeId: coord.homeId,
    });
    nodes.push(coord, sec);

    // Ensure at least one persisted admin session exists before pairing a non-admin member
    await pairClient(coord, {
      clientId: 'admin-baseline',
      clientName: 'Admin Baseline',
      role: 'admin',
    });
    const memberToken = await pairClient(coord, {
      clientId: 'member-non-admin',
      clientName: 'Household Member',
      role: 'member',
    });

    const secPub = sec.stateStore.getIdentitySync(sec.hubId).publicIdentity();
    const joinGrantChallenge = coord.authService.openChallenge(undefined, {
      sessionId: 'admin-join-sess',
      hubId: coord.hubId,
      homeId: coord.homeId,
      clientId: 'admin-client',
      clientRole: 'admin',
      clientName: 'Admin',
      token: coord.apiToken,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      revoked: false,
    });
    const joinGrant = coord.authService.confirmChallenge({
      sessionId: joinGrantChallenge.sessionId,
      challengeCode: joinGrantChallenge.challengeCode!,
      client: { clientId: sec.hubId, clientName: 'Secondary Hub', role: 'node' },
      expectedHomeId: coord.homeId,
    });

    // Non-admin bearer token must fail HTTP 403 on POST /api/cluster/join
    const nonAdminJoin = await fetch(`${coord.url}/api/cluster/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        hubId: sec.hubId,
        url: sec.url,
        homeId: coord.homeId,
        name: 'Secondary Hub',
        roles: ['storage'],
        publicIdentity: secPub,
        grant: joinGrant,
      }),
    });
    expect(nonAdminJoin.status).toBe(403);

    // Admin attempting to join coordinator's own hubId must fail HTTP 409 cannot_join_self_hub_id
    const selfJoin = await fetch(`${coord.url}/api/cluster/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${coord.apiToken}`,
      },
      body: JSON.stringify({
        hubId: coord.hubId,
        url: coord.url,
        homeId: coord.homeId,
        name: 'Self',
        roles: ['storage'],
        publicIdentity: coord.stateStore.getIdentitySync(coord.hubId).publicIdentity(),
        grant: joinGrant,
      }),
    });
    expect(selfJoin.status).toBe(409);
    expect(await selfJoin.json()).toMatchObject({ error: 'cannot_join_self_hub_id' });

    // First valid admin join consumes grantId
    const validJoin = await fetch(`${coord.url}/api/cluster/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${coord.apiToken}`,
      },
      body: JSON.stringify({
        hubId: sec.hubId,
        url: sec.url,
        homeId: coord.homeId,
        name: 'Secondary Hub',
        roles: ['storage', 'stream'],
        publicIdentity: secPub,
        grant: joinGrant,
      }),
    });
    expect(validJoin.status).toBe(201);
    expect(await validJoin.json()).toMatchObject({ status: 'joined' });

    // Immediate replay of same grantId rejected
    const replayImmediate = await fetch(`${coord.url}/api/cluster/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${coord.apiToken}`,
      },
      body: JSON.stringify({
        hubId: 'hub-sec-other',
        url: sec.url,
        homeId: coord.homeId,
        name: 'Other Hub',
        roles: ['storage'],
        publicIdentity: secPub,
        grant: joinGrant,
      }),
    });
    expect(replayImmediate.status).toBe(401);
    expect(await replayImmediate.json()).toMatchObject({ error: 'grant_revoked' });

    // Reboot coordinator on same persistent DB and verify grantId remains permanently consumed
    const coordIdx = nodes.indexOf(coord);
    if (coordIdx >= 0) nodes.splice(coordIdx, 1);
    await coord.close();

    const rebooted = await createLiveClusterNode({
      hubId: 'hub-sec-coord',
      role: 'coordinator',
      dataDir: coordDir,
      apiToken: coord.apiToken,
      keepDirOnClose: true,
    });
    nodes.push(rebooted);

    const replayAfterRestart = await fetch(`${rebooted.url}/api/cluster/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${coord.apiToken}`,
      },
      body: JSON.stringify({
        hubId: 'hub-sec-other-after-restart',
        url: sec.url,
        homeId: coord.homeId,
        name: 'Other After Restart',
        roles: ['storage'],
        publicIdentity: secPub,
        grant: joinGrant,
      }),
    });
    expect(replayAfterRestart.status).toBe(401);
    expect(await replayAfterRestart.json()).toMatchObject({ error: 'grant_revoked' });
  });

  it('rejects non-coordinator peer RPCs (startWorkload & decommission) and wipes secrets on valid decommission', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-dec-coord', role: 'coordinator' });
    const w1 = await createLiveClusterNode({
      hubId: 'hub-dec-w1',
      role: 'node',
      homeId: coord.homeId,
    });
    const w2 = await createLiveClusterNode({
      hubId: 'hub-dec-w2',
      role: 'node',
      homeId: coord.homeId,
    });
    nodes.push(coord, w1, w2);

    await pairAndJoinPeer({ coordinator: coord, secondary: w1 });
    await pairAndJoinPeer({ coordinator: coord, secondary: w2 });

    // Give w2 valid mutual cryptographic peer trust on w1 (non-coordinator peer!)
    const sharedPeerSecret = 'mutual-peer-channel-secret-0123456789abcdef';
    const w2Id = w2.stateStore.getIdentitySync(w2.hubId);
    await w1.stateStore.upsertPeerTrust({
      hubId: w2.hubId,
      homeId: coord.homeId,
      publicIdentity: w2Id.publicIdentity(),
      channelSecret: sharedPeerSecret,
    });

    // Signed startWorkload from non-coordinator w2 -> 403 coordinator_authority_required
    const startPath = '/api/cluster/peer/workloads/app%3Adec-test/start';
    const startBody = Buffer.from(JSON.stringify({ generation: 2, epoch: 1 }));
    const forgedStart = await fetch(`${w1.url}${startPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...buildSignedPeerHeaders({
          identity: w2Id,
          recipientHubId: w1.hubId,
          homeId: coord.homeId,
          method: 'POST',
          path: startPath,
          bodyBytes: startBody,
          channelSecret: sharedPeerSecret,
        }),
      },
      body: startBody,
    });
    expect(forgedStart.status).toBe(403);
    expect(await forgedStart.json()).toMatchObject({ error: 'coordinator_authority_required' });

    // Signed decommission from non-coordinator w2 -> 403 coordinator_authority_required
    const decPath = '/api/cluster/peer/decommission';
    const decBody = Buffer.from(JSON.stringify({ reason: 'unauthorized_attempt' }));
    const forgedDec = await fetch(`${w1.url}${decPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...buildSignedPeerHeaders({
          identity: w2Id,
          recipientHubId: w1.hubId,
          homeId: coord.homeId,
          method: 'POST',
          path: decPath,
          bodyBytes: decBody,
          channelSecret: sharedPeerSecret,
        }),
      },
      body: decBody,
    });
    expect(forgedDec.status).toBe(403);
    expect(await forgedDec.json()).toMatchObject({ error: 'coordinator_authority_required' });

    // Seed sensitive replicated records on w1 before genuine coordinator decommission
    const now = Date.now();
    await w1.transactions.run(async (manager) => {
      await manager.upsert(
        ClusterWorkloadEntity,
        {
          workloadId: 'app:dec-test',
          kind: 'app',
          name: 'Dec Test App',
          ownerHubId: w1.hubId,
          standbyHubIdsJson: JSON.stringify([coord.hubId]),
          generation: 1,
          epoch: 1,
          state: 'active',
          leaseExpiresAt: now + 30_000,
          configRevision: 1,
          credentialRevision: 1,
          cacheRevision: 1,
          requirementsJson: '{}',
          preferredHubId: null,
          updatedAt: now,
        },
        ['workloadId'],
      );
      await manager.upsert(
        ClusterTransferEntity,
        {
          transferId: 'tx-dec-1',
          sourceHubId: coord.hubId,
          targetHubId: w1.hubId,
          state: 'rolled_back',
          epoch: 1,
          preservePairing: true,
          summaryJson: '{}',
          reason: 'seed',
          createdAt: now,
          updatedAt: now,
        },
        ['transferId'],
      );
      await manager.upsert(
        HomeKitIdentityEntity,
        { cameraId: 'cam-dec-1', value: JSON.stringify({ pin: '123-45-678' }) },
        ['cameraId'],
      );
      await manager.upsert(
        ClusterSyncStateEntity,
        {
          syncKey: 'credential:seed',
          kind: 'credential',
          resourceId: 'seed',
          revision: 1,
          generation: 1,
          epoch: 1,
          sha256: 'a'.repeat(64),
          sourceHubId: coord.hubId,
          updatedAt: now,
        },
        ['syncKey'],
      );
      for (const kind of [
        'tuya_credentials',
        'ha_app_credential',
        'ha_entry_runtime',
        'network_credentials',
        'homekit_pairing',
      ]) {
        await manager.upsert(
          StandaloneHomeEntryEntity,
          {
            kind,
            entryId: `${kind}-1`,
            value: JSON.stringify({ secret: 'top-secret' }),
            updatedAt: now,
          },
          ['kind', 'entryId'],
        );
      }
    });

    // Execute authentic coordinator decommission against w1
    const coordTrust = w1.stateStore.getPeerTrustRecord(coord.hubId)!;
    const coordId = coord.stateStore.getIdentitySync(coord.hubId);
    const validDecBody = Buffer.from(
      JSON.stringify({ reason: 'node_removed', issuedByHubId: coord.hubId }),
    );
    const validDec = await fetch(`${w1.url}${decPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...buildSignedPeerHeaders({
          identity: coordId,
          recipientHubId: w1.hubId,
          homeId: coord.homeId,
          method: 'POST',
          path: decPath,
          bodyBytes: validDecBody,
          channelSecret: coordTrust.channelSecret,
        }),
      },
      body: validDecBody,
    });
    expect(validDec.status).toBe(200);
    expect(await validDec.json()).toMatchObject({ decommissioned: true });

    // Confirm complete DB wipe + decommissionHook in-memory cleanup
    await w1.transactions.run(async (manager) => {
      expect(await manager.count(ClusterPeerKeyEntity)).toBe(0);
      expect(await manager.count(ClusterSyncStateEntity)).toBe(0);
      expect(await manager.count(ClusterWorkloadEntity)).toBe(0);
      expect(await manager.count(ClusterTransferEntity)).toBe(0);
      expect(await manager.count(HomeKitIdentityEntity)).toBe(0);
      expect(await manager.count(ClusterNodeEntity, { where: { id: Not(w1.hubId) } })).toBe(0);
      expect(
        await manager.count(StandaloneHomeEntryEntity, {
          where: {
            kind: In([
              'tuya_credentials',
              'ha_app_credential',
              'ha_entry_runtime',
              'network_credentials',
              'homekit_pairing',
            ]),
          },
        }),
      ).toBe(0);
    });
    expect(w1.clusterService.status().nodes.some((n) => n.id === coord.hubId)).toBe(false);
    expect(w1.stateStore.getStateSync().role).toBe('standalone');
  });
});
