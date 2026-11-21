/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ClusterCryptoIdentity } from '../crypto/identity.js';
import {
  openClusterEnvelope,
  sealClusterEnvelope,
  type ClusterSecretEnvelope,
} from '../crypto/envelope.js';
import { ClusterNodeEntity } from '../../storage/entities/domains.js';
import type { Transactions } from '../../storage/transactions.js';
import type { Cluster } from '../cluster.js';

export interface PeerNvrAccess {
  readonly key: string;
  readonly allowHttp: boolean;
  readonly roles?: readonly string[];
}

interface SealedNvrPayload {
  readonly nvrKey?: unknown;
  readonly roles?: unknown;
}

const VALID_NVR_ROLES = new Set(['storage', 'stream']);

/** Seals this Hub's NVR node HMAC key for a specific trusted cluster peer over E2EE. */
export function sealPeerNvrAccess(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly epoch: number;
  readonly recipientHubId: string;
  readonly recipientExchangePublicKey: string;
  readonly nvrKey: string;
  readonly roles?: readonly string[];
}): ClusterSecretEnvelope | undefined {
  const key = params.nvrKey.trim();
  if (Buffer.byteLength(key) < 32) return undefined;
  const roles = (params.roles ?? ['storage', 'stream']).filter((r) => VALID_NVR_ROLES.has(r));
  return sealClusterEnvelope({
    identity: params.identity,
    homeId: params.homeId,
    recipientHubId: params.recipientHubId,
    recipientExchangePublicKey: params.recipientExchangePublicKey,
    kind: 'credential',
    resourceId: `nvr_node_access:${params.identity.hubId}`,
    revision: 1,
    generation: 1,
    epoch: params.epoch,
    ttlMs: 120_000,
    payload: { nvrKey: key, roles },
  });
}

/** Verifies and decrypts an E2EE peer NVR access envelope received from /api/cluster/peer/status. */
export function openPeerNvrAccess(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly expectedHomeId: string;
  readonly expectedSenderHubId: string;
  readonly senderSigningPublicKey: string;
  readonly peerUrl: string;
  readonly envelope: ClusterSecretEnvelope;
  readonly minExpectedEpoch?: number;
}): PeerNvrAccess | undefined {
  if (params.envelope.senderHubId !== params.expectedSenderHubId) return undefined;
  const opened = openClusterEnvelope<SealedNvrPayload>({
    identity: params.identity,
    expectedHomeId: params.expectedHomeId,
    senderSigningPublicKey: params.senderSigningPublicKey,
    envelope: params.envelope,
    minExpectedEpoch: params.minExpectedEpoch,
  });
  const key = typeof opened.payload?.nvrKey === 'string' ? opened.payload.nvrKey.trim() : '';
  if (Buffer.byteLength(key) < 32) return undefined;
  const roles = Array.isArray(opened.payload?.roles)
    ? opened.payload.roles.filter(
        (r): r is string => typeof r === 'string' && VALID_NVR_ROLES.has(r),
      )
    : undefined;
  return {
    key,
    allowHttp: params.peerUrl.startsWith('http://'),
    ...(roles && roles.length > 0 ? { roles } : {}),
  };
}

/** Persists E2EE-exchanged NVR key + allowHttp onto ClusterNodeEntity and wakes RECORDING_CLUSTER. */
export async function persistPeerNvrAccess(params: {
  readonly hubId: string;
  readonly access: PeerNvrAccess;
  readonly transactions?: Transactions;
  readonly recordingCluster?: Cluster;
}): Promise<boolean> {
  const { hubId, access, transactions, recordingCluster } = params;
  if (!transactions && !recordingCluster) return false;

  let currentRowValue: string | undefined;
  if (recordingCluster) {
    try {
      currentRowValue = recordingCluster.catalog.nodes().find((row) => row.id === hubId)?.value;
    } catch {
      currentRowValue = undefined;
    }
  }
  if (!currentRowValue && transactions) {
    currentRowValue = await transactions.read(async (manager) => {
      const saved = await manager.findOneBy(ClusterNodeEntity, { id: hubId });
      return saved?.value;
    });
  }
  if (!currentRowValue) return false;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(currentRowValue) as Record<string, unknown>;
  } catch {
    return false;
  }

  const nextRoles =
    access.roles && access.roles.length > 0
      ? [...access.roles]
      : Array.isArray(parsed.roles)
        ? parsed.roles
        : ['storage', 'stream'];
  const sameKey = parsed.key === access.key;
  const sameAllowHttp = parsed.allowHttp === access.allowHttp;
  const sameRoles = JSON.stringify(parsed.roles ?? []) === JSON.stringify(nextRoles);
  if (sameKey && sameAllowHttp && sameRoles) {
    if (recordingCluster && !recordingCluster.health.get(hubId)?.online) {
      void recordingCluster.refreshHealth({ force: true }).catch(() => {});
    }
    return false;
  }

  const updated = {
    ...parsed,
    id: hubId,
    key: access.key,
    allowHttp: access.allowHttp,
    roles: nextRoles,
  };
  const serialized = JSON.stringify(updated);
  if (recordingCluster) {
    await recordingCluster.catalog.saveNode({ id: hubId, value: serialized });
    recordingCluster.invalidateHealth();
    void recordingCluster.refreshHealth({ force: true }).catch(() => {});
  } else if (transactions) {
    await transactions.run((manager) =>
      manager.upsert(ClusterNodeEntity, { id: hubId, value: serialized }, ['id']),
    );
  }
  return true;
}
