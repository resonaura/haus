/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { cpus, freemem, totalmem } from 'node:os';
import {
  ResourcePlacementScheduler,
  type HubCapacityMetrics,
  type HubPlacementNode,
  type PlacementDecision,
  type PlacementWorkload,
  type WorkloadRequirements,
} from '@haus/core/cluster';

export type ClusterRadioKind = 'zigbee' | 'matter' | 'thread' | 'zwave';

export interface NodeCapacityInput {
  readonly hubId: string;
  readonly name: string;
  readonly available: boolean;
  readonly draining?: boolean;
  readonly fenced?: boolean;
  readonly isWeakHub?: boolean;
  readonly capacity: HubCapacityMetrics;
}

export interface PlannedPlacementItem {
  readonly workload: PlacementWorkload;
  readonly previousOwnerHubId?: string;
  readonly decision: PlacementDecision;
  readonly changed: boolean;
  readonly reason: string;
}

export interface ClusterPlacementSummary {
  readonly plans: readonly PlannedPlacementItem[];
  readonly moveCount: number;
  readonly perHubCounts: Record<string, number>;
  readonly rejectedCount: number;
  readonly scheduledAt: string;
}

export function detectLocalCapacity(overrides?: Partial<HubCapacityMetrics>): HubCapacityMetrics {
  const hostCores = Math.max(1, cpus().length);
  const hostMem = Math.max(512 * 1024 * 1024, totalmem());
  const freeDiskFallback = Math.max(freemem(), 16 * 1024 * 1024 * 1024);
  return {
    cpuCores: overrides?.cpuCores ?? hostCores,
    memoryBytes: overrides?.memoryBytes ?? hostMem,
    storageAvailableBytes: overrides?.storageAvailableBytes ?? freeDiskFallback,
    hasHardwareTranscoder: overrides?.hasHardwareTranscoder ?? false,
    attachedRadios: overrides?.attachedRadios ?? [],
  };
}

export function deriveRequirementsFromWorkloadMeta(meta: {
  readonly kind: PlacementWorkload['kind'];
  readonly id: string;
  readonly name?: string;
  readonly requirements?: Partial<WorkloadRequirements>;
}): WorkloadRequirements {
  if (meta.requirements && Object.keys(meta.requirements).length > 0) {
    return { ...meta.requirements };
  }
  const normalized = `${meta.id} ${meta.name ?? ''}`.toLowerCase();
  const req: {
    minCores?: number;
    minMemoryMb?: number;
    minStorageGb?: number;
    requiresHardwareTranscoder?: boolean;
    requiredRadio?: ClusterRadioKind;
    forbiddenOnWeakHub?: boolean;
  } = {};

  if (normalized.includes('zigbee')) req.requiredRadio = 'zigbee';
  else if (normalized.includes('zwave') || normalized.includes('z-wave'))
    req.requiredRadio = 'zwave';
  else if (normalized.includes('thread') || normalized.includes('otbr'))
    req.requiredRadio = 'thread';

  if (
    normalized.includes('frigate') ||
    normalized.includes('scrypted') ||
    normalized.includes('vision')
  ) {
    req.forbiddenOnWeakHub = true;
    req.minMemoryMb = 512;
  } else if (meta.kind === 'app') {
    req.minMemoryMb = 128;
  }

  return req;
}

function canNodeHost(node: NodeCapacityInput, workload: PlacementWorkload): boolean {
  if (!node.available || node.draining || node.fenced) return false;
  const req = workload.requirements;
  if (req.forbiddenOnWeakHub && node.isWeakHub) return false;
  if (req.requiredRadio && !node.capacity.attachedRadios.includes(req.requiredRadio)) return false;
  if (req.requiresHardwareTranscoder && !node.capacity.hasHardwareTranscoder) return false;
  if (req.minCores && node.capacity.cpuCores < req.minCores) return false;
  if (req.minMemoryMb) {
    const totalMb = Math.round(node.capacity.memoryBytes / (1024 * 1024));
    if (totalMb < req.minMemoryMb) return false;
  }
  if (req.minStorageGb) {
    const totalGb = Math.round(node.capacity.storageAvailableBytes / (1024 * 1024 * 1024));
    if (totalGb < req.minStorageGb) return false;
  }
  return true;
}

/**
 * Coordinates load-balanced workload placement using @haus/core's ResourcePlacementScheduler,
 * with anti-flap hysteresis during incremental ticks and full re-spread on rebalance / node join.
 */
export class ClusterPlacementPlanner {
  private readonly scheduler = new ResourcePlacementScheduler();

  planDistribution(params: {
    readonly workloads: readonly PlacementWorkload[];
    readonly nodes: readonly NodeCapacityInput[];
    readonly currentOwners: ReadonlyMap<string, string>;
    readonly forceRebalance?: boolean;
  }): ClusterPlacementSummary {
    const eligibleInputs = params.nodes.filter((n) => n.available && !n.draining && !n.fenced);
    const force = params.forceRebalance ?? false;

    const toPlacementNodes = (
      counts: Map<string, number>,
      memReserved: Map<string, number>,
      diskReserved: Map<string, number>,
    ): HubPlacementNode[] =>
      eligibleInputs.map((n) => ({
        hubId: n.hubId,
        name: n.name,
        available: n.available && !n.draining && !n.fenced,
        isWeakHub: Boolean(n.isWeakHub),
        capacity: n.capacity,
        currentLoad: {
          assignedWorkloadCount: counts.get(n.hubId) ?? 0,
          reservedMemoryMb: memReserved.get(n.hubId) ?? 0,
          reservedStorageGb: diskReserved.get(n.hubId) ?? 0,
        },
      }));

    if (force) {
      const zeroCounts = new Map<string, number>();
      const zeroMem = new Map<string, number>();
      const zeroDisk = new Map<string, number>();
      const batch = this.scheduler.scheduleBatch(
        params.workloads,
        toPlacementNodes(zeroCounts, zeroMem, zeroDisk),
      );
      const decisionMap = new Map(batch.decisions.map((d) => [d.workloadId, d]));
      return this.buildSummary(params.workloads, params.currentOwners, decisionMap, 'rebalance');
    }

    // Incremental pass with hysteresis: keep existing healthy owners unless constraints fail,
    // explicit user preference moved, or load skew >= 2 workloads.
    const counts = new Map<string, number>();
    const memReserved = new Map<string, number>();
    const diskReserved = new Map<string, number>();
    for (const node of eligibleInputs) {
      counts.set(node.hubId, 0);
      memReserved.set(node.hubId, 0);
      diskReserved.set(node.hubId, 0);
    }

    const decisionMap = new Map<string, PlacementDecision>();
    const pendingRelocation: PlacementWorkload[] = [];

    for (const workload of params.workloads) {
      const prevOwner = params.currentOwners.get(workload.id);
      const ownerNode = prevOwner ? eligibleInputs.find((n) => n.hubId === prevOwner) : undefined;
      const prefersOther =
        Boolean(workload.userPreferredHubId) &&
        workload.userPreferredHubId !== prevOwner &&
        Boolean(
          eligibleInputs.find(
            (n) => n.hubId === workload.userPreferredHubId && canNodeHost(n, workload),
          ),
        );

      if (ownerNode && canNodeHost(ownerNode, workload) && !prefersOther) {
        counts.set(ownerNode.hubId, (counts.get(ownerNode.hubId) ?? 0) + 1);
        memReserved.set(
          ownerNode.hubId,
          (memReserved.get(ownerNode.hubId) ?? 0) + (workload.requirements.minMemoryMb ?? 0),
        );
        diskReserved.set(
          ownerNode.hubId,
          (diskReserved.get(ownerNode.hubId) ?? 0) + (workload.requirements.minStorageGb ?? 0),
        );
        decisionMap.set(workload.id, {
          workloadId: workload.id,
          assignedHubId: ownerNode.hubId,
          status: 'assigned',
          reason: 'retained_healthy_owner',
        });
      } else {
        pendingRelocation.push(workload);
      }
    }

    // Also check if healthy nodes are overly skewed (e.g. a new Hub joined idle while another has >= 2 extra).
    if (eligibleInputs.length > 1) {
      const minLoad = Math.min(...eligibleInputs.map((n) => counts.get(n.hubId) ?? 0));
      for (const workload of params.workloads) {
        const decision = decisionMap.get(workload.id);
        if (!decision?.assignedHubId) continue;
        const ownerLoad = counts.get(decision.assignedHubId) ?? 0;
        const pinned = workload.userPreferredHubId === decision.assignedHubId;
        if (!pinned && ownerLoad - minLoad >= 2 && !workload.requirements.requiredRadio) {
          counts.set(decision.assignedHubId, ownerLoad - 1);
          memReserved.set(
            decision.assignedHubId,
            Math.max(
              0,
              (memReserved.get(decision.assignedHubId) ?? 0) -
                (workload.requirements.minMemoryMb ?? 0),
            ),
          );
          diskReserved.set(
            decision.assignedHubId,
            Math.max(
              0,
              (diskReserved.get(decision.assignedHubId) ?? 0) -
                (workload.requirements.minStorageGb ?? 0),
            ),
          );
          decisionMap.delete(workload.id);
          pendingRelocation.push(workload);
        }
      }
    }

    if (pendingRelocation.length > 0) {
      const batch = this.scheduler.scheduleBatch(
        pendingRelocation,
        toPlacementNodes(counts, memReserved, diskReserved),
      );
      for (const dec of batch.decisions) {
        decisionMap.set(dec.workloadId, dec);
      }
    }

    return this.buildSummary(params.workloads, params.currentOwners, decisionMap, 'incremental');
  }

  private buildSummary(
    workloads: readonly PlacementWorkload[],
    currentOwners: ReadonlyMap<string, string>,
    decisionMap: ReadonlyMap<string, PlacementDecision>,
    mode: 'rebalance' | 'incremental',
  ): ClusterPlacementSummary {
    const perHubCounts: Record<string, number> = {};
    const plans: PlannedPlacementItem[] = [];
    let moveCount = 0;
    let rejectedCount = 0;

    for (const workload of workloads) {
      const decision = decisionMap.get(workload.id) ?? {
        workloadId: workload.id,
        status: 'rejected' as const,
        reason: 'no_eligible_hub',
      };
      const previousOwnerHubId = currentOwners.get(workload.id);
      const changed =
        decision.status === 'assigned' &&
        Boolean(decision.assignedHubId) &&
        decision.assignedHubId !== previousOwnerHubId;

      if (decision.status === 'assigned' && decision.assignedHubId) {
        perHubCounts[decision.assignedHubId] = (perHubCounts[decision.assignedHubId] ?? 0) + 1;
        if (changed) moveCount += 1;
      } else {
        rejectedCount += 1;
      }

      plans.push({
        workload,
        previousOwnerHubId,
        decision,
        changed,
        reason: changed ? `${mode}_move` : (decision.reason ?? mode),
      });
    }

    return {
      plans,
      moveCount,
      perHubCounts,
      rejectedCount,
      scheduledAt: new Date().toISOString(),
    };
  }
}

export interface ClusterNodeCapacityPeer {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly online: boolean;
  readonly roles: readonly string[];
}

/** Builds heterogeneous cluster capacity descriptors for placement & drain decisions. */
export function buildClusterNodeCapacities(params: {
  readonly localHubId: string;
  readonly localRole: string;
  readonly localFenced: boolean;
  readonly peers: readonly ClusterNodeCapacityPeer[];
  readonly cachedPeerCapacities: ReadonlyMap<
    string,
    { readonly capacity: HubCapacityMetrics; readonly isWeakHub: boolean }
  >;
}): NodeCapacityInput[] {
  const localCap = detectLocalCapacity();
  const isLocalWeak = localCap.cpuCores <= 2 && localCap.memoryBytes < 2 * 1024 * 1024 * 1024;
  const result: NodeCapacityInput[] = [
    {
      hubId: params.localHubId,
      name: params.localRole === 'coordinator' ? 'Primary Coordinator' : 'Local Hub',
      available: !params.localFenced && params.localRole !== 'fenced',
      fenced: params.localFenced,
      isWeakHub: isLocalWeak,
      capacity: localCap,
    },
  ];
  for (const node of params.peers) {
    const cached = params.cachedPeerCapacities.get(node.id);
    const capacity =
      cached?.capacity ??
      detectLocalCapacity({
        attachedRadios: node.roles.includes('radio') ? ['zigbee', 'matter'] : [],
        hasHardwareTranscoder: node.roles.includes('stream'),
      });
    result.push({
      hubId: node.id,
      name: node.name,
      available: node.online && node.enabled,
      isWeakHub:
        cached?.isWeakHub ??
        (capacity.cpuCores <= 2 && capacity.memoryBytes < 2 * 1024 * 1024 * 1024),
      capacity,
    });
  }
  return result;
}
