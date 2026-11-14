/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { In, Not } from 'typeorm';
import type { Transactions } from '../../storage/transactions.js';
import { CATALOG_TRANSACTIONS } from '../../storage/storage.module.js';
import { ClusterNodeEntity, HomeKitIdentityEntity } from '../../storage/entities/domains.js';
import { StandaloneHomeEntryEntity } from '../../storage/standalone/entities.js';
import {
  ClusterPeerKeyEntity,
  ClusterStateEntity,
  ClusterSyncStateEntity,
  ClusterTransferEntity,
  ClusterWorkloadEntity,
  type ClusterPeerKeyRow,
  type ClusterStateRow,
  type ClusterSyncStateRow,
  type ClusterTransferRow,
  type ClusterWorkloadRow,
} from '../../storage/cluster/entities.js';
import { ClusterCryptoIdentity, type ClusterPublicIdentity } from '../crypto/identity.js';
import {
  HUB_DATA_DIRECTORY,
  openLocalSecret,
  resolveOrProvisionMasterKey,
  sealLocalSecret,
} from '../crypto/master-key.js';
import type { PeerTrustRecord } from '../crypto/transport.js';

export type PersistentClusterRole = 'coordinator' | 'node' | 'standalone' | 'fenced';

export interface PersistentClusterState {
  readonly hubId: string;
  readonly homeId: string;
  readonly role: PersistentClusterRole;
  readonly coordinatorEpoch: number;
  readonly coordinatorId: string;
  readonly coordinatorUrl?: string;
  readonly fenced: boolean;
  readonly fencedReason?: string;
  readonly updatedAt: number;
}

@Injectable()
export class ClusterStateStore {
  private readonly masterKey: Buffer;
  private identity?: ClusterCryptoIdentity;
  private initPromise?: Promise<void>;
  private loaded = false;

  private memState: PersistentClusterState = {
    hubId: 'hub-standalone-01',
    homeId: 'home-default',
    role: 'coordinator',
    coordinatorEpoch: 1,
    coordinatorId: 'hub-standalone-01',
    fenced: false,
    updatedAt: Date.now(),
  };
  private readonly memPeers = new Map<string, ClusterPeerKeyRow>();
  private readonly memWorkloads = new Map<string, ClusterWorkloadRow>();
  private readonly memTransfers = new Map<string, ClusterTransferRow>();
  private readonly memSyncStates = new Map<string, ClusterSyncStateRow>();
  private decommissionHook?: (localHubId: string) => void;

  constructor(
    @Optional() @Inject(CATALOG_TRANSACTIONS) private readonly transactions?: Transactions,
    @Optional() @Inject(HUB_DATA_DIRECTORY) private readonly dataDir?: string,
  ) {
    this.masterKey = resolveOrProvisionMasterKey({ dataDir });
  }

  getMasterKey(): Buffer {
    return Buffer.from(this.masterKey);
  }

  async ensureInitialized(defaults?: {
    readonly hubId: string;
    readonly homeId: string;
    readonly hubUrl?: string;
  }): Promise<PersistentClusterState> {
    if (defaults) {
      if (!this.identity || this.identity.hubId !== defaults.hubId) {
        this.identity = ClusterCryptoIdentity.loadOrCreate(defaults.hubId, this.dataDir);
      }
      if (!this.transactions && this.memState.hubId === 'hub-standalone-01' && defaults.hubId) {
        this.memState = {
          ...this.memState,
          hubId: defaults.hubId,
          homeId: defaults.homeId,
          coordinatorId:
            this.memState.role === 'coordinator' || this.memState.role === 'standalone'
              ? defaults.hubId
              : this.memState.coordinatorId,
        };
      }
    }
    this.initPromise ??= this.loadFromDb(defaults);
    await this.initPromise;
    return this.getStateSync();
  }

  getIdentitySync(fallbackHubId = this.memState.hubId): ClusterCryptoIdentity {
    if (!this.identity || this.identity.hubId !== fallbackHubId) {
      this.identity = ClusterCryptoIdentity.loadOrCreate(fallbackHubId, this.dataDir);
    }
    return this.identity;
  }

  getStateSync(): PersistentClusterState {
    return { ...this.memState };
  }

  private async loadFromDb(defaults?: {
    readonly hubId: string;
    readonly homeId: string;
    readonly hubUrl?: string;
  }): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.transactions) return;

    await this.transactions.run(async (manager) => {
      const existing = await manager.findOneBy(ClusterStateEntity, { id: 1 });
      if (existing) {
        this.memState = this.rowToState(existing);
      } else {
        const now = Date.now();
        const hubId = defaults?.hubId ?? this.memState.hubId;
        const homeId = defaults?.homeId ?? this.memState.homeId;
        const initial: ClusterStateRow = {
          id: 1,
          hubId,
          homeId,
          role: 'coordinator',
          coordinatorEpoch: 1,
          coordinatorId: hubId,
          coordinatorUrl: defaults?.hubUrl ?? null,
          fenced: false,
          fencedReason: null,
          updatedAt: now,
        };
        await manager.upsert(ClusterStateEntity, initial, ['id']);
        this.memState = this.rowToState(initial);
      }

      for (const peer of await manager.find(ClusterPeerKeyEntity)) {
        this.memPeers.set(peer.hubId, peer);
      }
      for (const workload of await manager.find(ClusterWorkloadEntity)) {
        this.memWorkloads.set(workload.workloadId, workload);
      }
      for (const transfer of await manager.find(ClusterTransferEntity)) {
        this.memTransfers.set(transfer.transferId, transfer);
      }
      for (const syncRow of await manager.find(ClusterSyncStateEntity)) {
        this.memSyncStates.set(syncRow.syncKey, syncRow);
      }
    });
    if (!this.identity || this.identity.hubId !== this.memState.hubId) {
      this.identity = ClusterCryptoIdentity.loadOrCreate(this.memState.hubId, this.dataDir);
    }
  }

  private rowToState(row: ClusterStateRow): PersistentClusterState {
    const role = (
      ['coordinator', 'node', 'standalone', 'fenced'].includes(row.role) ? row.role : 'coordinator'
    ) as PersistentClusterRole;
    return {
      hubId: row.hubId,
      homeId: row.homeId,
      role,
      coordinatorEpoch: row.coordinatorEpoch,
      coordinatorId: row.coordinatorId,
      ...(row.coordinatorUrl ? { coordinatorUrl: row.coordinatorUrl } : {}),
      fenced: Boolean(row.fenced),
      ...(row.fencedReason ? { fencedReason: row.fencedReason } : {}),
      updatedAt: row.updatedAt,
    };
  }

  async saveState(patch: Partial<PersistentClusterState>): Promise<PersistentClusterState> {
    await this.ensureInitialized();
    const next: PersistentClusterState = {
      ...this.memState,
      ...patch,
      updatedAt: Date.now(),
    };
    this.memState = next;
    if (this.transactions) {
      const row: ClusterStateRow = {
        id: 1,
        hubId: next.hubId,
        homeId: next.homeId,
        role: next.role,
        coordinatorEpoch: next.coordinatorEpoch,
        coordinatorId: next.coordinatorId,
        coordinatorUrl: next.coordinatorUrl ?? null,
        fenced: next.fenced,
        fencedReason: next.fencedReason ?? null,
        updatedAt: next.updatedAt,
      };
      await this.transactions.run(async (manager) => {
        await manager.upsert(ClusterStateEntity, row, ['id']);
      });
    }
    return this.getStateSync();
  }

  async upsertPeerTrust(params: {
    readonly hubId: string;
    readonly homeId: string;
    readonly publicIdentity: ClusterPublicIdentity;
    readonly channelSecret?: string;
    readonly revoked?: boolean;
  }): Promise<{ readonly row: ClusterPeerKeyRow; readonly plainChannelSecret: string }> {
    await this.ensureInitialized();
    if (!ClusterCryptoIdentity.validatePeerPublicIdentity(params.publicIdentity)) {
      throw Error('invalid_peer_public_identity');
    }
    const existing = this.memPeers.get(params.hubId);
    const plainChannelSecret =
      params.channelSecret ??
      (existing ? this.decryptChannelSecret(existing) : undefined) ??
      randomBytes(32).toString('hex');
    const aad = `peer-secret:${params.homeId}:${params.hubId}`;
    const row: ClusterPeerKeyRow = {
      hubId: params.hubId,
      homeId: params.homeId,
      signingPublicKey: params.publicIdentity.signingPublicKey,
      exchangePublicKey: params.publicIdentity.exchangePublicKey,
      channelSecretEnc: sealLocalSecret(
        this.masterKey,
        aad,
        Buffer.from(plainChannelSecret, 'utf8'),
      ),
      keyVersion: (existing?.keyVersion ?? 0) + 1,
      revoked: params.revoked ?? false,
      updatedAt: Date.now(),
    };
    this.memPeers.set(params.hubId, row);
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.upsert(ClusterPeerKeyEntity, row, ['hubId']);
      });
    }
    return { row, plainChannelSecret };
  }

  async revokePeer(hubId: string): Promise<void> {
    await this.ensureInitialized();
    const existing = this.memPeers.get(hubId);
    if (existing) {
      const revokedRow: ClusterPeerKeyRow = {
        ...existing,
        revoked: true,
        updatedAt: Date.now(),
      };
      this.memPeers.set(hubId, revokedRow);
      if (this.transactions) {
        await this.transactions.run(async (manager) => {
          await manager.upsert(ClusterPeerKeyEntity, revokedRow, ['hubId']);
        });
      }
    }
  }

  getPeerPublic(hubId: string): ClusterPublicIdentity | undefined {
    const row = this.memPeers.get(hubId);
    if (!row || row.revoked) return undefined;
    return {
      hubId: row.hubId,
      signingPublicKey: row.signingPublicKey,
      exchangePublicKey: row.exchangePublicKey,
      keyFingerprint: '',
    };
  }

  getPeerTrustRecord(
    hubId: string,
  ): (PeerTrustRecord & { readonly exchangePublicKey: string }) | undefined {
    const row = this.memPeers.get(hubId);
    if (!row) return undefined;
    return {
      hubId: row.hubId,
      homeId: row.homeId,
      signingPublicKey: row.signingPublicKey,
      exchangePublicKey: row.exchangePublicKey,
      channelSecret: this.decryptChannelSecret(row),
      revoked: Boolean(row.revoked),
    };
  }

  listTrustedPeers(): Array<PeerTrustRecord & { readonly exchangePublicKey: string }> {
    const out: Array<PeerTrustRecord & { readonly exchangePublicKey: string }> = [];
    for (const row of this.memPeers.values()) {
      if (row.revoked) continue;
      out.push({
        hubId: row.hubId,
        homeId: row.homeId,
        signingPublicKey: row.signingPublicKey,
        exchangePublicKey: row.exchangePublicKey,
        channelSecret: this.decryptChannelSecret(row),
        revoked: false,
      });
    }
    return out;
  }

  private decryptChannelSecret(row: ClusterPeerKeyRow): string | undefined {
    try {
      const aad = `peer-secret:${row.homeId}:${row.hubId}`;
      return openLocalSecret(this.masterKey, aad, row.channelSecretEnc).toString('utf8');
    } catch {
      return undefined;
    }
  }

  listWorkloadsSync(): ClusterWorkloadRow[] {
    return Array.from(this.memWorkloads.values());
  }

  getWorkloadSync(workloadId: string): ClusterWorkloadRow | undefined {
    return this.memWorkloads.get(workloadId);
  }

  async saveWorkload(row: ClusterWorkloadRow): Promise<ClusterWorkloadRow> {
    await this.ensureInitialized();
    this.memWorkloads.set(row.workloadId, row);
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.upsert(ClusterWorkloadEntity, row, ['workloadId']);
      });
    }
    return row;
  }

  async deleteWorkload(workloadId: string): Promise<void> {
    await this.ensureInitialized();
    this.memWorkloads.delete(workloadId);
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.delete(ClusterWorkloadEntity, { workloadId });
      });
    }
  }

  listTransfersSync(): ClusterTransferRow[] {
    return Array.from(this.memTransfers.values());
  }

  getTransferSync(transferId: string): ClusterTransferRow | undefined {
    return this.memTransfers.get(transferId);
  }

  async saveTransfer(row: ClusterTransferRow): Promise<ClusterTransferRow> {
    await this.ensureInitialized();
    this.memTransfers.set(row.transferId, row);
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.upsert(ClusterTransferEntity, row, ['transferId']);
      });
    }
    return row;
  }

  getSyncState(syncKey: string): ClusterSyncStateRow | undefined {
    return this.memSyncStates.get(syncKey);
  }

  listSyncStates(): ClusterSyncStateRow[] {
    return Array.from(this.memSyncStates.values());
  }

  async saveSyncState(row: ClusterSyncStateRow): Promise<ClusterSyncStateRow> {
    await this.ensureInitialized();
    this.memSyncStates.set(row.syncKey, row);
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.upsert(ClusterSyncStateEntity, row, ['syncKey']);
      });
    }
    return row;
  }

  setDecommissionHook(hook: (localHubId: string) => void): void {
    this.decommissionHook = hook;
  }

  async clearClusterPeersAndSync(options?: { readonly wipeSecrets?: boolean }): Promise<void> {
    await this.ensureInitialized();
    const wipeSecrets = options?.wipeSecrets ?? false;
    this.memPeers.clear();
    this.memSyncStates.clear();
    if (wipeSecrets) {
      this.memWorkloads.clear();
      this.memTransfers.clear();
    }
    if (this.transactions) {
      await this.transactions.run(async (manager) => {
        await manager.clear(ClusterPeerKeyEntity);
        await manager.clear(ClusterSyncStateEntity);
        if (wipeSecrets) {
          await manager.clear(ClusterWorkloadEntity);
          await manager.clear(ClusterTransferEntity);
          await manager.clear(HomeKitIdentityEntity);
          await manager.delete(ClusterNodeEntity, { id: Not(this.memState.hubId) });
          await manager.delete(StandaloneHomeEntryEntity, {
            kind: In([
              'tuya_credentials',
              'ha_app_credential',
              'ha_entry_runtime',
              'network_credentials',
              'homekit_pairing',
            ]),
          });
        }
      });
    }
    if (wipeSecrets) {
      this.decommissionHook?.(this.memState.hubId);
    }
  }
}
