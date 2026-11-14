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
import type { Transactions } from '../storage/transactions.js';
import { HUB_AUTH_SERVICE } from '../auth/tokens.js';
import { HubAuthService } from '../auth/service.js';
import { ClusterLeaseService } from './coordination/leases.js';
import { ClusterStateStore } from './coordination/state.js';
import { BoundedReplayGuard } from './crypto/envelope.js';
import { HUB_DATA_DIRECTORY } from './crypto/master-key.js';
import { ClusterSyncService } from './sync/service.js';
import { ClusterSnapshotCodec, type CredentialBundlePayload } from './sync/snapshot.js';
import type {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
  InitiateTransferDto,
  TransferSummaryDto,
} from './transfer.dto.js';
import {
  applyHubTransferManifest,
  collectHubTransferManifest,
  decodePersistedTransfers,
  savePersistedTransferIntent,
} from './transfer/manifest.js';
import {
  handleIncomingTransferCommit,
  handleIncomingTransferPrepare,
  handleIncomingTransferRollback,
  transferWorkloadsOwnership,
} from './transfer/incoming.js';
import {
  dispatchRemoteTransferCommit,
  dispatchRemoteTransferRollback,
  lookupClusterNodeUrl,
  tryDispatchRemotePrepare,
  type OutgoingTransferRecord,
} from './transfer/outgoing.js';
import {
  calculateTransferManifestChecksum,
  type HubTransferManifest,
  type RemoteTransferCommitPayload,
  type RemoteTransferPreparePayload,
  type RemoteTransferRollbackPayload,
} from './transfer/remote.js';

export const CLUSTER_TRANSFER_MANAGER = 'CLUSTER_TRANSFER_MANAGER';
export type { HubTransferManifest };

@Injectable()
export class ClusterTransferManager implements OnModuleInit {
  private readonly transfers = new Map<string, OutgoingTransferRecord>();
  private readonly incomingPrepared = new Map<string, RemoteTransferPreparePayload>();
  private readonly transferReplayGuard = new BoundedReplayGuard();
  private fenced = false;
  private activeTransferId?: string;
  private coordinatorEpoch = 1;
  private coordinatorIdOverride?: string;
  private roleOverride?: 'coordinator' | 'node';
  private hydrated = false;

  constructor(
    @Optional() @Inject(CATALOG_SOURCE) private readonly source?: DataSource,
    @Optional() @Inject(CATALOG_TRANSACTIONS) private readonly transactions?: Transactions,
    @Optional() @Inject(HUB_AUTH_SERVICE) private readonly authService?: HubAuthService,
    @Optional() @Inject(ClusterStateStore) private readonly stateStore?: ClusterStateStore,
    @Optional() @Inject(ClusterLeaseService) private readonly leaseService?: ClusterLeaseService,
    @Optional() @Inject(ClusterSyncService) private readonly syncService?: ClusterSyncService,
    @Optional() @Inject(HUB_DATA_DIRECTORY) private readonly dataDir?: string,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.hydrateFromStore();
  }

  private async hydrateFromStore(): Promise<void> {
    if (this.hydrated || !this.stateStore) return;
    this.hydrated = true;
    const identity = this.authService?.getIdentity();
    const state = await this.stateStore.ensureInitialized(
      identity ? { hubId: identity.hubId, homeId: identity.homeId } : undefined,
    );
    this.coordinatorEpoch = Math.max(this.coordinatorEpoch, state.coordinatorEpoch);
    this.coordinatorIdOverride = state.coordinatorId;
    if (state.fenced || state.role === 'fenced') {
      this.fenced = true;
      this.activeTransferId = state.fencedReason;
    } else if (state.role === 'node' || state.role === 'coordinator') {
      this.roleOverride = state.role;
    }

    for (const rec of decodePersistedTransfers(this.stateStore, state.homeId)) {
      if (this.transfers.has(rec.intent.transferId)) continue;
      this.transfers.set(rec.intent.transferId, rec);
      if (['initiated', 'target_prepared', 'source_fenced'].includes(rec.intent.state)) {
        this.activeTransferId = rec.intent.transferId;
      }
    }
  }

  private getSnapshotCodec(): ClusterSnapshotCodec {
    return (
      this.syncService?.getCodec() ?? new ClusterSnapshotCodec(this.transactions, this.dataDir)
    );
  }

  isFenced(): boolean {
    return this.fenced;
  }

  assertNotFenced(): void {
    if (this.fenced) {
      throw new HttpException(
        {
          error: 'coordinator_fenced',
          message: 'Coordinator is fenced during Hub transfer; mutations are prohibited',
          transferId: this.activeTransferId,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  getEpoch(): number {
    return this.coordinatorEpoch;
  }

  getRole(): 'coordinator' | 'node' | 'fenced' {
    if (this.fenced) return 'fenced';
    return this.roleOverride ?? 'coordinator';
  }

  getCoordinatorId(): string {
    return this.coordinatorIdOverride ?? this.authService?.getIdentity().hubId ?? 'hub-coordinator';
  }

  private async lookupNodeUrl(hubId: string): Promise<string | undefined> {
    return lookupClusterNodeUrl(this.source, hubId);
  }

  async initiate(dto: InitiateTransferDto): Promise<HubTransferIntentDto> {
    await this.hydrateFromStore();
    this.assertNotFenced();
    if (this.activeTransferId) {
      const active = this.transfers.get(this.activeTransferId);
      if (
        active &&
        ['initiated', 'target_prepared', 'source_fenced'].includes(active.intent.state)
      ) {
        throw new HttpException(
          { error: 'transfer_in_progress', activeTransferId: this.activeTransferId },
          HttpStatus.CONFLICT,
        );
      }
    }
    if (!dto.targetHubId || typeof dto.targetHubId !== 'string') {
      throw new HttpException({ error: 'invalid_target_hub_id' }, HttpStatus.BAD_REQUEST);
    }
    const sourceHubId = this.getCoordinatorId();
    if (dto.targetHubId === sourceHubId) {
      throw new HttpException({ error: 'target_cannot_be_self' }, HttpStatus.BAD_REQUEST);
    }

    const homeId = this.authService?.getIdentity().homeId ?? 'home-default';
    const preservePairing = dto.preservePairing ?? true;
    const transferId = `htx_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const nextEpoch = this.coordinatorEpoch + 1;
    const manifest = await collectHubTransferManifest({
      source: this.source,
      transferId,
      homeId,
      sourceHubId,
      targetHubId: dto.targetHubId,
      epoch: nextEpoch,
      preservePairing,
    });
    const checksum = calculateTransferManifestChecksum(manifest);
    const summary: TransferSummaryDto = {
      devicesCount: manifest.homeEntries.filter((e) => e.kind === 'device').length,
      endpointStatesCount: manifest.homeEntries.filter((e) => e.kind === 'endpoint_state').length,
      scenesCount: manifest.homeEntries.filter((e) => e.kind === 'scene').length,
      scriptsCount: manifest.homeEntries.filter((e) => e.kind === 'script').length,
      automationsCount: manifest.homeEntries.filter((e) => e.kind === 'automation').length,
      archivesCount: manifest.backups.length + manifest.clusterLocations.length,
      preservePairing,
    };

    const intent: HubTransferIntentDto = {
      transferId,
      homeId,
      sourceHubId,
      targetHubId: dto.targetHubId,
      epoch: nextEpoch,
      checksum,
      state: 'initiated',
      summary,
      createdAt: Date.now(),
    };
    this.transfers.set(transferId, { intent, manifest });
    this.activeTransferId = transferId;
    await savePersistedTransferIntent(this.stateStore, intent);
    return intent;
  }

  async prepare(
    transferId: string,
  ): Promise<{ transferId: string; state: 'target_prepared'; valid: boolean }> {
    const record = this.transfers.get(transferId);
    if (!record) throw new HttpException({ error: 'transfer_not_found' }, HttpStatus.NOT_FOUND);
    if (record.intent.state !== 'initiated') {
      throw new HttpException(
        { error: 'invalid_transfer_state', state: record.intent.state },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (calculateTransferManifestChecksum(record.manifest) !== record.intent.checksum) {
      throw new HttpException({ error: 'checksum_mismatch' }, HttpStatus.BAD_REQUEST);
    }
    try {
      await tryDispatchRemotePrepare({
        stateStore: this.stateStore,
        source: this.source,
        codec: this.getSnapshotCodec(),
        record,
      });
    } catch {
      // Deferred retry during HTTP commit if target is reachable then; allows in-process commit(id, targetManager).
    }

    record.intent = { ...record.intent, state: 'target_prepared' };
    await savePersistedTransferIntent(this.stateStore, record.intent);
    return { transferId, state: 'target_prepared', valid: true };
  }

  async fence(
    transferId: string,
  ): Promise<{ transferId: string; state: 'source_fenced'; fenced: boolean; epoch: number }> {
    const record = this.transfers.get(transferId);
    if (!record) throw new HttpException({ error: 'transfer_not_found' }, HttpStatus.NOT_FOUND);
    if (record.intent.state !== 'target_prepared') {
      throw new HttpException(
        { error: 'invalid_transfer_state', state: record.intent.state },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.leaseService?.stopAllLocalWorkloads(`transfer_fence:${transferId}`);
    this.fenced = true;
    record.intent = { ...record.intent, state: 'source_fenced', fencedAt: Date.now() };
    await this.stateStore?.saveState({ fenced: true, fencedReason: transferId, role: 'fenced' });
    await savePersistedTransferIntent(this.stateStore, record.intent);
    return { transferId, state: 'source_fenced', fenced: true, epoch: record.intent.epoch };
  }

  async commit(
    transferId: string,
    targetManager?: ClusterTransferManager,
  ): Promise<HubTransferCommitResultDto> {
    const record = this.transfers.get(transferId);
    if (!record) throw new HttpException({ error: 'transfer_not_found' }, HttpStatus.NOT_FOUND);
    if (record.intent.state !== 'source_fenced') {
      throw new HttpException(
        { error: 'invalid_transfer_state', state: record.intent.state },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (targetManager) {
      const credBundle = await this.getSnapshotCodec().exportCredentialBundle(
        record.manifest.preservePairing,
      );
      await targetManager.applyManifest(record.manifest);
      await targetManager.applyCredentialBundle(credBundle);
      await targetManager.promoteAfterIncomingTransfer({
        epoch: record.intent.epoch,
        newCoordinatorHubId: record.intent.targetHubId,
        previousCoordinatorHubId: record.intent.sourceHubId,
      });
    } else if (this.stateStore) {
      await dispatchRemoteTransferCommit({
        stateStore: this.stateStore,
        source: this.source,
        codec: this.getSnapshotCodec(),
        record,
      });
    }

    await this.transferLocalWorkloadsOwnership(
      record.intent.sourceHubId,
      record.intent.targetHubId,
      record.intent.epoch,
    );

    this.fenced = false;
    this.activeTransferId = undefined;
    this.roleOverride = 'node';
    this.coordinatorEpoch = record.intent.epoch;
    this.coordinatorIdOverride = record.intent.targetHubId;

    const targetUrl = await this.lookupNodeUrl(record.intent.targetHubId);
    await this.stateStore?.saveState({
      role: 'node',
      coordinatorEpoch: record.intent.epoch,
      coordinatorId: record.intent.targetHubId,
      ...(targetUrl ? { coordinatorUrl: targetUrl } : {}),
      fenced: false,
      fencedReason: undefined,
    });

    const completedAt = Date.now();
    record.intent = { ...record.intent, state: 'completed', completedAt };
    await savePersistedTransferIntent(this.stateStore, record.intent);
    return {
      transferId,
      state: 'completed',
      previousCoordinator: record.intent.sourceHubId,
      newCoordinator: record.intent.targetHubId,
      homeId: record.intent.homeId,
      epoch: record.intent.epoch,
      completedAt,
    };
  }

  private async transferLocalWorkloadsOwnership(
    sourceHubId: string,
    targetHubId: string,
    epoch: number,
  ): Promise<void> {
    await transferWorkloadsOwnership(this.stateStore, sourceHubId, targetHubId, epoch);
  }

  async rollback(transferId: string, reason?: string): Promise<HubTransferRollbackResultDto> {
    const record = this.transfers.get(transferId);
    if (!record) throw new HttpException({ error: 'transfer_not_found' }, HttpStatus.NOT_FOUND);
    if (record.intent.state === 'completed') {
      throw new HttpException(
        { error: 'cannot_rollback_completed_transfer' },
        HttpStatus.BAD_REQUEST,
      );
    }
    await dispatchRemoteTransferRollback({
      stateStore: this.stateStore,
      source: this.source,
      record,
      reason,
    }).catch(() => undefined);

    this.fenced = false;
    this.activeTransferId = undefined;
    await this.stateStore?.saveState({
      role: 'coordinator',
      fenced: false,
      fencedReason: undefined,
    });
    const rolledBackAt = Date.now();
    const rollbackReason = reason ?? 'admin_cancellation';
    record.intent = { ...record.intent, state: 'rolled_back', rolledBackAt, rollbackReason };
    await savePersistedTransferIntent(this.stateStore, record.intent);
    return {
      transferId,
      state: 'rolled_back',
      restoredCoordinator: record.intent.sourceHubId,
      reason: rollbackReason,
      rolledBackAt,
    };
  }

  getTransfer(transferId: string): HubTransferIntentDto {
    const record = this.transfers.get(transferId);
    if (!record) throw new HttpException({ error: 'transfer_not_found' }, HttpStatus.NOT_FOUND);
    return record.intent;
  }

  listTransfers(): HubTransferIntentDto[] {
    return Array.from(this.transfers.values()).map((r) => r.intent);
  }

  setCoordinatorEpoch(epoch: number): void {
    this.coordinatorEpoch = epoch;
  }
  setRoleOverride(role: 'coordinator' | 'node'): void {
    this.roleOverride = role;
  }
  setCoordinatorIdOverride(id: string): void {
    this.coordinatorIdOverride = id;
  }

  async applyCredentialBundle(bundle: CredentialBundlePayload): Promise<void> {
    await this.getSnapshotCodec().applyCredentialBundle(bundle);
  }

  async promoteAfterIncomingTransfer(params: {
    readonly epoch: number;
    readonly newCoordinatorHubId: string;
    readonly previousCoordinatorHubId: string;
  }): Promise<void> {
    this.coordinatorEpoch = Math.max(this.coordinatorEpoch, params.epoch);
    this.roleOverride = 'coordinator';
    this.coordinatorIdOverride = params.newCoordinatorHubId;
    this.fenced = false;
    if (this.stateStore) {
      await this.stateStore.saveState({
        role: 'coordinator',
        coordinatorEpoch: this.coordinatorEpoch,
        coordinatorId: params.newCoordinatorHubId,
        fenced: false,
        fencedReason: undefined,
      });
      await this.transferLocalWorkloadsOwnership(
        params.previousCoordinatorHubId,
        params.newCoordinatorHubId,
        this.coordinatorEpoch,
      );
      await this.authService?.loadPersistedSessions();
    }
  }

  async receiveIncomingPrepare(params: {
    readonly senderHubId: string;
    readonly payload: RemoteTransferPreparePayload;
  }): Promise<{ readonly prepared: boolean; readonly transferId: string }> {
    return handleIncomingTransferPrepare({
      stateStore: this.stateStore,
      incomingPrepared: this.incomingPrepared,
      senderHubId: params.senderHubId,
      payload: params.payload,
    });
  }

  async receiveIncomingCommit(params: {
    readonly senderHubId: string;
    readonly payload: RemoteTransferCommitPayload;
  }): Promise<{
    readonly committed: boolean;
    readonly transferId: string;
    readonly epoch: number;
  }> {
    const result = await handleIncomingTransferCommit({
      stateStore: this.stateStore,
      incomingPrepared: this.incomingPrepared,
      transferReplayGuard: this.transferReplayGuard,
      senderHubId: params.senderHubId,
      payload: params.payload,
      applyManifest: (manifest) => this.applyManifest(manifest),
      applyCredentialBundle: (bundle) => this.applyCredentialBundle(bundle),
      promoteAfterIncomingTransfer: (args) => this.promoteAfterIncomingTransfer(args),
    });
    await this.syncService?.notifySnapshotApplied();
    return result;
  }

  receiveIncomingRollback(params: {
    readonly senderHubId: string;
    readonly payload: RemoteTransferRollbackPayload;
  }): { readonly rolledBack: boolean; readonly transferId: string } {
    return handleIncomingTransferRollback({
      incomingPrepared: this.incomingPrepared,
      senderHubId: params.senderHubId,
      payload: params.payload,
    });
  }

  async applyManifest(manifest: HubTransferManifest): Promise<void> {
    await applyHubTransferManifest(this.transactions, manifest);
  }
}
