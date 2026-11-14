/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { WorkloadKind, WorkloadRequirements } from '@haus/core/cluster';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';

export type WorkloadLeaseState = 'active' | 'standby' | 'draining' | 'fenced' | 'stopped';

export interface DecodedClusterWorkload {
  readonly workloadId: string;
  readonly kind: WorkloadKind;
  readonly name: string;
  readonly ownerHubId: string;
  readonly standbyHubIds: readonly string[];
  readonly generation: number;
  readonly epoch: number;
  readonly state: WorkloadLeaseState;
  readonly leaseExpiresAt: number;
  readonly configRevision: number;
  readonly credentialRevision: number;
  readonly cacheRevision: number;
  readonly requirements: WorkloadRequirements;
  readonly preferredHubId?: string;
  readonly updatedAt: number;
}

export interface SignedFencingProof {
  readonly resourceId: string;
  readonly homeId: string;
  readonly priorOwnerHubId: string;
  readonly newOwnerHubId: string;
  readonly fencedGeneration: number;
  readonly epoch: number;
  readonly proofType: 'signed_revocation' | 'witness_quorum' | 'pdu_power_cut';
  readonly issuedByHubId: string;
  readonly issuedAt: number;
  readonly signature: string;
}

export interface WorkloadExecutionController {
  readonly kind: WorkloadKind;
  readonly name: string;
  readonly requirements?: WorkloadRequirements;
  readonly preferredHubId?: string;
  startLocal(): Promise<void>;
  stopLocal(reason: string): Promise<void>;
  getLocalStatus(): 'running' | 'stopped';
  executeRemote?(action: string, payload?: Record<string, unknown>): Promise<unknown>;
}

export const DEFAULT_LEASE_TTL_MS = 60_000;

export function decodeClusterWorkloadRow(row: ClusterWorkloadRow): DecodedClusterWorkload {
  let standbyHubIds: string[] = [];
  let requirements: WorkloadRequirements = {};
  try {
    const parsed = JSON.parse(row.standbyHubIdsJson) as unknown;
    if (Array.isArray(parsed))
      standbyHubIds = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    standbyHubIds = [];
  }
  try {
    const parsed = JSON.parse(row.requirementsJson) as unknown;
    if (parsed && typeof parsed === 'object') requirements = parsed as WorkloadRequirements;
  } catch {
    requirements = {};
  }
  const kind = (
    ['vision', 'recording', 'media', 'radio', 'integration', 'automation', 'app'].includes(row.kind)
      ? row.kind
      : 'app'
  ) as WorkloadKind;
  const state = (
    ['active', 'standby', 'draining', 'fenced', 'stopped'].includes(row.state)
      ? row.state
      : 'active'
  ) as WorkloadLeaseState;
  return {
    workloadId: row.workloadId,
    kind,
    name: row.name,
    ownerHubId: row.ownerHubId,
    standbyHubIds,
    generation: row.generation,
    epoch: row.epoch,
    state,
    leaseExpiresAt: row.leaseExpiresAt,
    configRevision: row.configRevision,
    credentialRevision: row.credentialRevision,
    cacheRevision: row.cacheRevision,
    requirements,
    ...(row.preferredHubId ? { preferredHubId: row.preferredHubId } : {}),
    updatedAt: row.updatedAt,
  };
}
