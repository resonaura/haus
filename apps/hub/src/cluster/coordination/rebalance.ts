/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DrainNodeSummary } from '../drain/service.js';
import type { ClusterSyncService } from '../sync/service.js';
import type { ClusterLeaseService, DecodedClusterWorkload } from './leases.js';
import type {
  ClusterPlacementPlanner,
  ClusterPlacementSummary,
  NodeCapacityInput,
} from './placement.js';
import type { ReconciliationOutcome } from './reconcile.js';
import type { ClusterStateStore } from './state.js';

export interface RebalanceResult {
  readonly rebalanced: boolean;
  readonly movedCount: number;
  readonly summary: ClusterPlacementSummary;
  readonly movedWorkloadIds: readonly string[];
  readonly workloads: readonly DecodedClusterWorkload[];
  readonly reconciliation?: ReconciliationOutcome;
}

/**
 * Executes capacity-aware workload rebalance with Fence-Before-Promote and E2EE replication.
 */
export async function executeClusterRebalance(params: {
  readonly stateStore: ClusterStateStore;
  readonly leaseService: ClusterLeaseService;
  readonly syncService: ClusterSyncService;
  readonly planner: ClusterPlacementPlanner;
  readonly peers: readonly DrainNodeSummary[];
  readonly nodeCapacities: readonly NodeCapacityInput[];
  readonly reconciliation?: ReconciliationOutcome;
  readonly force?: boolean;
  readonly preferences?: Record<string, string>;
}): Promise<RebalanceResult> {
  const state = await params.stateStore.ensureInitialized();

  for (const id of params.leaseService.listRegisteredWorkloadIds()) {
    const ctrl = params.leaseService.getController(id);
    if (!ctrl) continue;
    await params.leaseService.ensureLocalOwnership({
      workloadId: id,
      kind: ctrl.kind,
      name: ctrl.name,
      requirements: ctrl.requirements,
      preferredHubId: ctrl.preferredHubId,
      active: ctrl.getLocalStatus() === 'running',
    });
  }

  const decoded = params.leaseService.listDecodedWorkloads();
  const currentOwners = new Map(decoded.map((w) => [w.workloadId, w.ownerHubId]));
  const placementWorkloads = params.leaseService.listPlacementWorkloads().map((wl) => {
    const prefOverride = params.preferences?.[wl.id];
    return prefOverride ? { ...wl, userPreferredHubId: prefOverride } : wl;
  });

  const summary = params.planner.planDistribution({
    workloads: placementWorkloads,
    nodes: params.nodeCapacities,
    currentOwners,
    forceRebalance: params.force ?? true,
  });

  const movedWorkloadIds: string[] = [];
  for (const item of summary.plans) {
    const targetHubId = item.decision.assignedHubId;
    if (item.decision.status !== 'assigned' || !targetHubId) continue;
    const prevOwner = currentOwners.get(item.workload.id);
    if (prevOwner === targetHubId) continue;

    const prevNode = params.peers.find((n) => n.id === prevOwner);
    await params.leaseService.handoffWorkload({
      workloadId: item.workload.id,
      targetHubId,
      allowOfflineForceFence: prevOwner !== state.hubId && !prevNode?.online,
      beforePromoteSync: async (destHubId) => {
        if (params.stateStore.getPeerTrustRecord(destHubId)) {
          await params.syncService.syncPeer(destHubId).catch(() => undefined);
        }
      },
    });
    movedWorkloadIds.push(item.workload.id);
  }

  for (const peer of params.peers) {
    if (!peer.enabled || !peer.online) continue;
    if (!params.stateStore.getPeerTrustRecord(peer.id)) continue;
    await params.syncService.syncPeer(peer.id).catch(() => undefined);
  }

  return {
    rebalanced: true,
    movedCount: movedWorkloadIds.length,
    summary,
    movedWorkloadIds,
    workloads: params.leaseService.listDecodedWorkloads(),
    ...(params.reconciliation ? { reconciliation: params.reconciliation } : {}),
  };
}
