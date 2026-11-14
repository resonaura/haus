/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DataSource } from 'typeorm';
import type { Transactions } from '../../storage/transactions.js';
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
} from '../../storage/entities/domains.js';
import {
  ClientSessionEntity,
  StandaloneHomeEntryEntity,
  type ClientSessionRow,
  type StandaloneHomeEntryRow,
} from '../../storage/standalone/entities.js';
import type { ClusterTransferRow } from '../../storage/cluster/entities.js';
import type { ClusterStateStore } from '../coordination/state.js';
import type { HubTransferIntentDto, TransferState, TransferSummaryDto } from '../transfer.dto.js';
import type { HubTransferManifest } from './remote.js';

const SECRET_ENTRY_KINDS = new Set([
  'tuya_credentials',
  'ha_app_credential',
  'ha_entry_runtime',
  'network_credentials',
]);

export async function collectHubTransferManifest(params: {
  readonly source?: DataSource;
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly epoch: number;
  readonly preservePairing: boolean;
}): Promise<HubTransferManifest> {
  const preferences: SharedConfigRow[] = [];
  const homeEntries: StandaloneHomeEntryRow[] = [];
  const homekitIdentities: HomeKitIdentityRow[] = [];
  const clusterLocations: ClusterLocationRow[] = [];
  const clusterMedia: ClusterMediaRow[] = [];
  const backups: BackupRow[] = [];
  const sessions: ClientSessionRow[] = [];

  if (params.source) {
    preferences.push(...(await params.source.manager.find(SharedConfigEntity)));
    const allHome = await params.source.manager.find(StandaloneHomeEntryEntity);
    // Exclude encrypted secret rows from raw transfer manifest; they travel re-sealed via E2EE envelopes.
    homeEntries.push(...allHome.filter((row) => !SECRET_ENTRY_KINDS.has(row.kind)));
    if (params.preservePairing) {
      homekitIdentities.push(...(await params.source.manager.find(HomeKitIdentityEntity)));
    }
    clusterLocations.push(...(await params.source.manager.find(ClusterLocationEntity)));
    clusterMedia.push(...(await params.source.manager.find(ClusterMediaEntity)));
    backups.push(...(await params.source.manager.find(BackupEntity)));
    sessions.push(...(await params.source.manager.find(ClientSessionEntity)));
  }

  return {
    version: 1,
    transferId: params.transferId,
    homeId: params.homeId,
    sourceHubId: params.sourceHubId,
    targetHubId: params.targetHubId,
    epoch: params.epoch,
    timestamp: Date.now(),
    preservePairing: params.preservePairing,
    preferences,
    homeEntries,
    homekitIdentities,
    clusterLocations,
    clusterMedia,
    backups,
    sessions,
  };
}

export async function applyHubTransferManifest(
  transactions: Transactions | undefined,
  manifest: HubTransferManifest,
): Promise<void> {
  if (!transactions) return;
  await transactions.run(async (manager) => {
    for (const pref of manifest.preferences) {
      await manager.upsert(SharedConfigEntity, pref, ['id']);
    }
    for (const entry of manifest.homeEntries) {
      await manager.upsert(StandaloneHomeEntryEntity, entry, ['kind', 'entryId']);
    }
    if (manifest.preservePairing) {
      for (const hk of manifest.homekitIdentities) {
        await manager.upsert(HomeKitIdentityEntity, hk, ['cameraId']);
      }
    }
    for (const loc of manifest.clusterLocations) {
      await manager.upsert(ClusterLocationEntity, loc, ['digest', 'nodeId']);
    }
    for (const med of manifest.clusterMedia) {
      await manager.upsert(ClusterMediaEntity, med, ['eventId']);
    }
    for (const b of manifest.backups) {
      await manager.upsert(BackupEntity, b, ['digest']);
    }
    for (const s of manifest.sessions) {
      await manager.upsert(ClientSessionEntity, s, ['sessionId']);
    }
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

export function decodePersistedTransfers(
  stateStore: ClusterStateStore,
  homeId: string,
): Array<{ intent: HubTransferIntentDto; manifest: HubTransferManifest }> {
  return stateStore.listTransfersSync().map((row) => {
    let summary: TransferSummaryDto = {
      devicesCount: 0,
      endpointStatesCount: 0,
      scenesCount: 0,
      scriptsCount: 0,
      automationsCount: 0,
      archivesCount: 0,
      preservePairing: row.preservePairing,
    };
    try {
      summary = JSON.parse(row.summaryJson) as TransferSummaryDto;
    } catch {
      // Preserve fallback summary.
    }
    const intent: HubTransferIntentDto = {
      transferId: row.transferId,
      homeId,
      sourceHubId: row.sourceHubId,
      targetHubId: row.targetHubId,
      epoch: row.epoch,
      checksum: '',
      state: row.state as TransferState,
      summary,
      createdAt: row.createdAt,
      ...(row.reason ? { rollbackReason: row.reason } : {}),
    };
    const manifest: HubTransferManifest = {
      version: 1,
      transferId: row.transferId,
      homeId,
      sourceHubId: row.sourceHubId,
      targetHubId: row.targetHubId,
      epoch: row.epoch,
      timestamp: row.createdAt,
      preservePairing: row.preservePairing,
      preferences: [],
      homeEntries: [],
      homekitIdentities: [],
      clusterLocations: [],
      clusterMedia: [],
      backups: [],
      sessions: [],
    };
    return { intent, manifest };
  });
}

export async function savePersistedTransferIntent(
  stateStore: ClusterStateStore | undefined,
  intent: HubTransferIntentDto,
): Promise<void> {
  if (!stateStore) return;
  const row: ClusterTransferRow = {
    transferId: intent.transferId,
    sourceHubId: intent.sourceHubId,
    targetHubId: intent.targetHubId,
    state: intent.state,
    epoch: intent.epoch,
    preservePairing: intent.summary.preservePairing,
    summaryJson: JSON.stringify(intent.summary),
    reason: intent.rollbackReason ?? null,
    createdAt: intent.createdAt,
    updatedAt: Date.now(),
  };
  await stateStore.saveTransfer(row);
}
