/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { evaluateContinuityStatus } from './continuity.js';
import {
  ConnectivityState,
  HubRole,
  type HubCapacityMetrics,
  type HubContinuityStatus,
  type HubTopologyNode,
} from './types.js';

export interface TopologyManagerOptions {
  readonly hubId: string;
  readonly name: string;
  readonly role?: HubRole;
  readonly address: string;
  readonly capacity: HubCapacityMetrics;
  readonly initialGeneration?: number;
  readonly heartbeatTimeoutMs?: number;
}

export class HubTopologyManager {
  private localNode: HubTopologyNode;
  private readonly peers = new Map<string, HubTopologyNode>();
  private readonly locallyOwnedResources = new Set<string>();
  private internetAvailable: boolean = true;
  private readonly heartbeatTimeoutMs: number;

  constructor(options: TopologyManagerOptions) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15000;
    this.localNode = {
      hubId: options.hubId,
      name: options.name,
      role: options.role ?? HubRole.Standalone,
      address: options.address,
      generation: options.initialGeneration ?? 1,
      capacity: options.capacity,
      ownedResources: [],
      lastHeartbeat: new Date().toISOString(),
      connectivity: ConnectivityState.Online,
    };
  }

  getLocalNode(): HubTopologyNode {
    return {
      ...this.localNode,
      ownedResources: Array.from(this.locallyOwnedResources),
    };
  }

  setRole(role: HubRole): void {
    this.localNode = {
      ...this.localNode,
      role,
      generation: this.localNode.generation + 1,
    };
  }

  incrementGeneration(): number {
    const next = this.localNode.generation + 1;
    this.localNode = {
      ...this.localNode,
      generation: next,
    };
    return next;
  }

  registerPeer(peer: HubTopologyNode): void {
    if (peer.hubId === this.localNode.hubId) return;
    this.peers.set(peer.hubId, peer);
  }

  updatePeerHeartbeat(hubId: string, timestamp?: string): void {
    const existing = this.peers.get(hubId);
    if (!existing) return;

    this.peers.set(hubId, {
      ...existing,
      lastHeartbeat: timestamp || new Date().toISOString(),
    });
  }

  removePeer(hubId: string): void {
    this.peers.delete(hubId);
  }

  getPeers(): readonly HubTopologyNode[] {
    return Array.from(this.peers.values());
  }

  setInternetAvailability(available: boolean): void {
    this.internetAvailable = available;
  }

  claimResource(resourceId: string): void {
    this.locallyOwnedResources.add(resourceId);
  }

  releaseResource(resourceId: string): void {
    this.locallyOwnedResources.delete(resourceId);
  }

  isResourceOwnedLocally(resourceId: string): boolean {
    return this.locallyOwnedResources.has(resourceId);
  }

  canExecuteLocally(resourceId: string): boolean {
    // If standalone or locally claimed, can execute directly
    if (this.localNode.role === HubRole.Standalone) return true;
    return this.locallyOwnedResources.has(resourceId);
  }

  getContinuityStatus(currentTime?: number): HubContinuityStatus {
    return evaluateContinuityStatus(
      this.getLocalNode(),
      this.getPeers(),
      {
        internetAvailable: this.internetAvailable,
        heartbeatTimeoutMs: this.heartbeatTimeoutMs,
        currentTime,
      },
    );
  }
}
