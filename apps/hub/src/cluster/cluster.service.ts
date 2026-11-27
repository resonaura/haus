/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { CATALOG_SOURCE, CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import { ClusterLocationEntity, ClusterNodeEntity } from '../storage/entities/domains.js';
import { StandaloneHomeEntryEntity } from '../storage/standalone/entities.js';
import { EventArchiveLocationEntity } from '../events/recording.entities.js';
import type { Transactions } from '../storage/transactions.js';
import { HUB_AUTH_SERVICE } from '../auth/tokens.js';
import { HubAuthService } from '../auth/service.js';
import type { IClusterService } from './cluster.controller.js';
import type {
  AddNodeDto,
  AttachClusterDto,
  UpdateNodeDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
  EnrollHubRequestDto,
  JoinClusterDto,
  JoinClusterResponseDto,
  RebalanceClusterDto,
  RemoveNodeOptionsDto,
} from './cluster.dto.js';
import { acceptCoordinatorJoinRequest, attachSecondaryHubToCoordinator } from './attach.js';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from './transfer.js';
import type {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
  InitiateTransferDto,
} from './transfer.dto.js';
import {
  buildClusterTopologyView,
  enrollSecondaryHubIntoHome,
  forwardCoordinatorActionIfSecondary,
  type EnrollHubResponse,
} from './coordination/enroll.js';
import { ClusterStateStore } from './coordination/state.js';
import { ClusterLeaseService } from './coordination/leases.js';
import { ClusterOrchestrator } from './coordination/orchestrator.js';
import { persistPeerNvrAccess } from './coordination/nvr-peer.js';
import { ClusterDrainService, type NodeDrainPlan, type NodeDrainResult } from './drain/service.js';
import {
  addClusterNodeRecord,
  deduplicateClusterNodes,
  loadClusterNodesFromDb,
  stripNodeSecrets,
  syncRemovedNodeToRecordingCluster,
  updateClusterNodeRecord,
} from './nodes.js';
import type { Cluster } from './cluster.js';
import { RECORDING_CLUSTER } from '../events/tokens.js';

@Injectable()
export class DefaultClusterService implements IClusterService, OnModuleInit {
  private readonly nodesMap = new Map<string, ClusterNodeRecordDto>();
  private readonly coordinatorId = `hub-${randomUUID().slice(0, 8)}`;
  private readonly consumedGrantIds = new Set<string>();
  private initialization?: Promise<void>;

  constructor(
    @Optional() @Inject(CATALOG_SOURCE) private readonly source?: DataSource,
    @Optional() @Inject(CATALOG_TRANSACTIONS) private readonly transactions?: Transactions,
    @Optional() @Inject(HUB_AUTH_SERVICE) private readonly authService?: HubAuthService,
    @Optional()
    @Inject(CLUSTER_TRANSFER_MANAGER)
    private readonly transferManager?: ClusterTransferManager,
    @Optional() @Inject(ClusterStateStore) private readonly stateStore?: ClusterStateStore,
    @Optional() @Inject(ClusterLeaseService) private readonly leaseService?: ClusterLeaseService,
    @Optional() @Inject(ClusterDrainService) private readonly drainService?: ClusterDrainService,
    @Optional() @Inject(ClusterOrchestrator) private readonly orchestrator?: ClusterOrchestrator,
    @Optional() @Inject(RECORDING_CLUSTER) private readonly recordingCluster?: Cluster,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  private topologyView() {
    const state = this.stateStore?.getStateSync();
    const coordinatorId =
      this.transferManager?.getCoordinatorId() ??
      state?.coordinatorId ??
      this.authService?.getIdentitySummary().hubId ??
      this.coordinatorId;
    const role = (this.transferManager?.getRole() ?? state?.role ?? 'coordinator') as
      'coordinator' | 'node' | 'fenced' | 'standalone';
    const epoch = this.transferManager?.getEpoch() ?? state?.coordinatorEpoch ?? 1;
    return {
      state,
      coordinatorId,
      role,
      epoch,
      fenced: this.transferManager?.isFenced() ?? state?.fenced ?? false,
      view: buildClusterTopologyView({
        stateStore: this.stateStore,
        authService: this.authService,
        nodes: this.nodesMap.values(),
        fallbackHubId: this.coordinatorId,
        role,
        coordinatorId,
        epoch,
      }),
    };
  }

  status(): ClusterStatusResponseDto {
    const { coordinatorId, role, epoch, fenced, view } = this.topologyView();
    const rec = this.recordingCluster?.status();
    const backups = rec?.backups;
    return {
      id: coordinatorId,
      selfHubId: view.selfHubId,
      ...(view.coordinatorUrl ? { coordinatorUrl: view.coordinatorUrl } : {}),
      coordinatorId,
      role,
      epoch,
      fenced,
      optional: rec?.optional ?? true,
      busy: rec?.busy ?? false,
      sync: rec?.sync ?? { enabled: true, authority: 'helper' },
      backups: {
        items: [...(backups?.items ?? [])],
        busy: Boolean(backups?.busy),
        ...(backups?.error ? { error: backups.error } : {}),
      },
      nodes: Array.from(this.nodesMap.values()),
      members: view.members,
    };
  }

  async getNode(id: string): Promise<ClusterNodeRecordDto> {
    await this.initialize();
    const node = this.nodesMap.get(id);
    if (!node) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }
    return node;
  }

  async add(node: AddNodeDto): Promise<ClusterNodeRecordDto> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    return addClusterNodeRecord({
      node,
      nodesMap: this.nodesMap,
      authService: this.authService,
      transactions: this.transactions,
    });
  }

  private async proxyOrRun<T>(
    action: string,
    payload: unknown,
    local: () => Promise<T>,
  ): Promise<T> {
    await this.initialize();
    const proxied = await forwardCoordinatorActionIfSecondary<T>({
      stateStore: this.stateStore,
      nodesMap: this.nodesMap,
      action,
      payload,
    });
    return proxied.forwarded ? proxied.result : local();
  }

  async enrollHub(dto: EnrollHubRequestDto): Promise<EnrollHubResponse> {
    this.transferManager?.assertNotFenced();
    return this.proxyOrRun('enroll_hub', dto, () =>
      enrollSecondaryHubIntoHome({
        dto,
        stateStore: this.stateStore,
        authService: this.authService,
        nodesMap: this.nodesMap,
        fallbackCoordinatorId: this.coordinatorId,
      }),
    );
  }

  async join(joinRequest: JoinClusterDto): Promise<JoinClusterResponseDto> {
    return acceptCoordinatorJoinRequest({
      joinRequest,
      coordinatorFallbackId: this.coordinatorId,
      consumedGrantIds: this.consumedGrantIds,
      nodesMap: this.nodesMap,
      initialize: () => this.initialize(),
      stateStore: this.stateStore,
      transferManager: this.transferManager,
      orchestrator: this.orchestrator,
      authService: this.authService,
      transactions: this.transactions,
    });
  }

  async attach(dto: AttachClusterDto): Promise<JoinClusterResponseDto> {
    return attachSecondaryHubToCoordinator({
      dto,
      nodesMap: this.nodesMap,
      initialize: () => this.initialize(),
      stateStore: this.stateStore,
      transferManager: this.transferManager,
      orchestrator: this.orchestrator,
      authService: this.authService,
      transactions: this.transactions,
    });
  }

  async update(id: string, patch: UpdateNodeDto): Promise<ClusterNodeRecordDto> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    return updateClusterNodeRecord({
      id,
      patch,
      nodesMap: this.nodesMap,
      transactions: this.transactions,
      recordingCluster: this.recordingCluster,
    });
  }

  private assertKnownNode(id: string): string {
    const localHubId =
      this.stateStore?.getStateSync().hubId ??
      this.authService?.getIdentitySummary().hubId ??
      this.coordinatorId;
    if (id !== localHubId && !this.nodesMap.has(id)) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }
    return localHubId;
  }

  async getDrainPlan(id: string): Promise<NodeDrainPlan> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    this.assertKnownNode(id);
    if (!this.drainService) {
      throw new HttpException(
        { error: 'drain_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.drainService.inspectDrainPlan(id);
  }

  async drain(id: string, options?: RemoveNodeOptionsDto): Promise<NodeDrainResult> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    this.assertKnownNode(id);
    if (!this.drainService) {
      throw new HttpException(
        { error: 'drain_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      return await this.drainService.drainNode(id, {
        targetHubId: options?.targetHubId,
        allowOfflineWorkloadFence: options?.force ?? false,
        decommissionPeer: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'drain_failed';
      if (msg === 'cannot_remove_sole_hub' || msg === 'transfer_coordinator_before_removing_self') {
        throw new HttpException({ error: msg }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  async remove(
    id: string,
    options?: RemoveNodeOptionsDto,
  ): Promise<{ removed: boolean; id: string }> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    this.assertKnownNode(id);

    if (this.orchestrator) {
      await this.orchestrator.verifyAndDrainBeforeRemove(id, options);
    } else if (this.drainService) {
      const plan = await this.drainService.inspectDrainPlan(id);
      if (plan.isSoleHub)
        throw new HttpException(
          { error: 'cannot_remove_sole_hub', drainPlan: plan },
          HttpStatus.CONFLICT,
        );
      if (plan.isLocalNode)
        throw new HttpException(
          { error: 'transfer_coordinator_before_removing_self', drainPlan: plan },
          HttpStatus.CONFLICT,
        );
    }

    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.delete(ClusterNodeEntity, { id });
        await manager.delete(ClusterLocationEntity, { nodeId: id });
        await manager.delete(EventArchiveLocationEntity, { nodeId: id });
      });
    }
    this.nodesMap.delete(id);
    await syncRemovedNodeToRecordingCluster(id, this.recordingCluster);
    if (this.stateStore) {
      await this.stateStore.revokePeer(id);
    }
    if (this.authService) {
      await this.authService.revokeClient(id);
    }
    await this.orchestrator?.ensureSingleHubContinuity();
    return { removed: true, id };
  }

  async getWorkloads() {
    await this.initialize();
    const state = this.stateStore?.getStateSync();
    const hubId = state?.hubId ?? this.authService?.getIdentity().hubId ?? this.coordinatorId;
    return {
      hubId,
      coordinatorId: state?.coordinatorId ?? hubId,
      role: state?.role ?? this.transferManager?.getRole() ?? 'coordinator',
      epoch: state?.coordinatorEpoch ?? this.transferManager?.getEpoch() ?? 1,
      fenced: state?.fenced ?? this.transferManager?.isFenced() ?? false,
      workloads: this.leaseService?.listDecodedWorkloads() ?? [],
      nodeCapacities: this.orchestrator?.buildNodeCapacities() ?? [],
    };
  }

  async rebalance(options?: RebalanceClusterDto) {
    this.transferManager?.assertNotFenced();
    return this.proxyOrRun('rebalance', options, () => {
      if (!this.orchestrator) {
        throw new HttpException(
          { error: 'orchestrator_unavailable' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return this.orchestrator.rebalanceCluster({
        force: options?.force ?? true,
        preferences: options?.preferences,
      });
    });
  }

  async reconcile() {
    await this.initialize();
    if (!this.orchestrator) {
      throw new HttpException(
        { error: 'orchestrator_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.orchestrator.reconcileCluster();
  }

  private requireTransferManager(): ClusterTransferManager {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager;
  }

  initiateTransfer(dto: InitiateTransferDto): Promise<HubTransferIntentDto> {
    return this.proxyOrRun('transfer_initiate', dto, () =>
      this.requireTransferManager().initiate(dto),
    );
  }

  prepareTransfer(
    id: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }> {
    return this.proxyOrRun('transfer_prepare', { id }, () =>
      this.requireTransferManager().prepare(id),
    );
  }

  fenceTransfer(
    id: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }> {
    return this.proxyOrRun('transfer_fence', { id }, () => this.requireTransferManager().fence(id));
  }

  commitTransfer(id: string): Promise<HubTransferCommitResultDto> {
    return this.proxyOrRun('transfer_commit', { id }, () =>
      this.requireTransferManager().commit(id),
    );
  }

  rollbackTransfer(id: string, reason?: string): Promise<HubTransferRollbackResultDto> {
    return this.proxyOrRun('transfer_rollback', { id, reason }, () =>
      this.requireTransferManager().rollback(id, reason),
    );
  }

  async getTransfer(id: string): Promise<HubTransferIntentDto> {
    return this.requireTransferManager().getTransfer(id);
  }

  async listTransfers(): Promise<HubTransferIntentDto[]> {
    return this.requireTransferManager().listTransfers();
  }

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      const identity = this.authService?.getIdentitySummary();
      this.authService?.setClusterTopologyProvider(() => {
        const { view } = this.topologyView();
        return {
          homeName: view.homeName,
          publicCluster: view.publicCluster,
          authenticated: view.authenticated,
        };
      });
      if (this.source) {
        await loadClusterNodesFromDb(this.source, this.nodesMap);
      }
      const grantRows = this.source
        ? await this.source.manager.findBy(StandaloneHomeEntryEntity, { kind: 'consumed_grant' })
        : this.transactions
          ? await this.transactions.run((m) =>
              m.findBy(StandaloneHomeEntryEntity, { kind: 'consumed_grant' }),
            )
          : [];
      for (const row of grantRows) this.consumedGrantIds.add(row.entryId);
      this.stateStore?.setDecommissionHook((localHubId) => {
        for (const key of this.nodesMap.keys()) {
          if (key !== localHubId) this.nodesMap.delete(key);
        }
      });
      const localNodeUrl = identity ? this.nodesMap.get(identity.hubId)?.url : undefined;
      if (this.stateStore) {
        const loadedState = await this.stateStore.ensureInitialized(
          identity
            ? {
                hubId: identity.hubId,
                homeId: identity.homeId,
                ...(localNodeUrl ? { hubUrl: localNodeUrl } : {}),
              }
            : undefined,
        );
        if (loadedState.homeId && identity && identity.homeId !== loadedState.homeId) {
          this.authService?.setHomeId(loadedState.homeId);
        }
        await deduplicateClusterNodes({
          nodesMap: this.nodesMap,
          localHubId: loadedState.hubId,
          localUrl:
            loadedState.coordinatorId === loadedState.hubId
              ? loadedState.coordinatorUrl
              : localNodeUrl,
          transactions: this.transactions,
          recordingCluster: this.recordingCluster,
        });
      }
      this.orchestrator?.bindDirectory({
        listNodes: () => Array.from(this.nodesMap.values()),
        updateNodeOnline: (hubId, online) => {
          const existing = this.nodesMap.get(hubId);
          if (existing && existing.online !== online) {
            this.nodesMap.set(hubId, { ...existing, online });
          }
        },
        updatePeerNvrAccess: async (hubId, access) => {
          const changed = await persistPeerNvrAccess({
            hubId,
            access,
            transactions: this.transactions,
            recordingCluster: this.recordingCluster,
          });
          if (changed) {
            const existing = this.nodesMap.get(hubId);
            if (existing) {
              this.nodesMap.set(
                hubId,
                stripNodeSecrets({
                  ...existing,
                  allowHttp: access.allowHttp,
                  ...(access.roles?.length ? { roles: [...access.roles] } : {}),
                }),
              );
            }
          }
        },
      });
    })();
    return this.initialization;
  }
}
