/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AesGcmCredentialCipher } from '../../src/commissioning/credentials.service.js';
import {
  BackupEntity,
  ClusterLocationEntity,
  ClusterMediaEntity,
} from '../../src/storage/entities/domains.js';
import { StandaloneHomeEntryEntity } from '../../src/storage/standalone/entities.js';
import {
  createLiveClusterNode,
  pairAndJoinPeer,
  type LiveTestClusterNode,
} from './harness.js';

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Cluster drain, sole-copy NVR media/backup safety, offline guard & HTTP coordinator transfer', () => {
  const nodes: LiveTestClusterNode[] = [];
  afterEach(async () => {
    for (const node of nodes.splice(0)) {
      await node.close();
    }
  });

  it('protects sole hub & coordinator removal, evacuates sole-copy NVR media/backups before unlinking, and blocks offline loss without force', async () => {
    const hub1 = await createLiveClusterNode({ hubId: 'hub-sole', role: 'coordinator' });
    nodes.push(hub1);
    const adminHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${hub1.apiToken}`,
    };

    // Single-hub home: workload runs locally and removing the sole Hub is blocked (409)
    await hub1.leases.ensureLocalOwnership({
      workloadId: 'app:sole-app',
      kind: 'app',
      name: 'Sole App',
    });
    expect(hub1.leases.shouldRunLocally('app:sole-app')).toBe(true);

    const soleRemove = await fetch(`${hub1.url}/api/cluster/nodes/hub-sole/remove`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(soleRemove.status).toBe(409);
    expect(await soleRemove.json()).toMatchObject({ error: 'cannot_remove_sole_hub' });
    expect(hub1.leases.shouldRunLocally('app:sole-app')).toBe(true);

    // Pair secondary Hub & verify coordinator cannot remove itself directly even with force
    const hub2 = await createLiveClusterNode({
      hubId: 'hub-nvr-worker',
      role: 'node',
      homeId: hub1.homeId,
    });
    nodes.push(hub2);
    await pairAndJoinPeer({ coordinator: hub1, secondary: hub2 });

    const selfRemove = await fetch(`${hub1.url}/api/cluster/nodes/hub-sole/remove`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ force: true }),
    });
    expect(selfRemove.status).toBe(409);
    expect(await selfRemove.json()).toMatchObject({
      error: 'transfer_coordinator_before_removing_self',
    });

    // Seed sole-copy NVR media recording, sole-copy backup archive, and active workload on hub2
    const mediaBytes = Buffer.from('synthetic-mp4-nvr-clip-payload-0123456789');
    const mediaDigest = sha256(mediaBytes);
    await mkdir(join(hub2.dir, 'media'), { recursive: true });
    await writeFile(join(hub2.dir, 'media', mediaDigest), mediaBytes);

    const backupBytes = Buffer.from('encrypted-haus-backup-archive-tar-zst');
    const backupDigest = sha256(backupBytes);
    await mkdir(join(hub2.dir, 'backups'), { recursive: true });
    await writeFile(join(hub2.dir, 'backups', backupDigest), backupBytes);

    await hub1.transactions.run(async (manager) => {
      await manager.upsert(
        ClusterMediaEntity,
        { eventId: 'evt-nvr-1', digest: mediaDigest, bytes: mediaBytes.length, version: 1 },
        ['eventId'],
      );
      await manager.upsert(
        BackupEntity,
        {
          digest: backupDigest,
          kind: 'haus-full',
          createdAt: Date.now(),
          bytes: backupBytes.length,
          haSlug: null,
          archiveGeneration: 1,
        },
        ['digest'],
      );
      await manager.upsert(
        ClusterLocationEntity,
        {
          digest: mediaDigest,
          nodeId: 'hub-nvr-worker',
          kind: 'media',
          catalogVersion: 1,
          metadataHash: mediaDigest,
        },
        ['digest', 'nodeId'],
      );
      await manager.upsert(
        ClusterLocationEntity,
        {
          digest: backupDigest,
          nodeId: 'hub-nvr-worker',
          kind: 'backup',
          catalogVersion: 1,
          metadataHash: backupDigest,
        },
        ['digest', 'nodeId'],
      );
    });

    let running1 = false;
    let running2 = true;
    hub1.leases.registerWorkloadController('app:worker-camera', {
      kind: 'app',
      name: 'Worker NVR',
      async startLocal() {
        running1 = true;
      },
      async stopLocal() {
        running1 = false;
      },
      getLocalStatus() {
        return running1 ? 'running' : 'stopped';
      },
    });
    hub2.leases.registerWorkloadController('app:worker-camera', {
      kind: 'app',
      name: 'Worker NVR',
      async startLocal() {
        running2 = true;
      },
      async stopLocal() {
        running2 = false;
      },
      getLocalStatus() {
        return running2 ? 'running' : 'stopped';
      },
    });

    const now = Date.now();
    await hub1.stateStore.saveWorkload({
      workloadId: 'app:worker-camera',
      kind: 'app',
      name: 'Worker NVR',
      ownerHubId: 'hub-nvr-worker',
      standbyHubIdsJson: JSON.stringify(['hub-sole']),
      generation: 2,
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
    await hub2.stateStore.saveWorkload({
      workloadId: 'app:worker-camera',
      kind: 'app',
      name: 'Worker NVR',
      ownerHubId: 'hub-nvr-worker',
      standbyHubIdsJson: JSON.stringify(['hub-sole']),
      generation: 2,
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

    // Inspect drain plan before unlinking
    const planRes = await fetch(`${hub1.url}/api/cluster/nodes/hub-nvr-worker/drain-plan`, {
      headers: adminHeaders,
    });
    expect(planRes.status).toBe(200);
    const plan = (await planRes.json()) as {
      soleCopyMediaCount: number;
      soleCopyBackupsCount: number;
      activeWorkloadIds: string[];
      canDrainAutomatically: boolean;
    };
    expect(plan.soleCopyMediaCount).toBe(1);
    expect(plan.soleCopyBackupsCount).toBe(1);
    expect(plan.activeWorkloadIds).toContain('app:worker-camera');
    expect(plan.canDrainAutomatically).toBe(true);

    // Safe online drain + unlink evacuates media/backups with SHA-256 verification and moves workload
    const removeOk = await fetch(`${hub1.url}/api/cluster/nodes/hub-nvr-worker/remove`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ targetHubId: 'hub-sole' }),
    });
    expect(removeOk.status).toBe(200);
    expect(await removeOk.json()).toEqual({ removed: true, id: 'hub-nvr-worker' });

    const evacuatedMedia = await readFile(join(hub1.dir, 'media', mediaDigest));
    expect(sha256(evacuatedMedia)).toBe(mediaDigest);
    const evacuatedBackup = await readFile(join(hub1.dir, 'backups', backupDigest));
    expect(sha256(evacuatedBackup)).toBe(backupDigest);

    expect(running2).toBe(false);
    expect(running1).toBe(true);
    expect(hub1.leases.shouldRunLocally('app:worker-camera')).toBe(true);
    expect(hub2.stateStore.getStateSync().role).toBe('standalone');
    expect(hub1.stateStore.getPeerTrustRecord('hub-nvr-worker')?.revoked).toBe(true);

    // Offline node with un-evacuated sole-copy data + active workload blocks without force=true
    const hubDead = await createLiveClusterNode({
      hubId: 'hub-dead',
      role: 'node',
      homeId: hub1.homeId,
    });
    await pairAndJoinPeer({ coordinator: hub1, secondary: hubDead });
    const offlineDigest = sha256('unrecoverable-offline-nvr-clip');
    await hub1.transactions.run((manager) =>
      manager.upsert(
        ClusterLocationEntity,
        {
          digest: offlineDigest,
          nodeId: 'hub-dead',
          kind: 'media',
          catalogVersion: 1,
          metadataHash: offlineDigest,
        },
        ['digest', 'nodeId'],
      ),
    );
    await hubDead.close();

    const blockedRemove = await fetch(`${hub1.url}/api/cluster/nodes/hub-dead/remove`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(blockedRemove.status).toBe(409);
    expect(await blockedRemove.json()).toMatchObject({ error: 'undrained_data_requires_force' });

    const forcedRemove = await fetch(`${hub1.url}/api/cluster/nodes/hub-dead/remove`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ force: true }),
    });
    expect(forcedRemove.status).toBe(200);
    expect(await forcedRemove.json()).toEqual({ removed: true, id: 'hub-dead' });
  });

  it('executes 4-phase HTTP coordinator transfer with source fencing, E2EE credential re-sealing & epoch promotion', async () => {
    const hubSrc = await createLiveClusterNode({ hubId: 'hub-src', role: 'coordinator' });
    const hubDst = await createLiveClusterNode({
      hubId: 'hub-dst',
      role: 'node',
      homeId: hubSrc.homeId,
    });
    nodes.push(hubSrc, hubDst);
    await pairAndJoinPeer({ coordinator: hubSrc, secondary: hubDst });

    const cipherSrc = new AesGcmCredentialCipher(undefined, { dataDir: hubSrc.dir });
    const sealedCred = await cipherSrc.encrypt(
      Buffer.from(JSON.stringify({ apiKey: 'transfer-secret-xyz' }), 'utf8'),
    );
    await hubSrc.transactions.run(async (manager) => {
      await manager.upsert(
        StandaloneHomeEntryEntity,
        {
          kind: 'tuya_credentials',
          entryId: 'transfer-tuya',
          value: JSON.stringify({ encrypted: sealedCred }),
          updatedAt: Date.now(),
        },
        ['kind', 'entryId'],
      );
      await manager.upsert(
        StandaloneHomeEntryEntity,
        {
          kind: 'room',
          entryId: 'living-room',
          value: JSON.stringify({ id: 'living-room', name: 'Living Room' }),
          updatedAt: Date.now(),
        },
        ['kind', 'entryId'],
      );
    });

    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${hubSrc.apiToken}`,
    };

    const initRes = await fetch(`${hubSrc.url}/api/cluster/transfer/initiate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetHubId: 'hub-dst', preservePairing: true }),
    });
    expect(initRes.status).toBe(201);
    const intent = (await initRes.json()) as { transferId: string; epoch: number; state: string };
    expect(intent.state).toBe('initiated');
    expect(intent.epoch).toBe(2);

    const prepRes = await fetch(
      `${hubSrc.url}/api/cluster/transfer/${intent.transferId}/prepare`,
      { method: 'POST', headers },
    );
    expect(prepRes.status).toBe(200);
    expect(await prepRes.json()).toMatchObject({ state: 'target_prepared', valid: true });

    const fenceRes = await fetch(
      `${hubSrc.url}/api/cluster/transfer/${intent.transferId}/fence`,
      { method: 'POST', headers },
    );
    expect(fenceRes.status).toBe(200);
    expect(await fenceRes.json()).toMatchObject({ state: 'source_fenced', fenced: true });

    // FencingGuard rejects normal cluster/home mutations while source is fenced
    const blockedMutation = await fetch(`${hubSrc.url}/api/cluster/rebalance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ force: true }),
    });
    expect(blockedMutation.status).toBe(403);
    expect(await blockedMutation.json()).toMatchObject({ error: 'coordinator_fenced' });

    const commitRes = await fetch(
      `${hubSrc.url}/api/cluster/transfer/${intent.transferId}/commit`,
      { method: 'POST', headers },
    );
    expect(commitRes.status).toBe(200);
    expect(await commitRes.json()).toMatchObject({
      transferId: intent.transferId,
      state: 'completed',
      previousCoordinator: 'hub-src',
      newCoordinator: 'hub-dst',
      epoch: 2,
    });

    // Verify source demoted, destination promoted, and credential re-sealed under destination master key
    expect(hubSrc.stateStore.getStateSync().role).toBe('node');
    expect(hubSrc.stateStore.getStateSync().coordinatorEpoch).toBe(2);
    expect(hubSrc.stateStore.getStateSync().fenced).toBe(false);

    expect(hubDst.stateStore.getStateSync().role).toBe('coordinator');
    expect(hubDst.stateStore.getStateSync().coordinatorId).toBe('hub-dst');
    expect(hubDst.stateStore.getStateSync().coordinatorEpoch).toBe(2);

    const copiedCred = await hubDst.transactions.run((manager) =>
      manager.findOneBy(StandaloneHomeEntryEntity, {
        kind: 'tuya_credentials',
        entryId: 'transfer-tuya',
      }),
    );
    expect(copiedCred).toBeTruthy();
    const parsedCred = JSON.parse(copiedCred!.value) as { encrypted: string };
    const cipherDst = new AesGcmCredentialCipher(undefined, { dataDir: hubDst.dir });
    const plainDst = JSON.parse(
      Buffer.from(await cipherDst.decrypt(parsedCred.encrypted)).toString('utf8'),
    ) as { apiKey: string };
    expect(plainDst.apiKey).toBe('transfer-secret-xyz');
    await expect(cipherSrc.decrypt(parsedCred.encrypted)).rejects.toThrow();

    const copiedRoom = await hubDst.transactions.run((manager) =>
      manager.findOneBy(StandaloneHomeEntryEntity, { kind: 'room', entryId: 'living-room' }),
    );
    expect(copiedRoom).toBeTruthy();
  });
});
