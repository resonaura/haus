/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { In } from 'typeorm';
import type { Transactions } from '../../storage/transactions.js';
import {
  ClientSessionEntity,
  StandaloneHomeEntryEntity,
  type ClientSessionRow,
  type StandaloneHomeEntryRow,
} from '../../storage/standalone/entities.js';
import {
  BackupEntity,
  ClusterMediaEntity,
  HomeKitIdentityEntity,
  SharedConfigEntity,
} from '../../storage/entities/domains.js';
import { ClusterWorkloadEntity } from '../../storage/cluster/entities.js';
import { AesGcmCredentialCipher } from '../../commissioning/credentials.service.js';
import { sha256Hex } from '../crypto/transport.js';
import {
  reconcileConfigTombstones,
  TOMBSTONE_RETENTION_MS,
} from '../../storage/standalone/tombstones.js';
import { boundHistoryRowsForSync, filterFreshRows, pruneDeletedConfigRows } from './merge.js';
import { normalizeReplicatedConfigEntries } from './reconcile-rows.js';

export interface DecryptedCredentialItem {
  readonly kind:
    'tuya_credentials' | 'ha_app_credential' | 'ha_entry_runtime' | 'network_credentials';
  readonly entryId: string;
  readonly updatedAt: number;
  readonly payload: unknown;
}

export interface DecryptedHomeKitIdentityItem {
  readonly cameraId: string;
  readonly value: string;
}

export interface CredentialBundlePayload {
  readonly credentials: readonly DecryptedCredentialItem[];
  readonly homekitIdentities: readonly DecryptedHomeKitIdentityItem[];
  readonly sessions?: readonly ClientSessionRow[];
}

export interface ConfigBundlePayload {
  readonly entries: readonly StandaloneHomeEntryRow[];
  readonly tombstones?: readonly StandaloneHomeEntryRow[];
  readonly sharedConfig?: {
    readonly id: number;
    readonly revision: string;
    readonly value: string;
    readonly updatedAt: number;
  };
}

export interface CacheBundlePayload {
  readonly endpointStates: readonly StandaloneHomeEntryRow[];
  readonly endpointHistory: readonly StandaloneHomeEntryRow[];
  readonly mediaDescriptors: readonly {
    readonly eventId: string;
    readonly digest: string;
    readonly bytes: number;
    readonly version: number;
  }[];
  readonly backupDescriptors: readonly {
    readonly digest: string;
    readonly kind: string;
    readonly createdAt: number;
    readonly bytes: number;
    readonly haSlug: string | null;
    readonly archiveGeneration: number | null;
  }[];
}

const SECRET_KINDS = new Set([
  'tuya_credentials',
  'ha_app_credential',
  'ha_entry_runtime',
  'network_credentials',
]);

const CONFIG_KINDS = new Set([
  'room',
  'device',
  'device_alias',
  'scene',
  'script',
  'automation',
  'app',
  'ignored_matter_node',
  'integration_entry',
  'repair_issue',
]);

const CACHE_KINDS = new Set(['endpoint_state', 'endpoint_history']);
const SECRET_KIND_LIST = [...SECRET_KINDS];
const CONFIG_KIND_LIST = [...CONFIG_KINDS];

/**
 * Exports and applies home credentials, configurations, and caches with strict cipher isolation:
 * secrets are decrypted under the sender master key inside memory only when building an E2EE envelope,
 * and re-sealed under the receiver's own master key upon application.
 */
export class ClusterSnapshotCodec {
  private readonly localCipher: AesGcmCredentialCipher;
  private readonly historyTrimCache = new Map<
    string,
    { updatedAt: number; row: StandaloneHomeEntryRow | undefined }
  >();

  constructor(
    private readonly transactions?: Transactions,
    dataDir?: string,
  ) {
    this.localCipher = new AesGcmCredentialCipher(undefined, { dataDir });
  }

  async exportCredentialBundle(includeHomeKit = true): Promise<CredentialBundlePayload> {
    if (!this.transactions) return { credentials: [], homekitIdentities: [] };
    return this.transactions.read(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        where: { kind: In(SECRET_KIND_LIST) },
      });
      const credentials: DecryptedCredentialItem[] = [];

      for (const row of rows) {
        if (!SECRET_KINDS.has(row.kind)) continue;
        try {
          const parsed = JSON.parse(row.value) as Record<string, unknown>;
          if (row.kind === 'tuya_credentials' || row.kind === 'network_credentials') {
            if (typeof parsed.encrypted !== 'string') continue;
            const plain = Buffer.from(await this.localCipher.decrypt(parsed.encrypted)).toString(
              'utf8',
            );
            credentials.push({
              kind: row.kind,
              entryId: row.entryId,
              updatedAt: row.updatedAt,
              payload: JSON.parse(plain) as unknown,
            });
          } else if (row.kind === 'ha_app_credential') {
            const clientSecret =
              typeof parsed.encryptedSecret === 'string'
                ? Buffer.from(await this.localCipher.decrypt(parsed.encryptedSecret)).toString(
                    'utf8',
                  )
                : undefined;
            credentials.push({
              kind: 'ha_app_credential',
              entryId: row.entryId,
              updatedAt: row.updatedAt,
              payload: {
                domain: parsed.domain,
                clientId: parsed.clientId,
                ...(clientSecret !== undefined ? { clientSecret } : {}),
                ...(parsed.name !== undefined ? { name: parsed.name } : {}),
                ...(parsed.authDomain !== undefined ? { authDomain: parsed.authDomain } : {}),
                createdAt: parsed.createdAt,
              },
            });
          } else if (row.kind === 'ha_entry_runtime') {
            if (typeof parsed.encryptedJson !== 'string') continue;
            const plain = Buffer.from(
              await this.localCipher.decrypt(parsed.encryptedJson),
            ).toString('utf8');
            credentials.push({
              kind: 'ha_entry_runtime',
              entryId: row.entryId,
              updatedAt: row.updatedAt,
              payload: {
                entryId: parsed.entryId,
                runtime: JSON.parse(plain) as unknown,
                updatedAt: parsed.updatedAt,
              },
            });
          }
        } catch {
          // Skip unparseable secret rows cleanly without exposing ciphertext diagnostics.
        }
      }

      const homekitIdentities = includeHomeKit
        ? (await manager.find(HomeKitIdentityEntity)).map((row) => ({
            cameraId: row.cameraId,
            value: row.value,
          }))
        : [];
      const sessions = (await manager.find(ClientSessionEntity)).map((row) => ({ ...row }));

      return { credentials, homekitIdentities, sessions };
    });
  }

  async applyCredentialBundle(bundle: CredentialBundlePayload): Promise<number> {
    if (!this.transactions) return 0;
    let applied = 0;

    // Pre-encrypt under the receiver's own master key BEFORE opening transaction.
    const sealedRows: StandaloneHomeEntryRow[] = [];
    for (const item of bundle.credentials) {
      if (item.kind === 'tuya_credentials' || item.kind === 'network_credentials') {
        const encrypted = await this.localCipher.encrypt(
          Buffer.from(JSON.stringify(item.payload), 'utf8'),
        );
        sealedRows.push({
          kind: item.kind,
          entryId: item.entryId,
          value: JSON.stringify({ encrypted }),
          updatedAt: item.updatedAt,
        });
      } else if (item.kind === 'ha_app_credential') {
        const record = item.payload as Record<string, unknown>;
        const encryptedSecret =
          typeof record.clientSecret === 'string' && record.clientSecret.length > 0
            ? await this.localCipher.encrypt(Buffer.from(record.clientSecret, 'utf8'))
            : undefined;
        sealedRows.push({
          kind: 'ha_app_credential',
          entryId: item.entryId,
          value: JSON.stringify({
            domain: record.domain,
            clientId: record.clientId,
            ...(encryptedSecret ? { encryptedSecret } : {}),
            ...(record.name ? { name: record.name } : {}),
            ...(record.authDomain ? { authDomain: record.authDomain } : {}),
            createdAt: record.createdAt ?? new Date().toISOString(),
          }),
          updatedAt: item.updatedAt,
        });
      } else if (item.kind === 'ha_entry_runtime') {
        const record = item.payload as {
          entryId?: string;
          runtime?: unknown;
          updatedAt?: string;
        };
        const encryptedJson = await this.localCipher.encrypt(
          Buffer.from(JSON.stringify(record.runtime ?? {}), 'utf8'),
        );
        sealedRows.push({
          kind: 'ha_entry_runtime',
          entryId: item.entryId,
          value: JSON.stringify({
            entryId: record.entryId ?? item.entryId,
            encryptedJson,
            updatedAt: record.updatedAt ?? new Date().toISOString(),
          }),
          updatedAt: item.updatedAt,
        });
      }
    }

    await this.transactions.run(async (manager) => {
      for (let i = 0; i < sealedRows.length; i += 100) {
        const chunk = sealedRows.slice(i, i + 100);
        await manager.upsert(StandaloneHomeEntryEntity, chunk, ['kind', 'entryId']);
        applied += chunk.length;
      }
      const hkRows = bundle.homekitIdentities.map((hk) => ({
        cameraId: hk.cameraId,
        value: hk.value,
      }));
      for (let i = 0; i < hkRows.length; i += 100) {
        const chunk = hkRows.slice(i, i + 100);
        await manager.upsert(HomeKitIdentityEntity, chunk, ['cameraId']);
        applied += chunk.length;
      }
      const sessions = bundle.sessions ?? [];
      for (let i = 0; i < sessions.length; i += 100) {
        const chunk = sessions.slice(i, i + 100);
        await manager.upsert(ClientSessionEntity, chunk, ['sessionId']);
        applied += chunk.length;
      }
    });

    return applied;
  }

  async exportConfigBundle(): Promise<ConfigBundlePayload> {
    if (!this.transactions) return { entries: [] };
    return this.transactions.read(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity, {
        where: { kind: In(CONFIG_KIND_LIST) },
      });
      const entries = rows.map((row) => {
        if (row.kind !== 'app') return { ...row };
        try {
          const parsed = JSON.parse(row.value) as Record<string, unknown>;
          if (Array.isArray(parsed.logs) && parsed.logs.length > 0) {
            return { ...row, value: JSON.stringify({ ...parsed, logs: [] }) };
          }
        } catch {
          // Keep malformed app row untouched.
        }
        return { ...row };
      });
      const cutoff = Date.now() - TOMBSTONE_RETENTION_MS;
      const tombstones = (
        await manager.find(StandaloneHomeEntryEntity, { where: { kind: 'config_tombstone' } })
      )
        .filter((row) => row.updatedAt >= cutoff)
        .map((row) => ({ ...row }));
      const shared = await manager.findOneBy(SharedConfigEntity, { id: 1 });
      return {
        entries,
        ...(tombstones.length > 0 ? { tombstones } : {}),
        ...(shared ? { sharedConfig: { ...shared } } : {}),
      };
    });
  }

  async applyConfigBundle(
    bundle: ConfigBundlePayload,
    localHubId: string,
    options?: { readonly authoritativePrune?: boolean },
  ): Promise<number> {
    if (!this.transactions) return 0;
    return this.transactions.run(async (manager) => {
      let applied = 0;
      const workloads = await manager.find(ClusterWorkloadEntity);
      const ownership = new Map(workloads.map((w) => [w.workloadId, w]));
      const localActiveWorkloadIds = new Set(
        workloads
          .filter((w) => w.ownerHubId === localHubId && w.state === 'active')
          .map((w) => w.workloadId),
      );

      const { normalizedRows, preservedRoomIds } = await normalizeReplicatedConfigEntries({
        manager,
        entries: bundle.entries,
        allowedKinds: CONFIG_KINDS,
        localHubId,
        ownership,
      });
      const reconciled = await reconcileConfigTombstones(
        manager,
        normalizedRows,
        bundle.tombstones,
        localActiveWorkloadIds,
      );
      applied += reconciled.removed;
      const rowsToWrite = options?.authoritativePrune
        ? reconciled.rows
        : await filterFreshRows(manager, reconciled.rows, CONFIG_KIND_LIST);
      for (let i = 0; i < rowsToWrite.length; i += 100) {
        const chunk = rowsToWrite.slice(i, i + 100);
        await manager.upsert(StandaloneHomeEntryEntity, chunk, ['kind', 'entryId']);
        applied += chunk.length;
      }
      if (options?.authoritativePrune) {
        applied += await pruneDeletedConfigRows(
          manager,
          reconciled.rows,
          localActiveWorkloadIds,
          preservedRoomIds,
        );
      }

      if (bundle.sharedConfig) {
        await manager.upsert(
          SharedConfigEntity,
          {
            id: 1,
            revision: bundle.sharedConfig.revision,
            value: bundle.sharedConfig.value,
            updatedAt: bundle.sharedConfig.updatedAt,
          },
          ['id'],
        );
        applied += 1;
      }
      return applied;
    });
  }

  async exportCacheBundle(options?: {
    readonly includeHistory?: boolean;
  }): Promise<CacheBundlePayload> {
    if (!this.transactions) {
      return {
        endpointStates: [],
        endpointHistory: [],
        mediaDescriptors: [],
        backupDescriptors: [],
      };
    }
    const includeHistory = options?.includeHistory ?? true;
    return this.transactions.read(async (manager) => {
      const endpointStates = (
        await manager.find(StandaloneHomeEntryEntity, {
          where: { kind: 'endpoint_state' },
        })
      ).map((row) => ({ ...row }));
      if (!includeHistory) {
        return {
          endpointStates,
          endpointHistory: [],
          mediaDescriptors: [],
          backupDescriptors: [],
        };
      }
      const rawHistory = await manager.find(StandaloneHomeEntryEntity, {
        where: { kind: 'endpoint_history' },
        order: { updatedAt: 'DESC' },
      });
      const endpointHistory = boundHistoryRowsForSync(rawHistory, this.historyTrimCache);
      const mediaDescriptors = (await manager.find(ClusterMediaEntity)).map((m) => ({
        eventId: m.eventId,
        digest: m.digest,
        bytes: m.bytes,
        version: m.version,
      }));
      const backupDescriptors = (await manager.find(BackupEntity)).map((b) => ({
        digest: b.digest,
        kind: b.kind,
        createdAt: b.createdAt,
        bytes: b.bytes,
        haSlug: b.haSlug,
        archiveGeneration: b.archiveGeneration,
      }));
      return {
        endpointStates,
        endpointHistory,
        mediaDescriptors,
        backupDescriptors,
      };
    });
  }

  async applyCacheBundle(bundle: CacheBundlePayload): Promise<number> {
    if (!this.transactions) return 0;
    return this.transactions.run(async (manager) => {
      let applied = 0;
      const incomingCacheRows = [...bundle.endpointStates, ...bundle.endpointHistory].filter(
        (row) => CACHE_KINDS.has(row.kind),
      );
      const cacheRows = await filterFreshRows(manager, incomingCacheRows, [...CACHE_KINDS]);
      for (let i = 0; i < cacheRows.length; i += 100) {
        const chunk = cacheRows.slice(i, i + 100);
        await manager.upsert(StandaloneHomeEntryEntity, chunk, ['kind', 'entryId']);
        applied += chunk.length;
      }
      for (let i = 0; i < bundle.mediaDescriptors.length; i += 100) {
        const chunk = bundle.mediaDescriptors.slice(i, i + 100);
        await manager.upsert(ClusterMediaEntity, chunk, ['eventId']);
        applied += chunk.length;
      }
      for (let i = 0; i < bundle.backupDescriptors.length; i += 100) {
        const chunk = bundle.backupDescriptors.slice(i, i + 100);
        await manager.upsert(BackupEntity, chunk, ['digest']);
        applied += chunk.length;
      }
      return applied;
    });
  }

  computePayloadDigest(payload: unknown): string {
    return sha256Hex(JSON.stringify(payload));
  }
}
