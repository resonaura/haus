/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

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

/**
 * Exports and applies home credentials, configurations, and caches with strict cipher isolation:
 * secrets are decrypted under the sender master key inside memory only when building an E2EE envelope,
 * and re-sealed under the receiver's own master key upon application.
 */
export class ClusterSnapshotCodec {
  private readonly localCipher: AesGcmCredentialCipher;

  constructor(
    private readonly transactions?: Transactions,
    dataDir?: string,
  ) {
    this.localCipher = new AesGcmCredentialCipher(undefined, { dataDir });
  }

  async exportCredentialBundle(includeHomeKit = true): Promise<CredentialBundlePayload> {
    if (!this.transactions) return { credentials: [], homekitIdentities: [] };
    return this.transactions.run(async (manager) => {
      const rows = await manager.find(StandaloneHomeEntryEntity);
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
      for (const row of sealedRows) {
        await manager.upsert(StandaloneHomeEntryEntity, row, ['kind', 'entryId']);
        applied += 1;
      }
      for (const hk of bundle.homekitIdentities) {
        await manager.upsert(HomeKitIdentityEntity, { cameraId: hk.cameraId, value: hk.value }, [
          'cameraId',
        ]);
        applied += 1;
      }
      for (const session of bundle.sessions ?? []) {
        await manager.upsert(ClientSessionEntity, session, ['sessionId']);
        applied += 1;
      }
    });

    return applied;
  }

  async exportConfigBundle(): Promise<ConfigBundlePayload> {
    if (!this.transactions) return { entries: [] };
    return this.transactions.run(async (manager) => {
      const all = await manager.find(StandaloneHomeEntryEntity);
      const entries = all.filter((row) => CONFIG_KINDS.has(row.kind)).map((row) => ({ ...row }));
      const shared = await manager.findOneBy(SharedConfigEntity, { id: 1 });
      return {
        entries,
        ...(shared ? { sharedConfig: { ...shared } } : {}),
      };
    });
  }

  async applyConfigBundle(bundle: ConfigBundlePayload, localHubId: string): Promise<number> {
    if (!this.transactions) return 0;
    return this.transactions.run(async (manager) => {
      let applied = 0;
      const workloads = await manager.find(ClusterWorkloadEntity);
      const ownership = new Map(workloads.map((w) => [w.workloadId, w]));

      for (const entry of bundle.entries) {
        if (!CONFIG_KINDS.has(entry.kind)) continue;
        let normalizedValue = entry.value;
        // Safety invariant: keep replicated standby Apps 'stopped' unless this Hub owns active lease.
        if (entry.kind === 'app') {
          try {
            const parsed = JSON.parse(entry.value) as Record<string, unknown>;
            const wl = ownership.get(`app:${entry.entryId}`);
            const localActiveOwner = wl && wl.ownerHubId === localHubId && wl.state === 'active';
            if (!localActiveOwner) {
              normalizedValue = JSON.stringify({
                ...parsed,
                state: 'stopped',
                containerId: undefined,
              });
            }
          } catch {
            // Preserve raw if malformed.
          }
        }
        await manager.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: entry.kind,
            entryId: entry.entryId,
            value: normalizedValue,
            updatedAt: entry.updatedAt,
          },
          ['kind', 'entryId'],
        );
        applied += 1;
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

  async exportCacheBundle(): Promise<CacheBundlePayload> {
    if (!this.transactions) {
      return {
        endpointStates: [],
        endpointHistory: [],
        mediaDescriptors: [],
        backupDescriptors: [],
      };
    }
    return this.transactions.run(async (manager) => {
      const all = await manager.find(StandaloneHomeEntryEntity);
      const endpointStates = all
        .filter((row) => row.kind === 'endpoint_state' && CACHE_KINDS.has(row.kind))
        .map((row) => ({ ...row }));
      const endpointHistory = all
        .filter((row) => row.kind === 'endpoint_history' && CACHE_KINDS.has(row.kind))
        .map((row) => ({ ...row }));
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
      for (const row of [...bundle.endpointStates, ...bundle.endpointHistory]) {
        if (!CACHE_KINDS.has(row.kind)) continue;
        await manager.upsert(StandaloneHomeEntryEntity, row, ['kind', 'entryId']);
        applied += 1;
      }
      for (const media of bundle.mediaDescriptors) {
        await manager.upsert(ClusterMediaEntity, media, ['eventId']);
        applied += 1;
      }
      for (const backup of bundle.backupDescriptors) {
        await manager.upsert(BackupEntity, backup, ['digest']);
        applied += 1;
      }
      return applied;
    });
  }

  computePayloadDigest(payload: unknown): string {
    return sha256Hex(JSON.stringify(payload));
  }
}
