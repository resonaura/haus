/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { type INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { AuthModule } from '../../src/auth/auth.module.js';
import { HubAuthService } from '../../src/auth/service.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import { ClusterModule } from '../../src/cluster/cluster.module.js';
import { CLUSTER_SERVICE } from '../../src/cluster/cluster.controller.js';
import { DefaultClusterService as ClusterService } from '../../src/cluster/cluster.service.js';
import { ClusterDrainService } from '../../src/cluster/drain/service.js';
import { ClusterLeaseService } from '../../src/cluster/coordination/leases.js';
import { ClusterOrchestrator } from '../../src/cluster/coordination/orchestrator.js';
import { ClusterReconciliationService } from '../../src/cluster/coordination/reconcile.js';
import { ClusterStateStore } from '../../src/cluster/coordination/state.js';
import { ClusterSyncService } from '../../src/cluster/sync/service.js';
import { CLUSTER_TRANSFER_MANAGER, ClusterTransferManager } from '../../src/cluster/transfer.js';
import { HomeModule } from '../../src/home/home.module.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../../src/home/home.service.js';
import { LiveModule } from '../../src/live/live.module.js';
import { CATALOG_SOURCE, CATALOG_TRANSACTIONS, StorageModule } from '../../src/storage/storage.module.js';
import type { Transactions } from '../../src/storage/transactions.js';
import type { DataSource } from 'typeorm';

export interface LiveTestClusterNode {
  readonly hubId: string;
  readonly homeId: string;
  readonly dir: string;
  readonly url: string;
  readonly apiToken: string;
  readonly app: INestApplication;
  readonly authService: HubAuthService;
  readonly clusterService: ClusterService;
  readonly stateStore: ClusterStateStore;
  readonly leases: ClusterLeaseService;
  readonly syncService: ClusterSyncService;
  readonly reconcileService: ClusterReconciliationService;
  readonly drainService: ClusterDrainService;
  readonly orchestrator: ClusterOrchestrator;
  readonly transferManager: ClusterTransferManager;
  readonly homeService: StandaloneHomeService;
  readonly dataSource: DataSource;
  readonly transactions: Transactions;
  close(): Promise<void>;
}

export async function createLiveClusterNode(options: {
  readonly hubId: string;
  readonly homeId?: string;
  readonly apiToken?: string;
  readonly role?: 'coordinator' | 'node';
  readonly dataDir?: string;
  readonly keepDirOnClose?: boolean;
}): Promise<LiveTestClusterNode> {
  const dir = options.dataDir ?? (await mkdtemp(join(tmpdir(), `haus-cl-${options.hubId}-`)));
  const dbPath = join(dir, 'haus.db');
  const homeId = options.homeId ?? 'home-cluster-test';
  const apiToken = options.apiToken ?? `tok-${options.hubId}-admin`;

  @Module({
    imports: [
      StorageModule.forRoot({ databasePath: dbPath }),
      LiveModule,
      AuthModule.forRoot({
        hubId: options.hubId,
        homeId,
        hubName: `Hub ${options.hubId}`,
        apiToken,
      }),
      HomeModule.forRoot(),
      ClusterModule.forRoot(),
    ],
  })
  class TestClusterNodeModule {}

  const app = await NestFactory.create(TestClusterNodeModule, {
    logger: false,
    rawBody: true,
    abortOnError: false,
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
  const clusterService = app.get<ClusterService>(CLUSTER_SERVICE);
  const stateStore = app.get(ClusterStateStore);
  const leases = app.get(ClusterLeaseService);
  const syncService = app.get(ClusterSyncService);
  const reconcileService = app.get(ClusterReconciliationService);
  const drainService = app.get(ClusterDrainService);
  const orchestrator = app.get(ClusterOrchestrator);
  const transferManager = app.get<ClusterTransferManager>(CLUSTER_TRANSFER_MANAGER);
  const homeService = app.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE);
  const dataSource = app.get<DataSource>(CATALOG_SOURCE);
  const transactions = app.get<Transactions>(CATALOG_TRANSACTIONS);

  await stateStore.ensureInitialized({
    hubId: options.hubId,
    homeId,
    hubUrl: url,
  });
  if (options.role === 'node') {
    await stateStore.saveState({ role: 'node' });
    transferManager.setRoleOverride('node');
  } else {
    await stateStore.saveState({
      role: 'coordinator',
      coordinatorId: options.hubId,
      coordinatorUrl: url,
    });
  }

  return {
    hubId: options.hubId,
    homeId,
    dir,
    url,
    apiToken,
    app,
    authService,
    clusterService,
    stateStore,
    leases,
    syncService,
    reconcileService,
    drainService,
    orchestrator,
    transferManager,
    homeService,
    dataSource,
    transactions,
    async close() {
      await app.close();
      if (!options.keepDirOnClose) {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export async function pairAndJoinPeer(params: {
  readonly coordinator: LiveTestClusterNode;
  readonly secondary: LiveTestClusterNode;
  readonly roles?: ('storage' | 'stream')[];
}): Promise<void> {
  const { coordinator, secondary } = params;
  const challenge = coordinator.authService.openChallenge(undefined, {
    sessionId: 'admin-sess',
    hubId: coordinator.hubId,
    homeId: coordinator.homeId,
    clientId: 'admin-client',
    clientRole: 'admin',
    clientName: 'Admin',
    token: coordinator.apiToken,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    revoked: false,
  });
  const grant = coordinator.authService.confirmChallenge({
    sessionId: challenge.sessionId,
    challengeCode: challenge.challengeCode!,
    client: { clientId: secondary.hubId, clientName: `Hub ${secondary.hubId}`, role: 'node' },
    expectedHomeId: coordinator.homeId,
  });

  const secIdentity = secondary.stateStore.getIdentitySync(secondary.hubId);
  const res = await fetch(`${coordinator.url}/api/cluster/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${coordinator.apiToken}`,
    },
    body: JSON.stringify({
      hubId: secondary.hubId,
      url: secondary.url,
      homeId: coordinator.homeId,
      name: `Hub ${secondary.hubId}`,
      roles: params.roles ?? ['storage', 'stream'],
      publicIdentity: secIdentity.publicIdentity(),
      grant,
    }),
  });
  if (!res.ok) {
    throw new Error(`pairAndJoinPeer failed: ${res.status} ${await res.text()}`);
  }
  const joined = (await res.json()) as {
    coordinatorHubId: string;
    coordinatorPublicIdentity: ReturnType<typeof secIdentity.publicIdentity>;
    channelSecret: string;
  };

  await secondary.stateStore.saveState({
    role: 'node',
    coordinatorId: joined.coordinatorHubId,
    coordinatorUrl: coordinator.url,
    coordinatorEpoch: coordinator.stateStore.getStateSync().coordinatorEpoch,
  });
  secondary.transferManager.setRoleOverride('node');
  secondary.transferManager.setCoordinatorIdOverride(joined.coordinatorHubId);
  await secondary.stateStore.upsertPeerTrust({
    hubId: joined.coordinatorHubId,
    homeId: coordinator.homeId,
    publicIdentity: joined.coordinatorPublicIdentity,
    channelSecret: joined.channelSecret,
  });
  await secondary.clusterService.add({
    nodeId: coordinator.hubId,
    name: `Hub ${coordinator.hubId}`,
    url: coordinator.url,
    homeId: coordinator.homeId,
    roles: ['storage', 'stream'],
  });
}
