/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Room, SourceRef } from '../types.js';
import type { HausDevice } from '../device/types.js';
import type { HausAutomationRule, HausScene, HausScript } from '../automation/types.js';

export type IdentityKind = 'home' | 'room' | 'device' | 'endpoint' | 'camera' | 'recording' | 'app';

/** A provider key is scoped to a home and record kind, never a label or network address. */
export interface IdentityRef {
  readonly homeId: string;
  readonly kind: IdentityKind;
  readonly source: Readonly<SourceRef>;
}

export interface IdentityTransaction {
  get(reference: IdentityRef): Promise<string | undefined>;
  owner(id: string): Promise<IdentityRef | undefined>;
  bind(reference: IdentityRef, id: string): Promise<void>;
}

/** The host implements an atomic, durable transaction, including reverse-ID uniqueness. */
export interface IdentityRepository {
  transaction<T>(operation: (transaction: IdentityTransaction) => Promise<T>): Promise<T>;
}

/** Exclusive ownership is mutable metadata; it must never be part of the resource's identity. */
export interface ResourceRef {
  readonly homeId: string;
  readonly kind: 'integration' | 'automation' | 'radio' | 'homekit' | 'media';
  readonly id: string;
}

export interface HausDeviceGroup {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly roomId?: string;
  readonly memberDeviceIds: readonly string[];
  readonly memberAddresses: readonly string[];
}

export interface HistoricalEventRecord {
  readonly eventId: string;
  readonly canonicalId: string;
  readonly recordedAddress: string;
  readonly roomIdAtCapture: string;
  readonly timestamp: string;
  readonly eventType: string;
}

export interface ArchiveRecordingRecord {
  readonly recordingId: string;
  readonly canonicalCameraId: string;
  readonly recordedAddress: string;
  readonly archiveDigest: string;
  readonly roomIdAtCapture: string;
  readonly createdAt: string;
}

export interface PendingProviderRoomSync {
  readonly deviceId: string;
  readonly providerInstanceId: string;
  readonly targetRoomId: string;
  readonly queuedAt: string;
}

export interface RoomMoveActor {
  readonly actorId: string;
  readonly role: 'owner' | 'admin' | 'member' | 'guest' | 'viewer';
  readonly permissions?: readonly string[];
  readonly allowedRoomIds?: readonly string[];
}

export interface RoomMoveRequest {
  readonly homeId: string;
  readonly deviceId: string;
  readonly targetRoomId: string;
  readonly actor: RoomMoveActor;
  readonly expectedRevision?: number;
  readonly collisionPolicy?: 'reject' | 'auto_suffix';
}

export interface RoomMoveClientPatch {
  readonly homeId: string;
  readonly revision: number;
  readonly deviceId: string;
  readonly canonicalIdPreserved: true;
  readonly physicalCommandsDispatched: 0;
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly addressRewrites: Readonly<Record<string, string>>;
  readonly retainedAliases: readonly string[];
  readonly updatedSceneIds: readonly string[];
  readonly updatedAutomationIds: readonly string[];
  readonly updatedScriptIds: readonly string[];
  readonly updatedGroupIds: readonly string[];
  readonly providerSyncStatus: 'synced_online' | 'queued_offline';
}

export interface RoomMovePersistenceState {
  homeId: string;
  revision: number;
  rooms: Record<string, Room>;
  devices: Record<string, HausDevice>;
  primaryAddresses: Record<string, string>;
  aliasToCanonical: Record<string, string>;
  scenes: Record<string, HausScene>;
  scripts: Record<string, HausScript>;
  automations: Record<string, HausAutomationRule>;
  groups: Record<string, HausDeviceGroup>;
  history: HistoricalEventRecord[];
  archives: ArchiveRecordingRecord[];
  pendingProviderSyncs: Record<string, PendingProviderRoomSync>;
}

export interface RoomMoveRepository {
  load(homeId: string): Promise<RoomMovePersistenceState | undefined>;
  save(state: RoomMovePersistenceState): Promise<void>;
}
