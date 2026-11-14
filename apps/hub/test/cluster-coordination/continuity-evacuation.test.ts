/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Apps } from '@haus/apps';
import type { InstalledAppEntry } from '../../src/home/app-driver.js';
import {
  EventArchiveEntity,
  EventArchiveLocationEntity,
  RecordingEventEntity,
} from '../../src/events/recording.entities.js';
import { HomeClusterCoordinator } from '../../src/home/cluster-apps.js';
import { MATTER_WORKLOAD_ID } from '../../src/matter/cluster.js';
import { MatterService } from '../../src/matter/service.js';
import { ClusterLocationEntity } from '../../src/storage/entities/domains.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';
import {
  createLiveClusterNode,
  pairAndJoinPeer,
  type LiveTestClusterNode,
} from './harness.js';

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Partition leases, app auto-start, session continuity, native NVR evacuation & Matter single-active', () => {
  const nodes: LiveTestClusterNode[] = [];
  const servers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const closeServer of servers.splice(0)) {
      await closeServer().catch(() => undefined);
    }
    for (const node of nodes.splice(0)) {
      await node.close();
    }
  });

  it('prevents secondary lease self-extension across partition, extends online leases on coordinator, and auto-starts transferred apps', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-lease-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({
      hubId: 'hub-lease-worker',
      role: 'node',
      homeId: coord.homeId,
    });
    nodes.push(coord, worker);
    await pairAndJoinPeer({ coordinator: coord, secondary: worker });

    const events: string[] = [];
    let workerRunning = true;
    worker.leases.registerWorkloadController('app:lease-test', {
      kind: 'app',
      name: 'Lease App',
      async startLocal() {
        workerRunning = true;
        events.push('worker:start');
      },
      async stopLocal(reason) {
        workerRunning = false;
        events.push(`worker:stop:${reason}`);
      },
      getLocalStatus() {
        return workerRunning ? 'running' : 'stopped';
      },
    });

    const now = Date.now();
    const initialExpiry = now + 5_000;
    const workloadRow = {
      workloadId: 'app:lease-test',
      kind: 'app' as const,
      name: 'Lease App',
      ownerHubId: worker.hubId,
      standbyHubIdsJson: JSON.stringify([coord.hubId]),
      generation: 1,
      epoch: 1,
      state: 'active' as const,
      leaseExpiresAt: initialExpiry,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: '{}',
      preferredHubId: null,
      updatedAt: now,
    };
    await coord.stateStore.saveWorkload(workloadRow);
    await worker.stateStore.saveWorkload(workloadRow);

    // Coordinator renews leases for online peers
    const renewed = await coord.leases.renewLocalLeases(now, new Set([worker.hubId]));
    expect(renewed.renewedPeerLeases).toBe(true);
    expect(coord.stateStore.getWorkloadSync('app:lease-test')!.leaseExpiresAt).toBeGreaterThan(
      initialExpiry,
    );

    // Partitioned secondary node cannot extend its own expired lease and stops its controller
    const expiredNow = initialExpiry + 10_000;
    const secRenew = await worker.leases.renewLocalLeases(expiredNow);
    expect(secRenew.renewedPeerLeases).toBe(false);
    expect(worker.stateStore.getWorkloadSync('app:lease-test')?.leaseExpiresAt).toBe(initialExpiry);
    expect(workerRunning).toBe(false);
    expect(events).toContain('worker:stop:lease_expired');

    // HomeClusterCoordinator auto-starts a newly transferred/synced stopped app when lease is active locally
    const appId = 'auto-start-app';
    const appWorkloadId = `app:${appId}`;
    const appRow = {
      ...workloadRow,
      workloadId: appWorkloadId,
      name: 'Auto Start App',
      leaseExpiresAt: Date.now() + 60_000,
    };
    await worker.stateStore.saveWorkload(appRow);

    const installedApps = new Map<string, InstalledAppEntry>([
      [
        appId,
        {
          manifest: {
            id: appId,
            name: 'Auto Start App',
            version: '1.0.0',
            image: 'ghcr.io/haus/auto-start:1.0.0',
            architectures: ['amd64'],
          },
          grantedPermissions: [],
          state: 'stopped',
          logs: [],
          config: {},
        },
      ],
    ]);
    const startLocalApp = vi.fn(async (targetId: string) => {
      const entry = installedApps.get(targetId);
      if (entry) entry.state = 'running';
    });
    const stopLocalApp = vi.fn(async (targetId: string) => {
      const entry = installedApps.get(targetId);
      if (entry) entry.state = 'stopped';
    });
    const fakeApps: Pick<Apps, 'list' | 'execute'> = {
      list: async () => ({ apps: [], drivers: [] }),
      execute: async () => undefined,
    };
    const homeCoord = new HomeClusterCoordinator(worker.leases, worker.syncService, worker.orchestrator);
    try {
      homeCoord.attachBindings({
        installedApps,
        apps: fakeApps as Apps,
        persistence: new StandaloneHomePersistence(worker.transactions),
        operateLocalApp: async () => ({ status: 'ok' }),
        reloadHomeSnapshot: async () => undefined,
        startLocalApp,
        stopLocalApp,
      });

      await worker.syncService.notifySnapshotApplied();
      expect(startLocalApp).toHaveBeenCalledWith(appId);
      expect(installedApps.get(appId)?.state).toBe('running');
    } finally {
      homeCoord.dispose();
    }
  });

  it('preserves client bearer sessions without target reboot across E2EE failover sync & coordinator transfer', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-sess-coord', role: 'coordinator' });
    const standby = await createLiveClusterNode({
      hubId: 'hub-sess-standby',
      role: 'node',
      homeId: coord.homeId,
    });
    nodes.push(coord, standby);

    const issueSessionToken = async (clientId: string): Promise<string> => {
      const ch = coord.authService.openChallenge(undefined, {
        sessionId: `adm-${clientId}`,
        hubId: coord.hubId,
        homeId: coord.homeId,
        clientId: 'admin',
        clientRole: 'admin',
        clientName: 'Admin',
        token: coord.apiToken,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        revoked: false,
      });
      const grant = coord.authService.confirmChallenge({
        sessionId: ch.sessionId,
        challengeCode: ch.challengeCode!,
        client: { clientId, clientName: clientId, role: 'admin' },
        expectedHomeId: coord.homeId,
      });
      const res = await fetch(`${coord.url}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { credentials: { sessionToken: string } };
      return body.credentials.sessionToken;
    };

    // Issue token1 BEFORE standby joins cluster so standby initially rejects it (401)
    const token1 = await issueSessionToken('client-continuity-1');
    const preJoinRooms = await fetch(`${standby.url}/api/rooms`, {
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(preJoinRooms.status).toBe(401);

    await pairAndJoinPeer({ coordinator: coord, secondary: standby });

    // Explicit sync pushes token1 -> works immediately on standby without rebooting!
    await coord.syncService.syncPeer(standby.hubId, { force: true });
    const postSyncRooms = await fetch(`${standby.url}/api/rooms`, {
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(postSyncRooms.status).toBe(200);

    // Pair another client AFTER join (auto-propagated via onSessionChange) & perform planned Coordinator Transfer
    const token2 = await issueSessionToken('client-continuity-2');
    const intent = await coord.transferManager.initiate({
      targetHubId: standby.hubId,
      preservePairing: true,
    });
    await coord.transferManager.prepare(intent.transferId);
    await coord.transferManager.fence(intent.transferId);
    await coord.transferManager.commit(intent.transferId);

    expect(standby.stateStore.getStateSync().role).toBe('coordinator');
    const [res1, res2] = await Promise.all([
      fetch(`${standby.url}/api/rooms`, { headers: { authorization: `Bearer ${token1}` } }),
      fetch(`${standby.url}/api/rooms`, { headers: { authorization: `Bearer ${token2}` } }),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('evacuates native EventArchiveEntity .mp4 and .playback.mp4 NVR clips on drain without nested transaction deadlocks', async () => {
    const coord = await createLiveClusterNode({ hubId: 'hub-evac-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({
      hubId: 'hub-evac-worker',
      role: 'node',
      homeId: coord.homeId,
    });
    nodes.push(coord, worker);
    await pairAndJoinPeer({ coordinator: coord, secondary: worker });

    const origBytes = Buffer.from('native-nvr-original-mp4-stream-bytes-1234');
    const playBytes = Buffer.from('native-nvr-playback-mp4-stream-bytes-5678');
    const origDigest = sha256(origBytes);
    const playDigest = sha256(playBytes);
    const eventId = 'evt-native-arch-1';

    await mkdir(join(worker.dir, 'media'), { recursive: true });
    await writeFile(join(worker.dir, 'media', `${eventId}.mp4`), origBytes);
    await writeFile(join(worker.dir, 'media', `${eventId}.playback.mp4`), playBytes);

    const now = Date.now();
    await coord.transactions.run(async (manager) => {
      await manager.insert(RecordingEventEntity, {
        id: eventId,
        cameraId: 'cam-front',
        startAt: now - 5000,
        endAt: now,
        status: 'complete',
        kinds: JSON.stringify(['motion']),
        detections: JSON.stringify([{ kind: 'motion', at: now - 5000 }]),
        localOriginal: false,
        localPlayback: false,
      });
      for (const spec of [
        { variant: 'original', digest: origDigest, bytes: origBytes.length },
        { variant: 'prepared', digest: playDigest, bytes: playBytes.length },
      ]) {
        await manager.upsert(
          EventArchiveEntity,
          { eventId, variant: spec.variant, digest: spec.digest, bytes: spec.bytes, version: 1 },
          ['eventId', 'variant'],
        );
        await manager.upsert(
          EventArchiveLocationEntity,
          {
            eventId,
            variant: spec.variant,
            nodeId: worker.hubId,
            digest: spec.digest,
            bytes: spec.bytes,
            version: 1,
            verifiedAt: now,
          },
          ['eventId', 'variant', 'nodeId'],
        );
        await manager.upsert(
          ClusterLocationEntity,
          {
            digest: spec.digest,
            nodeId: worker.hubId,
            kind: 'media',
            catalogVersion: 1,
            metadataHash: spec.digest,
          },
          ['digest', 'nodeId'],
        );
      }
    });

    const plan = await coord.drainService.inspectDrainPlan(worker.hubId);
    expect(plan.soleCopyMediaDigests).toContain(origDigest);
    expect(plan.soleCopyMediaDigests).toContain(playDigest);

    const drained = await coord.drainService.drainNode(worker.hubId, {
      targetHubId: coord.hubId,
    });
    expect(drained.drained).toBe(true);
    expect(drained.evacuatedMediaCount).toBe(2);

    const evacuatedOrig = await readFile(join(coord.dir, 'media', `${eventId}.mp4`));
    const evacuatedPlay = await readFile(join(coord.dir, 'media', `${eventId}.playback.mp4`));
    expect(sha256(evacuatedOrig)).toBe(origDigest);
    expect(sha256(evacuatedPlay)).toBe(playDigest);

    await coord.transactions.run(async (manager) => {
      const ev = await manager.findOneBy(RecordingEventEntity, { id: eventId });
      expect(ev?.localOriginal).toBe(true);
      expect(ev?.localPlayback).toBe(true);
      const remainingWorkerLocs = await manager.count(EventArchiveLocationEntity, {
        where: { eventId, nodeId: worker.hubId },
      });
      expect(remainingWorkerLocs).toBe(0);
      const survivingCoordLocs = await manager.count(EventArchiveLocationEntity, {
        where: { eventId, nodeId: coord.hubId },
      });
      expect(survivingCoordLocs).toBe(2);
    });
  });

  it('registers MatterService with single-active lease and keeps transport standby unless locally owned', async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    let wsConnections = 0;
    wss.on('connection', (ws) => {
      wsConnections += 1;
      ws.send(JSON.stringify({ sdk_version: 'matter.js/0.18.0' }));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { message_id?: string };
        ws.send(JSON.stringify({ message_id: msg.message_id, result: [] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(
      () =>
        new Promise<void>((resolve) => {
          wss.close();
          server.close(() => resolve());
        }),
    );

    const port = (server.address() as AddressInfo).port;
    vi.stubEnv('HAUS_MATTER_URL', `ws://127.0.0.1:${port}/ws`);

    const coord = await createLiveClusterNode({ hubId: 'hub-mt-coord', role: 'coordinator' });
    const worker = await createLiveClusterNode({
      hubId: 'hub-mt-worker',
      role: 'node',
      homeId: coord.homeId,
    });
    nodes.push(coord, worker);
    await pairAndJoinPeer({ coordinator: coord, secondary: worker });

    // Lease owned by coord -> worker must remain standby and NOT open a Matter WS connection
    await worker.stateStore.saveWorkload({
      workloadId: MATTER_WORKLOAD_ID,
      kind: 'integration',
      name: 'Matter Controller',
      ownerHubId: coord.hubId,
      standbyHubIdsJson: JSON.stringify([worker.hubId]),
      generation: 2,
      epoch: 1,
      state: 'active',
      leaseExpiresAt: Date.now() + 60_000,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: JSON.stringify({ requiredRadio: 'matter' }),
      preferredHubId: null,
      updatedAt: Date.now(),
    });

    const matterService = new MatterService(worker.homeService, undefined, worker.leases);
    await matterService.onApplicationBootstrap();
    try {
      expect(wsConnections).toBe(0);
      expect(matterService.isRunning).toBe(false);
      expect(wss.clients.size).toBe(0);
      expect(
        worker.leases.listDecodedWorkloads().some((w) => w.workloadId === MATTER_WORKLOAD_ID),
      ).toBe(true);

      // Transfer active Matter ownership to worker and reconcile controllers -> connects!
      await worker.stateStore.saveWorkload({
        ...worker.stateStore.getWorkloadSync(MATTER_WORKLOAD_ID)!,
        ownerHubId: worker.hubId,
        generation: 3,
        leaseExpiresAt: Date.now() + 60_000,
      });
      await worker.leases.reconcileLocalControllers();
      expect(wsConnections).toBe(1);
      expect(matterService.isRunning).toBe(true);
      expect(wss.clients.size).toBe(1);

      // Re-assign lease away -> reconcileLocalControllers closes Matter transport cleanly!
      await worker.stateStore.saveWorkload({
        ...worker.stateStore.getWorkloadSync(MATTER_WORKLOAD_ID)!,
        ownerHubId: coord.hubId,
        generation: 4,
      });
      await worker.leases.reconcileLocalControllers();
      expect(matterService.isRunning).toBe(false);
    } finally {
      await matterService.onApplicationShutdown();
    }
  });
});
