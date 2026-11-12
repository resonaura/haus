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
import { CLUSTER_TRANSFER_MANAGER, ClusterTransferManager } from '../../src/cluster/transfer.js';
import type {
  ClusterStatusResponseDto,
  JoinClusterResponseDto,
} from '../../src/cluster/cluster.dto.js';
import type {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
} from '../../src/cluster/transfer.dto.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../../src/home/home.service.js';
import { HomeKitIdentityEntity, BackupEntity, ClusterLocationEntity } from '../../src/storage/entities/domains.js';
import { CATALOG_TRANSACTIONS } from '../../src/storage/storage.module.js';
import type { Transactions } from '../../src/storage/transactions.js';

describe('Deliberate & Recoverable Hub-to-Hub Transfer (P19.3)', () => {
  let sourceDir: string | undefined;
  let targetDir: string | undefined;

  afterEach(async () => {
    if (sourceDir) {
      await rm(sourceDir, { recursive: true, force: true });
      sourceDir = undefined;
    }
    if (targetDir) {
      await rm(targetDir, { recursive: true, force: true });
      targetDir = undefined;
    }
  });

  it('executes deliberate Hub-to-Hub transfer with fencing, pairing preservation, archive continuity, and rollback', async () => {
    sourceDir = await mkdtemp(join(tmpdir(), 'haus-transfer-source-'));
    targetDir = await mkdtemp(join(tmpdir(), 'haus-transfer-target-'));

    // --- Boot Source Coordinator Hub ---
    const sourceApp = await createNestApp({ dataDirectory: sourceDir });
    await sourceApp.listen(0, '127.0.0.1');
    const sourcePort = (sourceApp.getHttpServer().address() as AddressInfo).port;
    const sourceBase = `http://127.0.0.1:${sourcePort}`;
    const sourceAuth = sourceApp.get<HubAuthService>(HUB_AUTH_SERVICE);
    const sourceHome = sourceApp.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
    const sourceTransactions = sourceApp.get<Transactions>(CATALOG_TRANSACTIONS);

    const coordinatorHubId = sourceAuth.getIdentity().hubId;
    const homeId = sourceAuth.getIdentity().homeId;

    // --- Boot Target Secondary Hub ---
    const targetApp = await createNestApp({ dataDirectory: targetDir, hubId: 'hub-upstairs-02' });
    await targetApp.listen(0, '127.0.0.1');
    const targetPort = (targetApp.getHttpServer().address() as AddressInfo).port;
    const targetManager = targetApp.get<ClusterTransferManager>(CLUSTER_TRANSFER_MANAGER);
    const secondaryHubId = 'hub-upstairs-02';

    try {
      // 1. Initial admin onboarding on Source Hub
      const cRes = await fetch(`${sourceBase}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const c = (await cRes.json()) as { sessionId: string };
      const code = sourceAuth.pairing.getSession(c.sessionId)!.challengeCode;
      const conf = await (
        await fetch(`${sourceBase}/api/auth/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: c.sessionId,
            challengeCode: code,
            client: { clientId: 'admin-client', clientName: 'Admin', role: 'admin' },
          }),
        })
      ).json();
      const pair = await (
        await fetch(`${sourceBase}/api/auth/pair`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant: conf.grant }),
        })
      ).json();
      const adminToken = pair.credentials.sessionToken;
      const adminHeaders = {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      };

      // 2. Populate Source Hub state: preferences, devices, scenes, automations, HomeKit, archives
      await fetch(`${sourceBase}/api/preferences`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ homeName: 'The Solarium' }),
      });

      sourceHome.registerDevice({
        id: 'dev-light-living',
        name: 'Living Room Light',
        category: 'lighting',
        availability: 'online',
        source: { instanceId: 'standalone', externalId: 'dev-light-living' },
        connectivity: { protocol: 'virtual' },
        endpoints: [
          {
            id: 'ep-light-1',
            name: 'Power',
            capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['set'] }],
            readings: {},
          },
        ],
      });
      await sourceHome.updateEndpointState('ep-light-1', { on: true, brightness: 85 });

      sourceHome.registerScene({
        id: 'scene-evening',
        name: 'Evening Chill',
        schemaVersion: 1,
        members: [{ endpointId: 'ep-light-1', targetState: { on: true, brightness: 50 } }],
      });

      sourceHome.registerAutomation({
        id: 'rule-motion',
        name: 'Motion Lights',
        schemaVersion: 1,
        enabled: true,
        triggers: [{ type: 'state', endpointId: 'ep-light-1', property: 'on', to: true }],
        actions: [{ type: 'action', action: { kind: 'device_command', payload: { endpointId: 'ep-light-1', capability: 'on_off', command: 'set', parameters: { on: true } } } }],
      });

      // Populate HomeKit identity and NVR recording archive
      const testArchiveDigest = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      await sourceTransactions.run(async (manager) => {
        await manager.upsert(
          HomeKitIdentityEntity,
          { cameraId: 'cam-outdoor-01', value: JSON.stringify({ bridgeId: 'hk-bridge-solarium', setupId: 'HAUS', pin: '031-45-154' }) },
          ['cameraId'],
        );
        await manager.upsert(
          BackupEntity,
          { digest: testArchiveDigest, kind: 'media', createdAt: Date.now(), bytes: 2048576, haSlug: null, archiveGeneration: 1 },
          ['digest'],
        );
        await manager.upsert(
          ClusterLocationEntity,
          { digest: testArchiveDigest, nodeId: coordinatorHubId, kind: 'media', catalogVersion: 1, metadataHash: 'meta-hash-1' },
          ['digest', 'nodeId'],
        );
      });

      // 3. Secondary Hub joins cluster as secondary node
      const nodeChallenge = sourceAuth.openChallenge(undefined, {
        sessionId: 'admin-sess',
        hubId: coordinatorHubId,
        homeId,
        clientId: 'admin-client',
        clientRole: 'admin',
        clientName: 'Admin',
        token: 'admin-tok',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        revoked: false,
      });
      const nodeGrant = sourceAuth.confirmChallenge({
        sessionId: nodeChallenge.sessionId,
        challengeCode: nodeChallenge.challengeCode!,
        client: { clientId: secondaryHubId, clientName: 'Secondary Hub', role: 'node' },
        expectedHomeId: homeId,
      });

      const joinRes = await fetch(`${sourceBase}/api/cluster/join`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          hubId: secondaryHubId,
          name: 'Secondary Hub',
          url: `http://127.0.0.1:${targetPort}`,
          homeId,
          roles: ['storage', 'stream'],
          grant: nodeGrant,
        }),
      });
      expect(joinRes.status).toBe(201);
      const joinBody = (await joinRes.json()) as JoinClusterResponseDto;
      expect(joinBody.status).toBe('joined');

      // 4. Initiate Hub-to-Hub transfer
      const initRes = await fetch(`${sourceBase}/api/cluster/transfer/initiate`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ targetHubId: secondaryHubId, preservePairing: true }),
      });
      expect(initRes.status).toBe(201);
      const transferIntent = (await initRes.json()) as HubTransferIntentDto;
      expect(transferIntent.state).toBe('initiated');
      expect(transferIntent.sourceHubId).toBe(coordinatorHubId);
      expect(transferIntent.targetHubId).toBe(secondaryHubId);
      expect(transferIntent.epoch).toBe(2);
      expect(transferIntent.summary.devicesCount).toBeGreaterThanOrEqual(1);
      expect(transferIntent.summary.scenesCount).toBe(1);
      expect(transferIntent.summary.automationsCount).toBe(1);
      expect(transferIntent.summary.preservePairing).toBe(true);

      // 5. Prepare transfer on target
      const prepRes = await fetch(`${sourceBase}/api/cluster/transfer/${transferIntent.transferId}/prepare`, {
        method: 'POST',
        headers: adminHeaders,
      });
      expect(prepRes.status).toBe(200);
      expect((await prepRes.json()).state).toBe('target_prepared');

      // 6. Fence source coordinator
      const fenceRes = await fetch(`${sourceBase}/api/cluster/transfer/${transferIntent.transferId}/fence`, {
        method: 'POST',
        headers: adminHeaders,
      });
      expect(fenceRes.status).toBe(200);
      const fencedBody = await fenceRes.json();
      expect(fencedBody.state).toBe('source_fenced');
      expect(fencedBody.fenced).toBe(true);

      // 7. Ownership Fencing Invariant: Mutating operations rejected with 403 Forbidden
      const mutationAttempt1 = await fetch(`${sourceBase}/api/devices`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ id: 'rogue-dev', name: 'Rogue Device' }),
      });
      expect(mutationAttempt1.status).toBe(403);
      expect(await mutationAttempt1.json()).toMatchObject({ error: 'coordinator_fenced' });

      const mutationAttempt2 = await fetch(`${sourceBase}/api/preferences`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ homeName: 'Hacked Name' }),
      });
      expect(mutationAttempt2.status).toBe(403);

      // Invariant: Read operations remain functional and report fenced status
      const clusterStatusRes = await fetch(`${sourceBase}/api/cluster`, { headers: adminHeaders });
      expect(clusterStatusRes.status).toBe(200);
      const clusterStatus = (await clusterStatusRes.json()) as ClusterStatusResponseDto;
      expect(clusterStatus.fenced).toBe(true);
      expect(clusterStatus.role).toBe('fenced');

      // 8. Deliberate Rollback Verification
      const rollbackRes = await fetch(`${sourceBase}/api/cluster/transfer/${transferIntent.transferId}/rollback`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ reason: 'dry_run_test_rollback' }),
      });
      expect(rollbackRes.status).toBe(200);
      const rollbackBody = (await rollbackRes.json()) as HubTransferRollbackResultDto;
      expect(rollbackBody.state).toBe('rolled_back');
      expect(rollbackBody.restoredCoordinator).toBe(coordinatorHubId);

      // After rollback, source coordinator is un-fenced and mutations work again
      const postRollbackStatus = await (await fetch(`${sourceBase}/api/cluster`, { headers: adminHeaders })).json();
      expect(postRollbackStatus.fenced).toBe(false);
      expect(postRollbackStatus.role).toBe('coordinator');

      // 9. Re-initiate and Commit Full Transfer to Secondary Hub
      const transfer2 = (await (
        await fetch(`${sourceBase}/api/cluster/transfer/initiate`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({ targetHubId: secondaryHubId, preservePairing: true }),
        })
      ).json()) as HubTransferIntentDto;

      await fetch(`${sourceBase}/api/cluster/transfer/${transfer2.transferId}/prepare`, {
        method: 'POST',
        headers: adminHeaders,
      });

      await fetch(`${sourceBase}/api/cluster/transfer/${transfer2.transferId}/fence`, {
        method: 'POST',
        headers: adminHeaders,
      });

      // Pass targetManager to commit to apply manifest to target database
      const sourceManager = sourceApp.get<ClusterTransferManager>(CLUSTER_TRANSFER_MANAGER);
      const commitResult: HubTransferCommitResultDto = await sourceManager.commit(
        transfer2.transferId,
        targetManager,
      );
      expect(commitResult.state).toBe('completed');
      expect(commitResult.newCoordinator).toBe(secondaryHubId);
      expect(commitResult.previousCoordinator).toBe(coordinatorHubId);
      expect(commitResult.epoch).toBe(2);

      // Source role is now demoted to node
      expect(sourceManager.getRole()).toBe('node');
      expect(sourceManager.isFenced()).toBe(false);

      // 10. Verify Target Hub now owns the home, preserved devices, rules, archives, and HomeKit keys
      const targetHome = targetApp.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
      await targetHome.onModuleInit(); // Reload in-memory cache from TypeORM

      const targetDevices = targetHome.listDevices();
      expect(targetDevices.some((d) => d.id === 'dev-light-living')).toBe(true);

      const targetScenes = targetHome.listScenes();
      expect(targetScenes.some((s) => s.id === 'scene-evening')).toBe(true);

      const targetAutomations = targetHome.listAutomations();
      expect(targetAutomations.some((a) => a.id === 'rule-motion')).toBe(true);

      // Verify HomeKit pairing identity preserved
      const targetTransactions = targetApp.get<Transactions>(CATALOG_TRANSACTIONS);
      const hkIdentities = await targetTransactions.run((m) => m.find(HomeKitIdentityEntity));
      expect(hkIdentities.some((hk) => hk.cameraId === 'cam-outdoor-01')).toBe(true);

      // Verify recording archives preserved
      const archives = await targetTransactions.run((m) => m.find(BackupEntity));
      expect(archives.some((b) => b.digest === testArchiveDigest)).toBe(true);
    } finally {
      await sourceApp.get(CatalogLifetime).close();
      await sourceApp.close();
      await targetApp.get(CatalogLifetime).close();
      await targetApp.close();
    }

    // --- Boot 2: Target Hub cold restart proves persistence ---
    const rebootedTargetApp = await createNestApp({ dataDirectory: targetDir, hubId: 'hub-upstairs-02' });
    await rebootedTargetApp.listen(0, '127.0.0.1');
    try {
      const rebootedTargetHome = rebootedTargetApp.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
      expect(rebootedTargetHome.listDevices().some((d) => d.id === 'dev-light-living')).toBe(true);
      expect(rebootedTargetHome.listScenes().some((s) => s.id === 'scene-evening')).toBe(true);
      expect(rebootedTargetHome.listAutomations().some((a) => a.id === 'rule-motion')).toBe(true);
    } finally {
      await rebootedTargetApp.get(CatalogLifetime).close();
      await rebootedTargetApp.close();
    }
  });
});
