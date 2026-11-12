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
import type { Transactions } from '../storage/transactions.js';
import { HUB_AUTH_SERVICE } from '../auth/tokens.js';
import { HubAuthService } from '../auth/service.js';
import type { IClusterService } from './cluster.controller.js';
import type {
  AddNodeDto,
  UpdateNodeDto,
  ClusterNodeRecordDto,
  ClusterStatusResponseDto,
  JoinClusterDto,
  JoinClusterResponseDto,
} from './cluster.dto.js';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from './transfer.js';
import type {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
  InitiateTransferDto,
} from './transfer.dto.js';

const VALID_CLUSTER_ROLES = new Set(['storage', 'stream', 'radio', 'bridge']);

@Injectable()
export class DefaultClusterService implements IClusterService, OnModuleInit {
  private readonly nodesMap = new Map<string, ClusterNodeRecordDto>();
  private readonly coordinatorId = `hub-${randomUUID().slice(0, 8)}`;
  private initialization?: Promise<void>;

  constructor(
    @Optional()
    @Inject(CATALOG_SOURCE)
    private readonly source?: DataSource,
    @Optional()
    @Inject(CATALOG_TRANSACTIONS)
    private readonly transactions?: Transactions,
    @Optional()
    @Inject(HUB_AUTH_SERVICE)
    private readonly authService?: HubAuthService,
    @Optional()
    @Inject(CLUSTER_TRANSFER_MANAGER)
    private readonly transferManager?: ClusterTransferManager,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  status(): ClusterStatusResponseDto {
    const coordinatorId =
      this.transferManager?.getCoordinatorId() ??
      this.authService?.getIdentity().hubId ??
      this.coordinatorId;
    const role = this.transferManager?.getRole() ?? 'coordinator';
    const epoch = this.transferManager?.getEpoch() ?? 1;
    const fenced = this.transferManager?.isFenced() ?? false;
    return {
      id: coordinatorId,
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
    const roles = node.roles ?? ['storage', 'stream'];
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      roles.some((r) => typeof r !== 'string' || !VALID_CLUSTER_ROLES.has(r))
    ) {
      throw new HttpException({ error: 'invalid_node_roles' }, HttpStatus.BAD_REQUEST);
    }

    const coordinatorHomeId = this.authService?.getIdentity().homeId ?? 'home-default';
    if (node.homeId && node.homeId !== coordinatorHomeId) {
      throw new HttpException({ error: 'wrong_home' }, HttpStatus.FORBIDDEN);
    }

    await this.initialize();
    const id = node.nodeId?.trim() || randomUUID();
    const record: ClusterNodeRecordDto = {
      id,
      name: node.name ?? `Node ${id.slice(0, 6)}`,
      url: node.url,
      enabled: true,
      roles,
      online: true,
      homeId: coordinatorHomeId,
    };
    if (this.transactions) {
      await this.transactions.run((manager) =>
        manager.upsert(ClusterNodeEntity, { id, value: JSON.stringify(record) }, ['id']),
      );
    }
    this.nodesMap.set(id, record);

    if (node.token && this.authService) {
      this.authService.registerToken(node.token, {
        clientId: id,
        clientRole: 'node',
        clientName: record.name,
      });
    }

    return record;
  }

  async join(joinRequest: JoinClusterDto): Promise<JoinClusterResponseDto> {
    this.transferManager?.assertNotFenced();
    if (!joinRequest?.url || typeof joinRequest.url !== 'string' || !joinRequest?.hubId) {
      throw new HttpException({ error: 'invalid_join_request' }, HttpStatus.BAD_REQUEST);
    }
    const roles = joinRequest.roles;
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      roles.some((r) => typeof r !== 'string' || !VALID_CLUSTER_ROLES.has(r))
    ) {
      throw new HttpException({ error: 'invalid_node_roles' }, HttpStatus.BAD_REQUEST);
    }

    const coordinatorHomeId = this.authService?.getIdentity().homeId ?? 'home-default';
    const coordinatorHubId = this.authService?.getIdentity().hubId ?? this.coordinatorId;

    if (joinRequest.homeId !== coordinatorHomeId) {
      throw new HttpException({ error: 'wrong_home' }, HttpStatus.FORBIDDEN);
    }

    if (joinRequest.grant && this.authService) {
      try {
        const grantId = String(joinRequest.grant.grantId ?? '');
        this.authService.pairing.assertGrant(grantId, {
          expectedHubId: coordinatorHubId,
          expectedHomeId: coordinatorHomeId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'invalid_pairing_grant';
        throw new HttpException({ error: msg }, HttpStatus.UNAUTHORIZED);
      }
    }

    await this.initialize();
    const id = joinRequest.hubId.trim();
    const record: ClusterNodeRecordDto = {
      id,
      name: joinRequest.name ?? `Secondary Hub ${id.slice(0, 6)}`,
      url: joinRequest.url,
      enabled: true,
      roles,
      online: true,
      homeId: coordinatorHomeId,
    };

    if (this.transactions) {
      await this.transactions.run((manager) =>
        manager.upsert(ClusterNodeEntity, { id, value: JSON.stringify(record) }, ['id']),
      );
    }
    this.nodesMap.set(id, record);

    return {
      status: 'joined',
      homeId: coordinatorHomeId,
      coordinatorHubId,
      node: record,
    };
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

  async remove(id: string): Promise<{ removed: boolean; id: string }> {
    this.transferManager?.assertNotFenced();
    await this.initialize();
    if (!this.nodesMap.has(id)) {
      throw new HttpException({ error: 'node_not_found' }, HttpStatus.NOT_FOUND);
    }
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.delete(ClusterNodeEntity, { id });
        await manager.delete(ClusterLocationEntity, { nodeId: id });
      });
    }
    this.nodesMap.delete(id);
    if (this.authService) {
      await this.authService.revokeClient(id);
    }
    return { removed: true, id };
  }

  async initiateTransfer(dto: InitiateTransferDto): Promise<HubTransferIntentDto> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.initiate(dto);
  }

  async prepareTransfer(
    id: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.prepare(id);
  }

  async fenceTransfer(
    id: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.fence(id);
  }

  async commitTransfer(id: string): Promise<HubTransferCommitResultDto> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.commit(id);
  }

  async rollbackTransfer(id: string, reason?: string): Promise<HubTransferRollbackResultDto> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.rollback(id, reason);
  }

  async getTransfer(id: string): Promise<HubTransferIntentDto> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.getTransfer(id);
  }

  async listTransfers(): Promise<HubTransferIntentDto[]> {
    if (!this.transferManager) {
      throw new HttpException(
        { error: 'transfer_manager_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.transferManager.listTransfers();
  }

  private initialize(): Promise<void> {
    const source = this.source;
    if (!source) return Promise.resolve();
    this.initialization ??= (async () => {
      const rows = await source.manager.find(ClusterNodeEntity);
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value) as ClusterNodeRecordDto;
          this.nodesMap.set(row.id, { ...parsed, id: row.id });
        } catch (error) {
          process.emitWarning(error instanceof Error ? error : String(error));
        }
      }
    })();
    return this.initialization;
  }

  private updateRecord(current: ClusterNodeRecordDto, patch: UpdateNodeDto): ClusterNodeRecordDto {
    return {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.roles !== undefined ? { roles: patch.roles } : {}),
    };
  }
}
