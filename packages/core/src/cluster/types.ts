/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export enum HubRoleEnum {
  Coordinator = 'coordinator',
  Member = 'member',
  Standalone = 'standalone',
}

export const HubRole = HubRoleEnum;
export type HubRole = HubRoleEnum | `${HubRoleEnum}`;

export enum ConnectivityStateEnum {
  Online = 'online',
  PeerPartitioned = 'peer_partitioned',
  InternetLoss = 'internet_loss',
  Isolated = 'isolated',
}

export const ConnectivityState = ConnectivityStateEnum;
export type ConnectivityState = ConnectivityStateEnum | `${ConnectivityStateEnum}`;

export enum ResourceKindEnum {
  RadioCoordinator = 'radio_coordinator',
  TokenRotation = 'token_rotation',
  MediaStream = 'media_stream',
  HomeKitBridge = 'homekit_bridge',
  LocalAutomation = 'local_automation',
}

export const ResourceKind = ResourceKindEnum;
export type ResourceKind = ResourceKindEnum | `${ResourceKindEnum}`;

export interface HubCapacityMetrics {
  readonly cpuCores: number;
  readonly memoryBytes: number;
  readonly storageAvailableBytes: number;
  readonly hasHardwareTranscoder: boolean;
  readonly attachedRadios: readonly ('zigbee' | 'matter' | 'thread' | 'zwave')[];
}

export interface HubTopologyNode {
  readonly hubId: string;
  readonly name: string;
  readonly role: HubRole;
  readonly address: string;
  readonly generation: number;
  readonly capacity: HubCapacityMetrics;
  readonly ownedResources: readonly string[];
  readonly lastHeartbeat: string;
  readonly connectivity: ConnectivityState;
}

export interface HubContinuityStatus {
  readonly localHubId: string;
  readonly role: HubRole;
  readonly connectivity: ConnectivityState;
  readonly localContinuityIntact: boolean;
  readonly canExecuteLocalAutomations: boolean;
  readonly canControlLocalRadios: boolean;
  readonly canRecordLocalMedia: boolean;
  readonly peerCount: number;
  readonly activePeers: readonly string[];
  readonly unreachablePeers: readonly string[];
  readonly coordinatorAvailable: boolean;
  readonly internetAvailable: boolean;
  readonly warnings: readonly string[];
}
