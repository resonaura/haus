/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HubCapacityMetrics } from './types.js';

export type WorkloadKind =
  'vision' | 'recording' | 'media' | 'radio' | 'integration' | 'automation' | 'app';

export interface WorkloadRequirements {
  readonly minCores?: number;
  readonly minMemoryMb?: number;
  readonly minStorageGb?: number;
  readonly requiresHardwareTranscoder?: boolean;
  readonly requiredRadio?: 'zigbee' | 'matter' | 'thread' | 'zwave';
  readonly forbiddenOnWeakHub?: boolean;
}

export interface PlacementWorkload {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkloadKind;
  readonly requirements: WorkloadRequirements;
  readonly userPreferredHubId?: string;
  readonly fallbackHubIds?: readonly string[];
  readonly affinityEndpointIds?: readonly string[];
}

export interface HubPlacementNode {
  readonly hubId: string;
  readonly name: string;
  readonly available: boolean;
  readonly isWeakHub: boolean;
  readonly capacity: HubCapacityMetrics;
  readonly currentLoad: {
    readonly assignedWorkloadCount: number;
    readonly reservedMemoryMb: number;
    readonly reservedStorageGb: number;
  };
}

export interface PlacementDecision {
  readonly workloadId: string;
  readonly assignedHubId?: string;
  readonly status: 'assigned' | 'rejected';
  readonly score?: number;
  readonly reason?: string;
}

export interface PlacementPlan {
  readonly decisions: readonly PlacementDecision[];
  readonly assignedCount: number;
  readonly rejectedCount: number;
  readonly scheduledAt: string;
}

export class ResourcePlacementScheduler {
  scheduleWorkload(
    workload: PlacementWorkload,
    nodes: readonly HubPlacementNode[],
  ): PlacementDecision {
    const candidates: { node: HubPlacementNode; score: number }[] = [];

    for (const node of nodes) {
      if (!node.available) continue;

      const req = workload.requirements;

      // 1. Weak Hub exclusion
      if (req.forbiddenOnWeakHub && node.isWeakHub) {
        continue;
      }

      // 2. Hardware radio constraint
      if (req.requiredRadio && !node.capacity.attachedRadios.includes(req.requiredRadio)) {
        continue;
      }

      // 3. Hardware transcoder constraint
      if (req.requiresHardwareTranscoder && !node.capacity.hasHardwareTranscoder) {
        continue;
      }

      // 4. CPU cores constraint
      if (req.minCores && node.capacity.cpuCores < req.minCores) {
        continue;
      }

      // 5. Memory constraint
      if (req.minMemoryMb) {
        const totalMb = Math.round(node.capacity.memoryBytes / (1024 * 1024));
        const freeMb = totalMb - node.currentLoad.reservedMemoryMb;
        if (freeMb < req.minMemoryMb) {
          continue;
        }
      }

      // 6. Storage constraint
      if (req.minStorageGb) {
        const totalGb = Math.round(node.capacity.storageAvailableBytes / (1024 * 1024 * 1024));
        const freeGb = totalGb - node.currentLoad.reservedStorageGb;
        if (freeGb < req.minStorageGb) {
          continue;
        }
      }

      // Compute deterministic score
      let score = 100;

      // User preference bonus
      if (workload.userPreferredHubId === node.hubId) {
        score += 1000;
      } else if (workload.fallbackHubIds?.includes(node.hubId)) {
        const idx = workload.fallbackHubIds.indexOf(node.hubId);
        score += Math.max(0, 500 - idx * 150);
      }

      // Headroom scoring: prefer nodes with lower assigned workload count and more free memory
      score -= node.currentLoad.assignedWorkloadCount * 10;
      const memMb = Math.round(node.capacity.memoryBytes / (1024 * 1024));
      score += Math.min(100, Math.floor(memMb / 1024) * 10);

      candidates.push({ node, score });
    }

    if (candidates.length === 0) {
      return {
        workloadId: workload.id,
        status: 'rejected',
        reason: 'No available hub satisfies all hardware and capacity requirements.',
      };
    }

    // Deterministic sorting: highest score first; if tied, alphabetical by hubId (zero witness needed!)
    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.node.hubId.localeCompare(b.node.hubId);
    });

    const chosen = candidates[0];
    return {
      workloadId: workload.id,
      assignedHubId: chosen?.node.hubId,
      status: 'assigned',
      score: chosen?.score,
    };
  }

  scheduleBatch(
    workloads: readonly PlacementWorkload[],
    nodes: readonly HubPlacementNode[],
  ): PlacementPlan {
    const mutableNodes: HubPlacementNode[] = nodes.map((n) => ({
      ...n,
      currentLoad: { ...n.currentLoad },
    }));

    const decisions: PlacementDecision[] = [];

    // Sort workloads: radio/hardware/vision workloads first, then general apps
    const sortedWorkloads = [...workloads].sort((a, b) => {
      const priority = (w: PlacementWorkload) => {
        if (w.requirements.requiredRadio) return 1;
        if (w.requirements.forbiddenOnWeakHub) return 2;
        if (w.userPreferredHubId) return 3;
        return 4;
      };
      return priority(a) - priority(b);
    });

    for (const workload of sortedWorkloads) {
      const decision = this.scheduleWorkload(workload, mutableNodes);
      decisions.push(decision);

      if (decision.status === 'assigned' && decision.assignedHubId) {
        const assignedNode = mutableNodes.find((n) => n.hubId === decision.assignedHubId);
        if (assignedNode) {
          const req = workload.requirements;
          const updatedNode: HubPlacementNode = {
            ...assignedNode,
            currentLoad: {
              assignedWorkloadCount: assignedNode.currentLoad.assignedWorkloadCount + 1,
              reservedMemoryMb: assignedNode.currentLoad.reservedMemoryMb + (req.minMemoryMb ?? 0),
              reservedStorageGb:
                assignedNode.currentLoad.reservedStorageGb + (req.minStorageGb ?? 0),
            },
          };
          const nodeIdx = mutableNodes.findIndex((n) => n.hubId === decision.assignedHubId);
          if (nodeIdx !== -1) {
            mutableNodes[nodeIdx] = updatedNode;
          }
        }
      }
    }

    const assignedCount = decisions.filter((d) => d.status === 'assigned').length;
    const rejectedCount = decisions.filter((d) => d.status === 'rejected').length;

    return {
      decisions,
      assignedCount,
      rejectedCount,
      scheduledAt: new Date().toISOString(),
    };
  }
}
