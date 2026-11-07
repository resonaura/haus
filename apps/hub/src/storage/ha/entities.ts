/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';

export interface ClientRow {
  id: string;
  tokenHash: string;
  createdAt: number;
  nativeEntities: boolean;
}
export interface FeatureRow {
  clientId: string;
  disabledReadiness: boolean;
  at: number;
}
export interface ReadyRow {
  clientId: string;
  cameraId: string;
  revision: string;
  at: number;
}
export interface OwnerRow {
  cameraId: string;
  clientId: string;
}
export interface ReleaseRow {
  bridgeId: string;
  requestedAt: number;
}
export interface JournalRow {
  bridgeId: string;
  value: string;
}

export const ClientEntity = new EntitySchema<ClientRow>({
  name: 'HaCameraClient',
  tableName: 'ha_camera_clients',
  columns: {
    id: { type: 'text', primary: true },
    tokenHash: { type: 'text', name: 'token_hash' },
    createdAt: { type: 'integer', name: 'created_at' },
    nativeEntities: { type: 'boolean', name: 'native_entities', default: false },
  },
});
export const FeatureEntity = new EntitySchema<FeatureRow>({
  name: 'NativeHaFeature',
  tableName: 'native_ha_features',
  columns: {
    clientId: { type: 'text', primary: true, name: 'client_id' },
    disabledReadiness: { type: 'boolean', name: 'disabled_readiness' },
    at: { type: 'integer' },
  },
});
export const ReadyEntity = new EntitySchema<ReadyRow>({
  name: 'NativeHaReady',
  tableName: 'native_ha_ready',
  columns: {
    clientId: { type: 'text', primary: true, name: 'client_id' },
    cameraId: { type: 'text', primary: true, name: 'camera_id' },
    revision: { type: 'text' },
    at: { type: 'integer' },
  },
});
export const OwnerEntity = new EntitySchema<OwnerRow>({
  name: 'NativeHaOwner',
  tableName: 'native_ha_owner',
  columns: {
    cameraId: { type: 'text', primary: true, name: 'camera_id' },
    clientId: { type: 'text', name: 'client_id' },
  },
});
export const ReleaseEntity = new EntitySchema<ReleaseRow>({
  name: 'NativeHaRelease',
  tableName: 'native_ha_release',
  columns: {
    bridgeId: { type: 'text', primary: true, name: 'bridge_id' },
    requestedAt: { type: 'integer', name: 'requested_at' },
  },
});
export const JournalEntity = new EntitySchema<JournalRow>({
  name: 'NativeHaMigration',
  tableName: 'native_ha_migrations',
  columns: {
    bridgeId: { type: 'text', primary: true, name: 'bridge_id' },
    value: { type: 'text' },
  },
});
export const haEntities = [
  ClientEntity,
  FeatureEntity,
  ReadyEntity,
  OwnerEntity,
  ReleaseEntity,
  JournalEntity,
];
