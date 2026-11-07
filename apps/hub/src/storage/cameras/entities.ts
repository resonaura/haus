/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';

export interface ProviderRow {
  id: string;
  connection: string;
  createdAt: number;
}
export interface ControllerRow {
  id: number;
  value: string;
}
export interface CameraIdentityRow {
  bridgeId: string;
  physicalId: string;
  cameraId: string;
}
export interface CameraSourceRow {
  bridgeId: string;
  physicalId: string;
  value: string;
}
export interface AssignmentRow {
  cameraId: string;
  nodeId: string;
}
export interface CameraEventRow {
  eventId: string;
  value: string;
}
export interface ActivityPolicyRow {
  policyId: string;
  cameraId: string;
  nodeId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}
export interface ActivityReleaseRow {
  policyId: string;
  cameraId: string;
  nodeId: string;
  expiresAt: number;
}
export interface ActivityTriggerRow {
  requestId: string;
  nodeId: string;
  value: string;
  expiresAt: number;
}

export const ProviderEntity = new EntitySchema<ProviderRow>({
  name: 'NativeProvider',
  tableName: 'native_providers',
  columns: {
    id: { type: 'text', primary: true },
    connection: { type: 'text' },
    createdAt: { type: 'integer', name: 'created_at' },
  },
});
export const ControllerEntity = new EntitySchema<ControllerRow>({
  name: 'NativeController',
  tableName: 'native_provider_controller',
  columns: {
    id: { type: 'integer', primary: true },
    value: { type: 'text' },
  },
});
export const CameraIdentityEntity = new EntitySchema<CameraIdentityRow>({
  name: 'NativeCameraIdentity',
  tableName: 'native_camera_identities',
  columns: {
    bridgeId: { type: 'text', name: 'bridge_id', primary: true },
    physicalId: { type: 'text', name: 'physical_id', primary: true },
    cameraId: { type: 'text', name: 'camera_id', unique: true },
  },
});
export const CameraSourceEntity = new EntitySchema<CameraSourceRow>({
  name: 'NativeCameraSource',
  tableName: 'native_camera_sources',
  columns: {
    bridgeId: { type: 'text', name: 'bridge_id', primary: true },
    physicalId: { type: 'text', name: 'physical_id', primary: true },
    value: { type: 'text' },
  },
});
export const AssignmentEntity = new EntitySchema<AssignmentRow>({
  name: 'NvrCameraAssignment',
  tableName: 'nvr_camera_assignments',
  columns: {
    cameraId: { type: 'text', name: 'camera_id', primary: true },
    nodeId: { type: 'text', name: 'node_id' },
  },
});
export const CameraEventEntity = new EntitySchema<CameraEventRow>({
  name: 'NvrCameraEvent',
  tableName: 'nvr_camera_events',
  columns: {
    eventId: { type: 'text', name: 'event_id', primary: true },
    value: { type: 'text' },
  },
});
export const ActivityPolicyEntity = new EntitySchema<ActivityPolicyRow>({
  name: 'NvrActivityPolicy',
  tableName: 'nvr_activity_policies',
  columns: {
    policyId: { type: 'text', name: 'policy_id', primary: true },
    cameraId: { type: 'text', name: 'camera_id' },
    nodeId: { type: 'text', name: 'node_id' },
    createdAt: { type: 'integer', name: 'created_at' },
    expiresAt: { type: 'integer', name: 'expires_at' },
    revokedAt: { type: 'integer', name: 'revoked_at', nullable: true },
  },
  indices: [{ name: 'nvr_activity_camera', columns: ['cameraId', 'revokedAt'] }],
});
export const ActivityReleaseEntity = new EntitySchema<ActivityReleaseRow>({
  name: 'NvrActivityRelease',
  tableName: 'nvr_activity_releases',
  columns: {
    policyId: { type: 'text', name: 'policy_id', primary: true },
    cameraId: { type: 'text', name: 'camera_id' },
    nodeId: { type: 'text', name: 'node_id' },
    expiresAt: { type: 'integer', name: 'expires_at' },
  },
});
export const ActivityTriggerEntity = new EntitySchema<ActivityTriggerRow>({
  name: 'NvrActivityTrigger',
  tableName: 'nvr_activity_triggers',
  columns: {
    requestId: { type: 'text', name: 'request_id', primary: true },
    nodeId: { type: 'text', name: 'node_id' },
    value: { type: 'text' },
    expiresAt: { type: 'integer', name: 'expires_at' },
  },
});
export const cameraEntities = [
  ProviderEntity,
  ControllerEntity,
  CameraIdentityEntity,
  CameraSourceEntity,
  AssignmentEntity,
  CameraEventEntity,
  ActivityPolicyEntity,
  ActivityReleaseEntity,
  ActivityTriggerEntity,
];
