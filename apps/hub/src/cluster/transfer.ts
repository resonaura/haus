/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Inject, Injectable, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { CATALOG_SOURCE, CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import {
  BackupEntity,
  ClusterLocationEntity,
  ClusterMediaEntity,
  ClusterNodeEntity,
  HomeKitIdentityEntity,
  SharedConfigEntity,
  type BackupRow,
  type ClusterLocationRow,
  type ClusterMediaRow,
  type HomeKitIdentityRow,
  type SharedConfigRow,
} from '../storage/entities/domains.js';
import {
  ClientSessionEntity,
  StandaloneHomeEntryEntity,
  type ClientSessionRow,
  type StandaloneHomeEntryRow,
} from '../storage/standalone/entities.js';
import { HUB_AUTH_SERVICE } from '../auth/tokens.js';
import { HubAuthService } from '../auth/service.js';
import type {
  HubTransferCommitResultDto,
  HubTransferIntentDto,
  HubTransferRollbackResultDto,
  InitiateTransferDto,
  TransferSummaryDto,
} from './transfer.dto.js';

export const CLUSTER_TRANSFER_MANAGER = 'CLUSTER_TRANSFER_MANAGER';

export interface HubTransferManifest {
  readonly version: 1;
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly epoch: number;
  readonly timestamp: number;
  readonly preservePairing: boolean;
  readonly preferences: SharedConfigRow[];
  readonly homeEntries: StandaloneHomeEntryRow[];
  readonly homekitIdentities: HomeKitIdentityRow[];
  readonly clusterLocations: ClusterLocationRow[];
  readonly clusterMedia: ClusterMediaRow[];
  readonly backups: BackupRow[];
  readonly sessions: ClientSessionRow[];
}

interface InternalTransferRecord {
  intent: HubTransferIntentDto;
  manifest: HubTransferManifest;
}

@Injectable()
export class ClusterTransferManager {
  private readonly transfers = new Map<string, InternalTransferRecord>();
  private fenced = false;
  private activeTransferId?: string;
  private coordinatorEpoch = 1;
  private coordinatorIdOverride?: string;
  private roleOverride?: 'coordinator' | 'node';

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
  ) {}

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

  async initiate(dto: InitiateTransferDto): Promise<HubTransferIntentDto> {
    this.assertNotFenced();
    if (this.activeTransferId) {
      const active = this.transfers.get(this.activeTransferId);
      if (
        active &&
        (active.intent.state === 'initiated' ||
          active.intent.state === 'target_prepared' ||
          active.intent.state === 'source_fenced')
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

    // Collect complete household state for transfer
    const manifest = await this.collectManifest(
      transferId,
      homeId,
      sourceHubId,
      dto.targetHubId,
      nextEpoch,
      preservePairing,
    );

    const checksum = this.calculateChecksum(manifest);
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

    // Verify manifest checksum integrity
    const computed = this.calculateChecksum(record.manifest);
    if (computed !== record.intent.checksum) {
      throw new HttpException({ error: 'checksum_mismatch' }, HttpStatus.BAD_REQUEST);
    }

    record.intent = {
      ...record.intent,
      state: 'target_prepared',
    };
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

    // Enter fenced mode: all write mutations on source coordinator are now prohibited
    this.fenced = true;
    record.intent = {
      ...record.intent,
      state: 'source_fenced',
      fencedAt: Date.now(),
    };
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

    // 1. Target applies manifest into its TypeORM database
    if (targetManager) {
      await targetManager.applyManifest(record.manifest);
      targetManager.setCoordinatorEpoch(record.intent.epoch);
      targetManager.setRoleOverride('coordinator');
      targetManager.setCoordinatorIdOverride(record.intent.targetHubId);
    }

    // 2. Source Hub demotes to secondary node
    this.fenced = false;
    this.activeTransferId = undefined;
    this.roleOverride = 'node';
    this.coordinatorEpoch = record.intent.epoch;
    this.coordinatorIdOverride = record.intent.targetHubId;

    const completedAt = Date.now();
    record.intent = {
      ...record.intent,
      state: 'completed',
      completedAt,
    };

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

  async rollback(transferId: string, reason?: string): Promise<HubTransferRollbackResultDto> {
    const record = this.transfers.get(transferId);
    if (!record) throw new HttpException({ error: 'transfer_not_found' }, HttpStatus.NOT_FOUND);
    if (record.intent.state === 'completed') {
      throw new HttpException(
        { error: 'cannot_rollback_completed_transfer' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Restore source coordinator
    this.fenced = false;
    this.activeTransferId = undefined;
    const rolledBackAt = Date.now();
    const rollbackReason = reason ?? 'admin_cancellation';

    record.intent = {
      ...record.intent,
      state: 'rolled_back',
      rolledBackAt,
      rollbackReason,
    };

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

  async applyManifest(manifest: HubTransferManifest): Promise<void> {
    if (!this.transactions) return;

    await this.transactions.run(async (manager) => {
      // 1. Shared preferences
      for (const pref of manifest.preferences) {
        await manager.upsert(SharedConfigEntity, pref, ['id']);
      }

      // 2. Devices, automations, scenes, scripts, states
      for (const entry of manifest.homeEntries) {
        await manager.upsert(StandaloneHomeEntryEntity, entry, ['kind', 'entryId']);
      }

      // 3. HomeKit identities & pairing keys
      if (manifest.preservePairing) {
        for (const hk of manifest.homekitIdentities) {
          await manager.upsert(HomeKitIdentityEntity, hk, ['cameraId']);
        }
      }

      // 4. Recording archive locations & media
      for (const loc of manifest.clusterLocations) {
        await manager.upsert(ClusterLocationEntity, loc, ['digest', 'nodeId']);
      }
      for (const med of manifest.clusterMedia) {
        await manager.upsert(ClusterMediaEntity, med, ['eventId']);
      }
      for (const b of manifest.backups) {
        await manager.upsert(BackupEntity, b, ['digest']);
      }

      // 5. Client sessions (resumed admin sessions)
      for (const s of manifest.sessions) {
        await manager.upsert(ClientSessionEntity, s, ['sessionId']);
      }

      // 6. Cluster topology: update previous coordinator to node, set new coordinator
      await manager.upsert(
        ClusterNodeEntity,
        {
          id: manifest.sourceHubId,
          value: JSON.stringify({
            id: manifest.sourceHubId,
            name: `Hub ${manifest.sourceHubId.slice(0, 6)}`,
            url: 'http://127.0.0.1:8790',
            enabled: true,
            roles: ['storage', 'stream'],
            online: true,
            homeId: manifest.homeId,
          }),
        },
        ['id'],
      );
    });
  }

  private async collectManifest(
    transferId: string,
    homeId: string,
    sourceHubId: string,
    targetHubId: string,
    epoch: number,
    preservePairing: boolean,
  ): Promise<HubTransferManifest> {
    const preferences: SharedConfigRow[] = [];
    const homeEntries: StandaloneHomeEntryRow[] = [];
    const homekitIdentities: HomeKitIdentityRow[] = [];
    const clusterLocations: ClusterLocationRow[] = [];
    const clusterMedia: ClusterMediaRow[] = [];
    const backups: BackupRow[] = [];
    const sessions: ClientSessionRow[] = [];

    if (this.source) {
      preferences.push(...(await this.source.manager.find(SharedConfigEntity)));
      homeEntries.push(...(await this.source.manager.find(StandaloneHomeEntryEntity)));
      if (preservePairing) {
        homekitIdentities.push(...(await this.source.manager.find(HomeKitIdentityEntity)));
      }
      clusterLocations.push(...(await this.source.manager.find(ClusterLocationEntity)));
      clusterMedia.push(...(await this.source.manager.find(ClusterMediaEntity)));
      backups.push(...(await this.source.manager.find(BackupEntity)));
      sessions.push(...(await this.source.manager.find(ClientSessionEntity)));
    }

    return {
      version: 1,
      transferId,
      homeId,
      sourceHubId,
      targetHubId,
      epoch,
      timestamp: Date.now(),
      preservePairing,
      preferences,
      homeEntries,
      homekitIdentities,
      clusterLocations,
      clusterMedia,
      backups,
      sessions,
    };
  }

  private calculateChecksum(manifest: HubTransferManifest): string {
    const str = JSON.stringify({
      version: manifest.version,
      transferId: manifest.transferId,
      homeId: manifest.homeId,
      sourceHubId: manifest.sourceHubId,
      targetHubId: manifest.targetHubId,
      epoch: manifest.epoch,
      preservePairing: manifest.preservePairing,
      preferences: manifest.preferences,
      homeEntries: manifest.homeEntries,
      homekitIdentities: manifest.homekitIdentities,
      clusterLocations: manifest.clusterLocations,
      clusterMedia: manifest.clusterMedia,
      backups: manifest.backups,
      sessions: manifest.sessions,
    });
    return createHash('sha256').update(str).digest('hex');
  }
}
