/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  ConnectivityState,
  HubRole,
  type HubContinuityStatus,
  type HubTopologyNode,
} from './types.js';

export function evaluateContinuityStatus(
  localNode: HubTopologyNode,
  knownPeers: readonly HubTopologyNode[],
  options?: {
    internetAvailable?: boolean;
    heartbeatTimeoutMs?: number;
    currentTime?: number;
  },
): HubContinuityStatus {
  const now = options?.currentTime ?? Date.now();
  const timeoutMs = options?.heartbeatTimeoutMs ?? 15000;
  const internetAvailable = options?.internetAvailable ?? true;

  const activePeers: string[] = [];
  const unreachablePeers: string[] = [];
  const warnings: string[] = [];

  let coordinatorAvailable =
    localNode.role === HubRole.Coordinator || localNode.role === HubRole.Standalone;

  for (const peer of knownPeers) {
    if (peer.hubId === localNode.hubId) continue;

    const lastSeen = new Date(peer.lastHeartbeat).getTime();
    const isAlive = now - lastSeen <= timeoutMs;

    if (isAlive) {
      activePeers.push(peer.hubId);
      if (peer.role === HubRole.Coordinator) {
        coordinatorAvailable = true;
      }
    } else {
      unreachablePeers.push(peer.hubId);
      if (peer.role === HubRole.Coordinator) {
        warnings.push(
          `Coordinator hub "${peer.hubId}" heartbeat lost. Local node retains all local workloads.`,
        );
      } else {
        warnings.push(
          `Peer hub "${peer.hubId}" unreachable. Local node retains all local workloads.`,
        );
      }
    }
  }

  // Determine connectivity state
  let connectivity = ConnectivityState.Online;
  const isPeerPartitioned = unreachablePeers.length > 0 && knownPeers.length > 0;

  if (!internetAvailable && isPeerPartitioned) {
    connectivity = ConnectivityState.Isolated;
    warnings.push(
      'Both WAN internet and peer hubs are unreachable. Local node running in complete isolation.',
    );
  } else if (!internetAvailable) {
    connectivity = ConnectivityState.InternetLoss;
    warnings.push(
      'WAN internet unreachable. Remote token rotations paused; all LAN features fully operational.',
    );
  } else if (isPeerPartitioned) {
    connectivity = ConnectivityState.PeerPartitioned;
  }

  // Local continuity principles:
  // 1. Local automations targeting local devices ALWAYS execute
  // 2. Physical radio dongles attached to local host hardware ALWAYS stay active
  // 3. Local media/NVR recording onto local disks ALWAYS continues
  const canExecuteLocalAutomations = true;
  const canControlLocalRadios = localNode.capacity.attachedRadios.length > 0;
  const canRecordLocalMedia = localNode.capacity.storageAvailableBytes > 0;
  const localContinuityIntact = true;

  return {
    localHubId: localNode.hubId,
    role: localNode.role,
    connectivity,
    localContinuityIntact,
    canExecuteLocalAutomations,
    canControlLocalRadios,
    canRecordLocalMedia,
    peerCount: knownPeers.length,
    activePeers,
    unreachablePeers,
    coordinatorAvailable,
    internetAvailable,
    warnings,
  };
}
