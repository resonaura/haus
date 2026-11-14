/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';

export interface ClusterStateRow {
  id: number;
  hubId: string;
  homeId: string;
  role: string;
  coordinatorEpoch: number;
  coordinatorId: string;
  coordinatorUrl: string | null;
  fenced: boolean;
  fencedReason: string | null;
  updatedAt: number;
}

export interface ClusterPeerKeyRow {
  hubId: string;
  homeId: string;
  signingPublicKey: string;
  exchangePublicKey: string;
  channelSecretEnc: string;
  keyVersion: number;
  revoked: boolean;
  updatedAt: number;
}

export interface ClusterWorkloadRow {
  workloadId: string;
  kind: string;
  name: string;
  ownerHubId: string;
  standbyHubIdsJson: string;
  generation: number;
  epoch: number;
  state: string;
  leaseExpiresAt: number;
  configRevision: number;
  credentialRevision: number;
  cacheRevision: number;
  requirementsJson: string;
  preferredHubId: string | null;
  updatedAt: number;
}

export interface ClusterTransferRow {
  transferId: string;
  sourceHubId: string;
  targetHubId: string;
  state: string;
  epoch: number;
  preservePairing: boolean;
  summaryJson: string;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ClusterSyncStateRow {
  syncKey: string;
  kind: string;
  resourceId: string;
  revision: number;
  generation: number;
  epoch: number;
  sha256: string;
  sourceHubId: string;
  updatedAt: number;
}

export const ClusterStateEntity = new EntitySchema<ClusterStateRow>({
  name: 'ClusterState',
  tableName: 'cluster_state',
  columns: {
    id: { type: 'integer', primary: true },
    hubId: { type: 'text', name: 'hub_id' },
    homeId: { type: 'text', name: 'home_id' },
    role: { type: 'text' },
    coordinatorEpoch: { type: 'integer', name: 'coordinator_epoch', default: 1 },
    coordinatorId: { type: 'text', name: 'coordinator_id' },
    coordinatorUrl: { type: 'text', name: 'coordinator_url', nullable: true },
    fenced: { type: 'boolean', default: false },
    fencedReason: { type: 'text', name: 'fenced_reason', nullable: true },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const ClusterPeerKeyEntity = new EntitySchema<ClusterPeerKeyRow>({
  name: 'ClusterPeerKey',
  tableName: 'cluster_peer_keys',
  columns: {
    hubId: { type: 'text', primary: true, name: 'hub_id' },
    homeId: { type: 'text', name: 'home_id' },
    signingPublicKey: { type: 'text', name: 'signing_public_key' },
    exchangePublicKey: { type: 'text', name: 'exchange_public_key' },
    channelSecretEnc: { type: 'text', name: 'channel_secret_enc' },
    keyVersion: { type: 'integer', name: 'key_version', default: 1 },
    revoked: { type: 'boolean', default: false },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const ClusterWorkloadEntity = new EntitySchema<ClusterWorkloadRow>({
  name: 'ClusterWorkload',
  tableName: 'cluster_workloads',
  columns: {
    workloadId: { type: 'text', primary: true, name: 'workload_id' },
    kind: { type: 'text' },
    name: { type: 'text' },
    ownerHubId: { type: 'text', name: 'owner_hub_id' },
    standbyHubIdsJson: { type: 'text', name: 'standby_hub_ids_json' },
    generation: { type: 'integer', default: 1 },
    epoch: { type: 'integer', default: 1 },
    state: { type: 'text' },
    leaseExpiresAt: { type: 'integer', name: 'lease_expires_at', default: 0 },
    configRevision: { type: 'integer', name: 'config_revision', default: 1 },
    credentialRevision: { type: 'integer', name: 'credential_revision', default: 1 },
    cacheRevision: { type: 'integer', name: 'cache_revision', default: 1 },
    requirementsJson: { type: 'text', name: 'requirements_json' },
    preferredHubId: { type: 'text', name: 'preferred_hub_id', nullable: true },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const ClusterTransferEntity = new EntitySchema<ClusterTransferRow>({
  name: 'ClusterTransfer',
  tableName: 'cluster_transfers',
  columns: {
    transferId: { type: 'text', primary: true, name: 'transfer_id' },
    sourceHubId: { type: 'text', name: 'source_hub_id' },
    targetHubId: { type: 'text', name: 'target_hub_id' },
    state: { type: 'text' },
    epoch: { type: 'integer' },
    preservePairing: { type: 'boolean', name: 'preserve_pairing', default: true },
    summaryJson: { type: 'text', name: 'summary_json' },
    reason: { type: 'text', nullable: true },
    createdAt: { type: 'integer', name: 'created_at' },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const ClusterSyncStateEntity = new EntitySchema<ClusterSyncStateRow>({
  name: 'ClusterSyncState',
  tableName: 'cluster_sync_state',
  columns: {
    syncKey: { type: 'text', primary: true, name: 'sync_key' },
    kind: { type: 'text' },
    resourceId: { type: 'text', name: 'resource_id' },
    revision: { type: 'integer', default: 1 },
    generation: { type: 'integer', default: 1 },
    epoch: { type: 'integer', default: 1 },
    sha256: { type: 'text' },
    sourceHubId: { type: 'text', name: 'source_hub_id' },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const clusterEntities = [
  ClusterStateEntity,
  ClusterPeerKeyEntity,
  ClusterWorkloadEntity,
  ClusterTransferEntity,
  ClusterSyncStateEntity,
];
