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
  JoinClusterDto,
  JoinClusterResponseDto,
  RebalanceClusterDto,
  RemoveNodeOptionsDto,
} from './cluster.dto.js';
import {
  acceptCoordinatorJoinRequest,
  assertValidClusterRoles,
  attachSecondaryHubToCoordinator,
} from './attach.js';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from './transfer.js';
import type {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
  InitiateTransferDto,
} from './transfer.dto.js';
import { validateClusterPeerUrl } from './crypto/transport.js';
import { ClusterStateStore } from './coordination/state.js';
import { ClusterLeaseService } from './coordination/leases.js';
import { ClusterOrchestrator } from './coordination/orchestrator.js';
import { ClusterDrainService, type NodeDrainPlan, type NodeDrainResult } from './drain/service.js';
import { loadClusterNodesFromDb } from './nodes.js';

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
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  status(): ClusterStatusResponseDto {
    const state = this.stateStore?.getStateSync();
    const coordinatorId =
      this.transferManager?.getCoordinatorId() ??
      state?.coordinatorId ??
      this.authService?.getIdentity().hubId ??
      this.coordinatorId;
    const role = this.transferManager?.getRole() ?? state?.role ?? 'coordinator';
    const epoch = this.transferManager?.getEpoch() ?? state?.coordinatorEpoch ?? 1;
    const fenced = this.transferManager?.isFenced() ?? state?.fenced ?? false;
    return {
      id: coordinatorId,
      coordinatorId,
      role,
      epoch,
      fenced,
      nodes: Array.from(this.nodesMap.values()),
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
    if (!node.url || typeof node.url !== 'string') {
      throw new HttpException({ error: 'invalid_node_url' }, HttpStatus.BAD_REQUEST);
    }
    let validatedUrl: string;
    try {
      validatedUrl = validateClusterPeerUrl(node.url, true);
    } catch {
      throw new HttpException({ error: 'invalid_node_address' }, HttpStatus.BAD_REQUEST);
    }

    const roles = node.roles ?? ['storage', 'stream'];
    assertValidClusterRoles(roles);

    const coordinatorHomeId = this.authService?.getIdentity().homeId ?? 'home-default';
    if (node.homeId && node.homeId !== coordinatorHomeId) {
      throw new HttpException({ error: 'wrong_home' }, HttpStatus.FORBIDDEN);
    }

    await this.initialize();
    const id = node.nodeId?.trim() || randomUUID();
    const record: ClusterNodeRecordDto = {
      id,
      name: node.name ?? `Node ${id.slice(0, 6)}`,
      url: validatedUrl,
      enabled: true,
      roles,
      online: true,
      homeId: coordinatorHomeId,
      ...(typeof node.allowHttp === 'boolean' ? { allowHttp: node.allowHttp } : {}),
      ...(node.sshServerId !== undefined ? { sshServerId: node.sshServerId } : {}),
    };
    if (this.transactions) {
      await this.transactions.run((manager) =>
        manager.upsert(ClusterNodeEntity, { id, value: JSON.stringify(record) }, ['id']),
      );
    }
    this.nodesMap.set(id, record);

    const nodeToken = node.token ?? node.key;
    if (nodeToken && this.authService) {
      this.authService.registerToken(nodeToken, {
        clientId: id,
        clientRole: 'node',
        clientName: record.name,
      });
    }

    return { ...record, pairedNodeId: id };
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
    const cached = this.nodesMap.get(id);
    if (!cached) throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);

    let updated = this.updateRecord(cached, patch);
    if (this.transactions) {
      updated = await this.transactions.run(async (manager) => {
        const saved = await manager.findOneBy(ClusterNodeEntity, { id });
        if (!saved) throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
        const current = JSON.parse(saved.value) as ClusterNodeRecordDto;
        const next = this.updateRecord({ ...current, id }, patch);
        await manager.update(ClusterNodeEntity, { id }, { value: JSON.stringify(next) });
        return next;
      });
    }
    this.nodesMap.set(id, updated);
    return updated;
  }

  async getDrainPlan(id: string): Promise<NodeDrainPlan> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    const localHubId =
      this.stateStore?.getStateSync().hubId ??
      this.authService?.getIdentity().hubId ??
      this.coordinatorId;
    if (id !== localHubId && !this.nodesMap.has(id)) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }
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
    const localHubId =
      this.stateStore?.getStateSync().hubId ??
      this.authService?.getIdentity().hubId ??
      this.coordinatorId;
    if (id !== localHubId && !this.nodesMap.has(id)) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }
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
    const localHubId =
      this.stateStore?.getStateSync().hubId ??
      this.authService?.getIdentity().hubId ??
      this.coordinatorId;
    if (id !== localHubId && !this.nodesMap.has(id)) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }

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
    await this.initialize();
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
    return this.requireTransferManager().initiate(dto);
  }

  prepareTransfer(
    id: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }> {
    return this.requireTransferManager().prepare(id);
  }

  fenceTransfer(
    id: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }> {
    return this.requireTransferManager().fence(id);
  }

  commitTransfer(id: string): Promise<HubTransferCommitResultDto> {
    return this.requireTransferManager().commit(id);
  }

  rollbackTransfer(id: string, reason?: string): Promise<HubTransferRollbackResultDto> {
    return this.requireTransferManager().rollback(id, reason);
  }

  async getTransfer(id: string): Promise<HubTransferIntentDto> {
    return this.requireTransferManager().getTransfer(id);
  }

  async listTransfers(): Promise<HubTransferIntentDto[]> {
    return this.requireTransferManager().listTransfers();
  }

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      const identity = this.authService?.getIdentity();
      if (this.source) {
        await loadClusterNodesFromDb(this.source, this.nodesMap);
        const grants = await this.source.manager.findBy(StandaloneHomeEntryEntity, {
          kind: 'consumed_grant',
        });
        for (const row of grants) {
          this.consumedGrantIds.add(row.entryId);
        }
      } else if (this.transactions) {
        const grants = await this.transactions.run((manager) =>
          manager.findBy(StandaloneHomeEntryEntity, { kind: 'consumed_grant' }),
        );
        for (const row of grants) {
          this.consumedGrantIds.add(row.entryId);
        }
      }
      this.stateStore?.setDecommissionHook((localHubId) => {
        for (const key of this.nodesMap.keys()) {
          if (key !== localHubId) {
            this.nodesMap.delete(key);
          }
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
      }
      this.orchestrator?.bindDirectory({
        listNodes: () => Array.from(this.nodesMap.values()),
        updateNodeOnline: (hubId, online) => {
          const existing = this.nodesMap.get(hubId);
          if (existing && existing.online !== online) {
            this.nodesMap.set(hubId, { ...existing, online });
          }
        },
      });
    })();
    return this.initialization;
  }

  private updateRecord(current: ClusterNodeRecordDto, patch: UpdateNodeDto): ClusterNodeRecordDto {
    const next: ClusterNodeRecordDto = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.roles !== undefined ? { roles: patch.roles } : {}),
      ...(patch.livePriority !== undefined ? { livePriority: patch.livePriority } : {}),
      ...(patch.storageLimitBytes !== undefined
        ? { storageLimitBytes: patch.storageLimitBytes }
        : {}),
      ...(patch.sshServerId !== undefined ? { sshServerId: patch.sshServerId } : {}),
    };
    if (patch.sshServerId === null) {
      delete next.sshServerId;
    }
    return next;
  }
}
