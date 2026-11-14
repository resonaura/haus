/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { AesGcmCredentialCipher } from '../../src/commissioning/credentials.service.js';
import { sendSignedPeerRequest } from '../../src/cluster/crypto/transport.js';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import {
  createLiveClusterNode,
  pairAndJoinPeer,
  type LiveTestClusterNode,
} from './harness.js';

describe('Cluster split-brain reconciliation, Ed25519 fencing proof & credential preservation', () => {
  const nodes: LiveTestClusterNode[] = [];
  afterEach(async () => {
    for (const node of nodes.splice(0)) {
      await node.close();
    }
  });

  it('converges dual-coordinator & dual-active workloads over HTTP, stops losing copy, and preserves newer credentials', async () => {
    const hubA = await createLiveClusterNode({ hubId: 'hub-a', role: 'coordinator' });
    const hubB = await createLiveClusterNode({
      hubId: 'hub-b',
      role: 'node',
      homeId: hubA.homeId,
    });
    nodes.push(hubA, hubB);
    await pairAndJoinPeer({ coordinator: hubA, secondary: hubB });

    // Dual-active tracking flags simulating two hardware hubs both running conflicting workloads
    let runningCamA = true;
    let runningCamB = true;
    let runningZigbeeA = true;
    let runningZigbeeB = true;

    hubA.leases.registerWorkloadController('app:cam-bridge', {
      kind: 'app',
      name: 'Camera Bridge',
      async startLocal() {
        runningCamA = true;
      },
      async stopLocal() {
        runningCamA = false;
      },
      getLocalStatus() {
        return runningCamA ? 'running' : 'stopped';
      },
    });
    hubB.leases.registerWorkloadController('app:cam-bridge', {
      kind: 'app',
      name: 'Camera Bridge',
      async startLocal() {
        runningCamB = true;
      },
      async stopLocal() {
        runningCamB = false;
      },
      getLocalStatus() {
        return runningCamB ? 'running' : 'stopped';
      },
    });

    hubA.leases.registerWorkloadController('integration:zigbee', {
      kind: 'integration',
      name: 'Zigbee Radio',
      async startLocal() {
        runningZigbeeA = true;
      },
      async stopLocal() {
        runningZigbeeA = false;
      },
      getLocalStatus() {
        return runningZigbeeA ? 'running' : 'stopped';
      },
    });
    hubB.leases.registerWorkloadController('integration:zigbee', {
      kind: 'integration',
      name: 'Zigbee Radio',
      async startLocal() {
        runningZigbeeB = true;
      },
      async stopLocal() {
        runningZigbeeB = false;
      },
      getLocalStatus() {
        return runningZigbeeB ? 'running' : 'stopped';
      },
    });

    // Simulate partition split-brain:
    // - hubB promoted itself to coordinator at epoch 3 and claims app:cam-bridge (epoch 3, gen 2)
    // - hubA still runs at coordinator epoch 1, running app:cam-bridge at epoch 1 (loses),
    //   AND holds winning integration:zigbee at workload epoch 4, gen 5 (wins over hubB's epoch 3/gen 1)
    //   while hubB holds newer credentialRevision=8 and an updated encrypted Tuya secret.
    await hubB.stateStore.saveState({
      role: 'coordinator',
      coordinatorId: 'hub-b',
      coordinatorEpoch: 3,
      fenced: false,
    });

    const now = Date.now();
    await hubA.stateStore.saveWorkload({
      workloadId: 'app:cam-bridge',
      kind: 'app',
      name: 'Camera Bridge',
      ownerHubId: 'hub-a',
      standbyHubIdsJson: JSON.stringify(['hub-b']),
      generation: 1,
      epoch: 1,
      state: 'active',
      leaseExpiresAt: now + 60_000,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: null,
      updatedAt: now,
    });
    await hubB.stateStore.saveWorkload({
      workloadId: 'app:cam-bridge',
      kind: 'app',
      name: 'Camera Bridge',
      ownerHubId: 'hub-b',
      standbyHubIdsJson: JSON.stringify(['hub-a']),
      generation: 2,
      epoch: 3,
      state: 'active',
      leaseExpiresAt: now + 60_000,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: null,
      updatedAt: now,
    });

    await hubA.stateStore.saveWorkload({
      workloadId: 'integration:zigbee',
      kind: 'integration',
      name: 'Zigbee Radio',
      ownerHubId: 'hub-a',
      standbyHubIdsJson: JSON.stringify(['hub-b']),
      generation: 5,
      epoch: 4,
      state: 'active',
      leaseExpiresAt: now + 60_000,
      configRevision: 1,
      credentialRevision: 2,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: null,
      updatedAt: now,
    });
    await hubB.stateStore.saveWorkload({
      workloadId: 'integration:zigbee',
      kind: 'integration',
      name: 'Zigbee Radio',
      ownerHubId: 'hub-b',
      standbyHubIdsJson: JSON.stringify(['hub-a']),
      generation: 1,
      epoch: 3,
      state: 'active',
      leaseExpiresAt: now + 60_000,
      configRevision: 1,
      credentialRevision: 8,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: null,
      updatedAt: now,
    });

    // Seed updated secret under hubB's own master key so hubA pulls & re-seals under hubA's key
    const cipherB = new AesGcmCredentialCipher(undefined, { dataDir: hubB.dir });
    const sealedOnB = await cipherB.encrypt(
      Buffer.from(
        JSON.stringify({ token: 'rotated-secret-from-partition-b', revision: 8 }),
        'utf8',
      ),
    );
    await hubB.transactions.run((manager) =>
      manager.upsert(
        StandaloneHomeEntryEntity,
        {
          kind: 'tuya_credentials',
          entryId: 'partition-entry',
          value: JSON.stringify({ encrypted: sealedOnB }),
          updatedAt: Date.now(),
        },
        ['kind', 'entryId'],
      ),
    );

    // Invoke POST /api/cluster/reconcile on hubA
    const recRes = await fetch(`${hubA.url}/api/cluster/reconcile`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hubA.apiToken}` },
    });
    expect(recRes.status).toBe(200);
    const outcome = (await recRes.json()) as {
      converged: boolean;
      dualCoordinatorResolved: boolean;
      winningCoordinatorId: string;
      winningEpoch: number;
      conflictsDetected: number;
      resolvedConflicts: Array<{
        workloadId: string;
        winnerHubId: string;
        fencedHubIds: string[];
        newerCredentialSourceHubId?: string;
      }>;
    };

    expect(outcome.converged).toBe(true);
    expect(outcome.dualCoordinatorResolved).toBe(true);
    expect(outcome.winningCoordinatorId).toBe('hub-b');
    expect(outcome.winningEpoch).toBe(3);
    expect(outcome.conflictsDetected).toBe(2);

    // Dual-coordinator split-brain yielded hubA to role=node at winning epoch 3
    expect(hubA.stateStore.getStateSync().role).toBe('node');
    expect(hubA.stateStore.getStateSync().coordinatorId).toBe('hub-b');
    expect(hubA.stateStore.getStateSync().coordinatorEpoch).toBe(3);

    // Strictly ONE active copy survives per workload after reconciliation
    expect(runningCamA).toBe(false);
    expect(runningCamB).toBe(true);
    expect(runningZigbeeA).toBe(true);
    expect(runningZigbeeB).toBe(false);

    // Higher credential revision on fenced hubB was preserved & pulled E2EE onto winning hubA
    const zigbeeConflict = outcome.resolvedConflicts.find(
      (c) => c.workloadId === 'integration:zigbee',
    );
    expect(zigbeeConflict?.winnerHubId).toBe('hub-a');
    expect(zigbeeConflict?.fencedHubIds).toEqual(['hub-b']);
    expect(zigbeeConflict?.newerCredentialSourceHubId).toBe('hub-b');
    expect(hubA.stateStore.getWorkloadSync('integration:zigbee')?.credentialRevision).toBe(8);

    const syncedEntry = await hubA.transactions.run((manager) =>
      manager.findOneBy(StandaloneHomeEntryEntity, {
        kind: 'tuya_credentials',
        entryId: 'partition-entry',
      }),
    );
    expect(syncedEntry).toBeTruthy();
    const parsedSynced = JSON.parse(syncedEntry!.value) as { encrypted: string };
    const cipherA = new AesGcmCredentialCipher(undefined, { dataDir: hubA.dir });
    const decryptedOnA = JSON.parse(
      Buffer.from(await cipherA.decrypt(parsedSynced.encrypted)).toString('utf8'),
    ) as { token: string };
    expect(decryptedOnA.token).toBe('rotated-secret-from-partition-b');
    await expect(cipherB.decrypt(parsedSynced.encrypted)).rejects.toThrow();
  });

  it('rejects unauthenticated and forged Ed25519 SignedFencingProof requests on peer fence endpoints', async () => {
    const hubA = await createLiveClusterNode({ hubId: 'hub-sec-a', role: 'coordinator' });
    const hubB = await createLiveClusterNode({
      hubId: 'hub-sec-b',
      role: 'node',
      homeId: hubA.homeId,
    });
    nodes.push(hubA, hubB);
    await pairAndJoinPeer({ coordinator: hubA, secondary: hubB });

    // 1. Direct unauthenticated call is rejected (403 Forbidden)
    const unauth = await fetch(`${hubB.url}/api/cluster/peer/fence-workload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workloadId: 'app:sonos' }),
    });
    expect(unauth.status).toBe(403);

    // 2. Peer-authenticated HTTP envelope carrying tampered Ed25519 SignedFencingProof fails 403
    const proof = hubA.leases.createSignedFencingProof({
      resourceId: 'app:sonos',
      priorOwnerHubId: 'hub-sec-b',
      newOwnerHubId: 'hub-sec-a',
      fencedGeneration: 1,
      epoch: 1,
    });
    const forgedProof = {
      ...proof,
      signature: Buffer.from('forged-ed25519-signature').toString('base64'),
    };
    const trust = hubA.stateStore.getPeerTrustRecord('hub-sec-b')!;
    const identityA = hubA.stateStore.getIdentitySync('hub-sec-a');

    await expect(
      sendSignedPeerRequest({
        identity: identityA,
        homeId: hubA.homeId,
        targetHubId: 'hub-sec-b',
        targetUrl: hubB.url,
        allowHttp: true,
        channelSecret: trust.channelSecret,
        method: 'POST',
        path: '/api/cluster/peer/fence-workload',
        body: {
          workloadId: 'app:sonos',
          winnerHubId: 'hub-sec-a',
          proof: forgedProof,
        },
      }),
    ).rejects.toThrow(/invalid_fencing_proof/);
  });

  it('converges 3-hub peer split-brain on coordinator & winner, blocks equal-gen peer overwrites, and restores homeId on restart', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-coord', role: 'coordinator' });
    const peerB = await createLiveClusterNode({
      hubId: 'hub-peer-b',
      role: 'node',
      homeId: coord.homeId,
    });
    const peerC = await createLiveClusterNode({
      hubId: 'hub-peer-c',
      role: 'node',
      homeId: coord.homeId,
      keepDirOnClose: true,
    });
    nodes.push(coord, peerB, peerC);
    await pairAndJoinPeer({ coordinator: coord, secondary: peerB });
    await pairAndJoinPeer({ coordinator: coord, secondary: peerC });

    const now = Date.now();
    await coord.stateStore.saveWorkload({
      workloadId: 'app:cam-shared',
      kind: 'app',
      name: 'Shared Camera',
      ownerHubId: 'hub-peer-b',
      standbyHubIdsJson: JSON.stringify(['hub-coord', 'hub-peer-c']),
      generation: 4,
      epoch: 1,
      state: 'active',
      leaseExpiresAt: now + 60_000,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: 'hub-peer-b',
      updatedAt: now,
    });
    await coord.syncService.syncPeer('hub-peer-b', { force: true });
    await coord.syncService.syncPeer('hub-peer-c', { force: true });

    // Simulate partitioned peerC claiming active ownership at equal generation (gen=4)
    const rowOnC = peerC.stateStore.getWorkloadSync('app:cam-shared')!;
    await peerC.stateStore.saveWorkload({
      ...rowOnC,
      ownerHubId: 'hub-peer-c',
      state: 'active',
      updatedAt: Date.now(),
    });

    // Non-coordinator sync push at equal (epoch, generation) must NOT overwrite coordinator's owner
    await peerC.syncService.syncPeer('hub-coord', { force: true });
    expect(coord.stateStore.getWorkloadSync('app:cam-shared')?.ownerHubId).toBe('hub-peer-b');

    // Coordinator reconciles peerB vs peerC conflict, saves winner=peerB@gen5, fences peerC, and syncs winner peerB
    const recRes = await fetch(`${coord.url}/api/cluster/reconcile`, {
      method: 'POST',
      headers: { authorization: `Bearer ${coord.apiToken}` },
    });
    expect(recRes.status).toBe(200);
    const outcome = (await recRes.json()) as {
      resolvedConflicts: Array<{ workloadId: string; winnerHubId: string; fencedHubIds: string[] }>;
    };
    const conflict = outcome.resolvedConflicts.find((c) => c.workloadId === 'app:cam-shared');
    expect(conflict).toMatchObject({
      workloadId: 'app:cam-shared',
      winnerHubId: 'hub-peer-b',
      fencedHubIds: ['hub-peer-c'],
    });

    expect(coord.stateStore.getWorkloadSync('app:cam-shared')).toMatchObject({
      ownerHubId: 'hub-peer-b',
      generation: 5,
    });
    expect(peerB.stateStore.getWorkloadSync('app:cam-shared')).toMatchObject({
      ownerHubId: 'hub-peer-b',
      generation: 5,
    });
    expect(peerC.stateStore.getWorkloadSync('app:cam-shared')).toMatchObject({
      ownerHubId: 'hub-peer-b',
      generation: 5,
    });

    // Restarting joined peerC with stale bootstrap homeId must sync authService homeId to cluster_state.homeId
    const staleRestartHomeId = 'home-stale-bootstrap';
    await peerC.stateStore.saveState({ homeId: coord.homeId });
    await peerC.close();
    const restartedPeerC = await createLiveClusterNode({
      hubId: 'hub-peer-c',
      role: 'node',
      homeId: staleRestartHomeId,
      dataDir: peerC.dir,
    });
    nodes.push(restartedPeerC);
    expect(restartedPeerC.authService.getIdentity().homeId).toBe(coord.homeId);
  });
});
