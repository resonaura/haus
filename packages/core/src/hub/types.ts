/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type HubClusterRole = 'storage' | 'stream' | 'radio' | 'bridge';

export interface HubServiceRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  data?: Record<string, unknown>;
}

export interface HubServicePort {
  request<T>(request: HubServiceRequest): Promise<T>;
}

export interface ClusterWorkloadSummary {
  readonly workloadId: string;
  readonly kind: string;
  readonly name: string;
  readonly ownerHubId: string;
  readonly standbyHubIds: readonly string[];
  readonly generation: number;
  readonly epoch: number;
  readonly state: string;
  readonly configRevision: number;
  readonly credentialRevision: number;
  readonly cacheRevision: number;
  readonly preferredHubId?: string;
}

export interface ClusterNodeDrainPlan {
  readonly nodeId: string;
  readonly isLocalNode?: boolean;
  readonly isSoleHub?: boolean;
  readonly canRemoveSafely?: boolean;
  readonly blockReason?: string;
  readonly blockingReasons?: readonly string[];
  readonly online: boolean;
  readonly isCoordinator?: boolean;
  readonly workloadsToMigrate?: readonly {
    readonly workloadId: string;
    readonly name: string;
    readonly kind: string;
    readonly suggestedTargetHubId?: string;
  }[];
  readonly activeWorkloadIds?: readonly string[];
  readonly soleCopyMediaCount: number;
  readonly soleCopyMediaBytes: number;
  readonly soleCopyBackupsCount: number;
  readonly exclusiveRadios?: readonly string[];
  readonly soleRadioWarnings?: readonly string[];
  readonly requiresForceIfOffline?: boolean;
  readonly requiresForce?: boolean;
}

export interface RemoveClusterNodeOptions {
  readonly force?: boolean;
  readonly targetHubId?: string;
}

export interface ClusterTransferSummary {
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly epoch: number;
  readonly state: string;
}

export interface ClusterMember {
  readonly id: string;
  readonly name: string;
  readonly url?: string;
  readonly role: string;
  readonly online: boolean;
  readonly enabled: boolean;
  readonly isSelf?: boolean;
  readonly isCoordinator?: boolean;
}

export interface ClusterNode {
  livePriority?: number;
  id: string;
  name: string;
  url: string;
  roles: HubClusterRole[];
  allowHttp: boolean;
  enabled: boolean;
  sshServerId?: string;
  instanceId?: string;
  online?: boolean;
  lastSeen?: number;
  remote?: Record<string, unknown>;
  error?: string;
  backupCopies: number;
  isCoordinator?: boolean;
  fenced?: boolean;
  capacityScore?: number;
}

export interface ClusterStatus {
  optional: boolean;
  id?: string;
  selfHubId?: string;
  coordinatorUrl?: string;
  role?: 'coordinator' | 'node' | 'standalone' | 'fenced';
  epoch?: number;
  coordinatorId?: string;
  fenced?: boolean;
  nodes: ClusterNode[];
  members?: ClusterMember[];
  backups: {
    items: { digest: string; kind: 'haus' | 'ha'; createdAt: number; bytes: number }[];
    busy: boolean;
    error?: string;
  };
  sync: { enabled: boolean; authority: string };
  busy: boolean;
}

export interface AddClusterNodeInput {
  name: string;
  url: string;
  key?: string;
  token?: string;
  allowHttp?: boolean;
  roles: HubClusterRole[];
  sshServerId?: string;
  nodeId?: string;
  homeId?: string;
}

export interface EnrollClusterHubInput {
  targetUrl: string;
  name?: string;
  roles?: HubClusterRole[];
  pairingCode?: string;
  challengeSessionId?: string;
}

export interface AttachClusterInput {
  coordinatorUrl: string;
  grant: Record<string, unknown>;
  name?: string;
  selfUrl?: string;
  homeId?: string;
  roles?: HubClusterRole[];
  coordinatorToken?: string;
}

export type ClusterNodePatch =
  | { livePriority: number }
  | { enabled: boolean }
  | { storageLimitBytes: number | null }
  | { sshServerId: string | null }
  | { enabled: boolean; storageLimitBytes: number | null };
