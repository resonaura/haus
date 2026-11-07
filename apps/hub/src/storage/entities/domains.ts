/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';

export interface SharedConfigRow {
  id: number;
  revision: string;
  value: string;
  updatedAt: number;
}

export interface ClusterNodeRow {
  id: string;
  value: string;
}

export interface ClusterLocationRow {
  digest: string;
  nodeId: string;
  kind: string;
  catalogVersion: number;
  metadataHash: string | null;
}

export interface ClusterMediaRow {
  eventId: string;
  digest: string;
  bytes: number;
  version: number;
}

export interface HomeKitIdentityRow {
  cameraId: string;
  value: string;
}

export interface BackupRow {
  digest: string;
  kind: string;
  createdAt: number;
  bytes: number;
  haSlug: string | null;
  archiveGeneration: number | null;
}

export interface BackupRetryRow {
  kind: string;
  nextAt: number;
  failures: number;
}

export const SharedConfigEntity = new EntitySchema<SharedConfigRow>({
  name: 'SharedConfig',
  tableName: 'shared_config',
  columns: {
    id: { type: 'integer', primary: true },
    revision: { type: 'text' },
    value: { type: 'text' },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const ClusterNodeEntity = new EntitySchema<ClusterNodeRow>({
  name: 'ClusterNode',
  tableName: 'cluster_nodes',
  columns: {
    id: { type: 'text', primary: true },
    value: { type: 'text' },
  },
});

export const ClusterLocationEntity = new EntitySchema<ClusterLocationRow>({
  name: 'ClusterLocation',
  tableName: 'cluster_locations',
  columns: {
    digest: { type: 'text', primary: true },
    nodeId: { type: 'text', primary: true, name: 'node_id' },
    kind: { type: 'text' },
    catalogVersion: { type: 'integer', name: 'catalog_version', default: 0 },
    metadataHash: { type: 'text', name: 'metadata_hash', nullable: true },
  },
});

export const ClusterMediaEntity = new EntitySchema<ClusterMediaRow>({
  name: 'ClusterMedia',
  tableName: 'cluster_media',
  columns: {
    eventId: { type: 'text', primary: true, name: 'event_id' },
    digest: { type: 'text' },
    bytes: { type: 'integer' },
    version: { type: 'integer' },
  },
});

export const HomeKitIdentityEntity = new EntitySchema<HomeKitIdentityRow>({
  name: 'HomeKitIdentity',
  tableName: 'homekit_identities',
  columns: {
    cameraId: { type: 'text', primary: true, name: 'camera_id' },
    value: { type: 'text' },
  },
});

export const BackupEntity = new EntitySchema<BackupRow>({
  name: 'Backup',
  tableName: 'haus_backups',
  columns: {
    digest: { type: 'text', primary: true },
    kind: { type: 'text' },
    createdAt: { type: 'integer', name: 'created_at' },
    bytes: { type: 'integer' },
    haSlug: { type: 'text', name: 'ha_slug', nullable: true },
    archiveGeneration: { type: 'integer', name: 'archive_generation', nullable: true },
  },
});

export const BackupRetryEntity = new EntitySchema<BackupRetryRow>({
  name: 'BackupRetry',
  tableName: 'haus_backup_retries',
  columns: {
    kind: { type: 'text', primary: true },
    nextAt: { type: 'integer', name: 'next_at' },
    failures: { type: 'integer' },
  },
});
