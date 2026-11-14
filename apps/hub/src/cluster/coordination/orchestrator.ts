/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { HubCapacityMetrics } from '@haus/core/cluster';
import { ClusterCryptoIdentity } from '../crypto/identity.js';
import { sendSignedPeerRequest } from '../crypto/transport.js';
import type { ClusterPublicIdentity } from '../crypto/identity.js';
import { ClusterDrainService, type DrainNodeSummary } from '../drain/service.js';
import { ClusterSyncService } from '../sync/service.js';
import { ClusterLeaseService, type SignedFencingProof } from './leases.js';
import {
  buildClusterNodeCapacities,
  ClusterPlacementPlanner,
  type NodeCapacityInput,
} from './placement.js';
import { executeClusterRebalance, type RebalanceResult } from './rebalance.js';
import {
  ClusterReconciliationService,
  type HubClaimSnapshot,
  type ReconciliationOutcome,
} from './reconcile.js';
import { runOrchestratorMaintenanceTick, verifyAndDrainBeforeRemoveNode } from './maintenance.js';
import { ClusterStateStore } from './state.js';
import type { ClusterSecretEnvelope } from '../crypto/envelope.js';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';

export type { RebalanceResult };

interface PeerStatusResponse {
  readonly snapshot?: HubClaimSnapshot;
  readonly capacity?: HubCapacityMetrics;
  readonly publicIdentity?: ClusterPublicIdentity;
}

interface RequestSyncResponse {
  readonly envelopes?: readonly ClusterSecretEnvelope[];
  readonly workloads?: readonly ClusterWorkloadRow[];
}

export interface NodeDirectoryHooks {
  readonly listNodes: () => readonly DrainNodeSummary[];
  readonly updateNodeOnline?: (hubId: string, online: boolean) => void;
}

/**
 * Coordinates peer RPC delivery, capacity discovery, load-balanced workload placement,
 * split-brain reconciliation, and single-hub continuity across ClusterModule services.
 */
@Injectable()
export class ClusterOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterOrchestrator.name);
  private readonly planner = new ClusterPlacementPlanner();
  private readonly peerCapacities = new Map<
    string,
    { capacity: HubCapacityMetrics; isWeakHub: boolean }
  >();
  private directoryHooks?: NodeDirectoryHooks;
  private maintenanceTimer?: NodeJS.Timeout;
  private unsubscribeSnapshot?: () => void;
  private maintenanceInFlight = false;
  private destroyed = false;

  constructor(
    @Inject(ClusterStateStore) private readonly stateStore: ClusterStateStore,
    @Inject(ClusterLeaseService) private readonly leaseService: ClusterLeaseService,
    @Inject(ClusterReconciliationService)
    private readonly reconcileService: ClusterReconciliationService,
    @Inject(ClusterSyncService) private readonly syncService: ClusterSyncService,
    @Inject(ClusterDrainService) private readonly drainService: ClusterDrainService,
  ) {}

  onModuleInit(): void {
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenanceTick();
    }, 20_000);
    this.maintenanceTimer.unref();
    this.unsubscribeSnapshot = this.syncService.onSnapshotApplied(async () => {
      if (this.destroyed) return;
      await this.leaseService.reconcileLocalControllers();
    });
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = undefined;
  }

  async runMaintenanceTick(): Promise<void> {
    if (this.destroyed || this.maintenanceInFlight) return;
    this.maintenanceInFlight = true;
    try {
      await runOrchestratorMaintenanceTick({
        stateStore: this.stateStore,
        leaseService: this.leaseService,
        syncService: this.syncService,
        reconcileService: this.reconcileService,
        hasEnabledPeers: () => this.listPeers().some((node) => node.enabled),
        pollPeerStatuses: () => this.pollPeerStatuses(),
        isDestroyed: () => this.destroyed,
      });
    } catch (err: unknown) {
      this.logger.warn(`Cluster maintenance tick failed: ${String(err)}`);
    } finally {
      this.maintenanceInFlight = false;
    }
  }

  bindDirectory(hooks: NodeDirectoryHooks): void {
    this.directoryHooks = hooks;

    this.leaseService.setClusterTopologyHooks({
      hasPeers: () => this.listPeers().filter((n) => n.enabled).length > 0,
      stopRemoteWorkload: (targetHubId, workloadId, proof) =>
        this.sendStopRemoteWorkload(targetHubId, workloadId, proof),
      startRemoteWorkload: (targetHubId, workloadId, generation, epoch) =>
        this.sendStartRemoteWorkload(targetHubId, workloadId, generation, epoch),
    });

    this.reconcileService.setRemoteHandlers({
      fenceRemoteWorkload: (targetHubId, workloadId, winnerHubId, newGeneration, newEpoch, proof) =>
        this.sendFenceRemoteWorkload(
          targetHubId,
          workloadId,
          winnerHubId,
          newGeneration,
          newEpoch,
          proof,
        ),
      pullHigherRevision: (sourceHubId) => this.pullPeerSync(sourceHubId),
    });

    this.syncService.setPeerDirectory({
      lookupPeer: (hubId) => {
        const node = this.listPeers().find((n) => n.id === hubId);
        return node ? { url: node.url, allowHttp: true, enabled: node.enabled } : undefined;
      },
      listPeerIds: () =>
        this.listPeers()
          .filter((n) => n.enabled)
          .map((n) => n.id),
    });

    this.drainService.setClusterHooks({
      listNodes: () => this.listPeers(),
      getNodeCapacities: () => this.buildNodeCapacities(),
    });
  }

  private listPeers(): readonly DrainNodeSummary[] {
    const state = this.stateStore.getStateSync();
    const all = this.directoryHooks?.listNodes() ?? [];
    return all.filter((n) => n.id !== state.hubId);
  }

  recordPeerCapacity(hubId: string, capacity: HubCapacityMetrics, isWeakHub = false): void {
    this.peerCapacities.set(hubId, { capacity, isWeakHub });
  }

  buildNodeCapacities(): NodeCapacityInput[] {
    const state = this.stateStore.getStateSync();
    return buildClusterNodeCapacities({
      localHubId: state.hubId,
      localRole: state.role,
      localFenced: state.fenced,
      peers: this.listPeers(),
      cachedPeerCapacities: this.peerCapacities,
    });
  }

  private async sendPeerPost<T>(
    targetHubId: string,
    path: string,
    body: unknown,
  ): Promise<T | undefined> {
    const state = this.stateStore.getStateSync();
    const node = this.listPeers().find((n) => n.id === targetHubId && n.enabled);
    const trust = this.stateStore.getPeerTrustRecord(targetHubId);
    if (!node || !trust || trust.revoked) return undefined;
    const identity = this.stateStore.getIdentitySync(state.hubId);
    return sendSignedPeerRequest<T>({
      identity,
      homeId: state.homeId,
      targetHubId,
      targetUrl: node.url,
      allowHttp: true,
      channelSecret: trust.channelSecret,
      method: 'POST',
      path,
      body,
    });
  }

  private async sendStopRemoteWorkload(
    targetHubId: string,
    workloadId: string,
    proof: SignedFencingProof,
  ): Promise<boolean> {
    const res = await this.sendPeerPost<{ stopped?: boolean }>(
      targetHubId,
      `/api/cluster/peer/workloads/${encodeURIComponent(workloadId)}/stop`,
      {
        proof,
        newOwnerHubId: proof.newOwnerHubId,
        newGeneration: proof.fencedGeneration + 1,
        newEpoch: proof.epoch,
      },
    );
    return Boolean(res?.stopped);
  }

  private async sendStartRemoteWorkload(
    targetHubId: string,
    workloadId: string,
    generation: number,
    epoch: number,
  ): Promise<boolean> {
    const res = await this.sendPeerPost<{ started?: boolean }>(
      targetHubId,
      `/api/cluster/peer/workloads/${encodeURIComponent(workloadId)}/start`,
      { generation, epoch },
    );
    return Boolean(res?.started);
  }

  private async sendFenceRemoteWorkload(
    targetHubId: string,
    workloadId: string,
    winnerHubId: string,
    newGeneration: number,
    newEpoch: number,
    proof: SignedFencingProof,
  ): Promise<boolean> {
    const res = await this.sendPeerPost<{ fenced?: boolean }>(
      targetHubId,
      '/api/cluster/peer/fence-workload',
      { workloadId, winnerHubId, newGeneration, newEpoch, proof },
    );
    return Boolean(res?.fenced);
  }

  async pullPeerSync(sourceHubId: string): Promise<void> {
    const state = this.stateStore.getStateSync();
    const res = await this.sendPeerPost<RequestSyncResponse>(
      sourceHubId,
      '/api/cluster/peer/request-sync',
      { includeHomeKit: true, force: true },
    );
    if (!res?.envelopes || res.envelopes.length === 0) return;
    await this.syncService.receiveEnvelopes({
      senderHubId: sourceHubId,
      envelopes: res.envelopes,
      workloads: res.workloads,
      acceptEqualRevision: true,
    });
    this.logger.log(`Pulled E2EE sync update from peer ${sourceHubId} into ${state.hubId}`);
  }

  async pollPeerStatuses(): Promise<HubClaimSnapshot[]> {
    const state = await this.stateStore.ensureInitialized();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const snapshots: HubClaimSnapshot[] = [];

    await Promise.all(
      this.listPeers().map(async (node) => {
        const trust = this.stateStore.getPeerTrustRecord(node.id);
        if (!trust || trust.revoked || !node.enabled) return;
        try {
          const status = await sendSignedPeerRequest<PeerStatusResponse>({
            identity,
            homeId: state.homeId,
            targetHubId: node.id,
            targetUrl: node.url,
            allowHttp: true,
            channelSecret: trust.channelSecret,
            method: 'GET',
            path: '/api/cluster/peer/status',
            timeoutMs: 4_000,
          });
          this.directoryHooks?.updateNodeOnline?.(node.id, true);
          if (status.capacity) {
            const isWeak =
              status.capacity.cpuCores <= 2 && status.capacity.memoryBytes < 2 * 1024 * 1024 * 1024;
            this.recordPeerCapacity(node.id, status.capacity, isWeak);
          }
          if (status.snapshot) {
            snapshots.push(status.snapshot);
          }
        } catch {
          // Reachability poll failures are non-fatal; mark offline status accurately.
          this.directoryHooks?.updateNodeOnline?.(node.id, false);
        }
      }),
    );

    return snapshots;
  }

  async reconcileCluster(): Promise<ReconciliationOutcome> {
    const state = await this.stateStore.ensureInitialized();
    const outcome = await this.reconcileService.reconcileClaims(await this.pollPeerStatuses());
    const converged = outcome.resolvedConflicts.length > 0 || outcome.dualCoordinatorResolved;
    if (converged && state.role === 'coordinator' && !state.fenced) {
      await this.syncService.syncAllPeers();
    }
    return outcome;
  }

  async rebalanceCluster(options?: {
    readonly force?: boolean;
    readonly preferences?: Record<string, string>;
  }): Promise<RebalanceResult> {
    await this.stateStore.ensureInitialized();
    const peerSnapshots = await this.pollPeerStatuses();
    const reconciliation =
      peerSnapshots.length > 0
        ? await this.reconcileService.reconcileClaims(peerSnapshots)
        : undefined;
    return executeClusterRebalance({
      stateStore: this.stateStore,
      leaseService: this.leaseService,
      syncService: this.syncService,
      planner: this.planner,
      peers: this.listPeers(),
      nodeCapacities: this.buildNodeCapacities(),
      reconciliation,
      force: options?.force,
      preferences: options?.preferences,
    });
  }

  async ensureSingleHubContinuity(): Promise<void> {
    const state = await this.stateStore.ensureInitialized();
    const activePeers = this.listPeers().filter((n) => n.enabled);
    if (activePeers.length > 0 || state.fenced || state.role === 'fenced') return;

    await this.stateStore.saveState({
      role: 'coordinator',
      coordinatorId: state.hubId,
      fenced: false,
      fencedReason: undefined,
    });

    for (const wl of this.stateStore.listWorkloadsSync()) {
      if (wl.ownerHubId !== state.hubId && wl.state !== 'stopped') {
        await this.stateStore.saveWorkload({
          ...wl,
          ownerHubId: state.hubId,
          standbyHubIdsJson: '[]',
          generation: wl.generation + 1,
          epoch: state.coordinatorEpoch,
          state: 'active',
          updatedAt: Date.now(),
        });
        const ctrl = this.leaseService.getController(wl.workloadId);
        if (ctrl && ctrl.getLocalStatus() !== 'running') {
          await ctrl.startLocal().catch(() => undefined);
        }
      }
    }
  }

  async forwardWorkloadCommand(
    workloadId: string,
    action: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const wl = this.stateStore.getWorkloadSync(workloadId);
    const state = this.stateStore.getStateSync();
    if (!wl || wl.ownerHubId === state.hubId) {
      throw Error('workload_not_hosted_remotely');
    }
    const res = await this.sendPeerPost<{ ok?: boolean; result?: unknown }>(
      wl.ownerHubId,
      '/api/cluster/peer/command',
      { workloadId, action, payload },
    );
    if (!res?.ok) throw Error('remote_workload_command_failed');
    return res.result;
  }

  async establishJoinedPeerTrust(params: {
    readonly hubId: string;
    readonly homeId: string;
    readonly coordinatorHubId: string;
    readonly publicIdentity: ClusterPublicIdentity;
  }): Promise<{
    readonly coordinatorPublicIdentity: ClusterPublicIdentity;
    readonly channelSecret: string;
  }> {
    if (
      !ClusterCryptoIdentity.validatePeerPublicIdentity(params.publicIdentity) ||
      params.publicIdentity.hubId !== params.hubId
    ) {
      throw new HttpException({ error: 'invalid_peer_public_identity' }, HttpStatus.BAD_REQUEST);
    }
    const stored = await this.stateStore.upsertPeerTrust({
      hubId: params.hubId,
      homeId: params.homeId,
      publicIdentity: params.publicIdentity,
    });
    return {
      coordinatorPublicIdentity: this.stateStore
        .getIdentitySync(params.coordinatorHubId)
        .publicIdentity(),
      channelSecret: stored.plainChannelSecret,
    };
  }

  triggerInitialPeerSync(hubId: string): void {
    void (async () => {
      if (this.destroyed) return;
      await this.syncService.syncPeer(hubId, { includeHomeKit: true, force: true });
      if (this.destroyed) return;
      await this.pollPeerStatuses();
      if (this.destroyed) return;
      const state = this.stateStore.getStateSync();
      if (
        !state.fenced &&
        state.role === 'coordinator' &&
        this.leaseService.listDecodedWorkloads().length > 1
      ) {
        await this.rebalanceCluster({ force: false });
      }
    })().catch(() => undefined);
  }

  async verifyAndDrainBeforeRemove(
    nodeId: string,
    options?: { readonly force?: boolean; readonly targetHubId?: string },
  ): Promise<void> {
    await verifyAndDrainBeforeRemoveNode({
      stateStore: this.stateStore,
      drainService: this.drainService,
      nodeId,
      options,
    });
  }
}
