/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Transactions } from '../../storage/transactions.js';
import { CATALOG_TRANSACTIONS } from '../../storage/storage.module.js';
import { HUB_DATA_DIRECTORY } from '../crypto/master-key.js';
import { fetchSignedPeerBytes, sendSignedPeerRequest } from '../crypto/transport.js';
import { ClusterLeaseService } from '../coordination/leases.js';
import {
  ClusterPlacementPlanner,
  detectLocalCapacity,
  type NodeCapacityInput,
} from '../coordination/placement.js';
import { ClusterStateStore } from '../coordination/state.js';
import { ClusterSyncService } from '../sync/service.js';
import {
  collectSoleCopyAssets,
  resolvePeerMediaDownloadPath,
  saveEvacuatedBlobAndLocations,
} from './media.js';

export interface DrainNodeSummary {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly online: boolean;
  readonly enabled: boolean;
  readonly roles: readonly string[];
}

export interface NodeDrainPlan {
  readonly nodeId: string;
  readonly isLocalNode: boolean;
  readonly isCoordinator: boolean;
  readonly isSoleHub: boolean;
  readonly online: boolean;
  readonly canRemoveSafely: boolean;
  readonly requiresForceIfOffline: boolean;
  readonly blockReason?: string;
  readonly activeWorkloadIds: readonly string[];
  readonly workloadsToMigrate: readonly {
    readonly workloadId: string;
    readonly name: string;
    readonly kind: string;
    readonly suggestedTargetHubId?: string;
  }[];
  readonly soleCopyMediaCount: number;
  readonly soleCopyMediaBytes: number;
  readonly soleCopyMediaDigests: readonly string[];
  readonly soleCopyBackupsCount: number;
  readonly soleCopyBackupDigests: readonly string[];
  readonly soleRadioWarnings: readonly string[];
  readonly exclusiveRadios: readonly string[];
  readonly survivingHubIds: readonly string[];
  readonly canDrainAutomatically: boolean;
  readonly requiresForce: boolean;
  readonly blockingReasons: readonly string[];
}

export interface NodeDrainResult {
  readonly nodeId: string;
  readonly drained: boolean;
  readonly migratedWorkloadIds: readonly string[];
  readonly migratedWorkloads: number;
  readonly evacuatedMediaCount: number;
  readonly evacuatedBackupCount: number;
  readonly evacuatedBlobs: number;
  readonly remainingBlobs: number;
  readonly failedDigests: readonly string[];
  readonly decommissionedRemote: boolean;
  readonly remainingPlan: NodeDrainPlan;
}

@Injectable()
export class ClusterDrainService {
  private readonly logger = new Logger(ClusterDrainService.name);
  private readonly planner = new ClusterPlacementPlanner();
  private listNodesHook?: () => readonly DrainNodeSummary[];
  private nodeCapacitiesHook?: () => readonly NodeCapacityInput[];
  private mediaSaveHook?: (digest: string, kind: string, bytes: Buffer) => Promise<void>;

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly leaseService: ClusterLeaseService,
    private readonly syncService: ClusterSyncService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) private readonly transactions?: Transactions,
    @Optional() @Inject(HUB_DATA_DIRECTORY) private readonly dataDir?: string,
  ) {}

  setClusterHooks(hooks: {
    readonly listNodes: () => readonly DrainNodeSummary[];
    readonly getNodeCapacities?: () => readonly NodeCapacityInput[];
    readonly saveEvacuatedBlob?: (digest: string, kind: string, bytes: Buffer) => Promise<void>;
  }): void {
    this.listNodesHook = hooks.listNodes;
    this.nodeCapacitiesHook = hooks.getNodeCapacities;
    this.mediaSaveHook = hooks.saveEvacuatedBlob;
  }

  private resolveClusterNodes(): readonly DrainNodeSummary[] {
    return this.listNodesHook ? this.listNodesHook() : [];
  }

  async inspectDrainPlan(nodeId: string): Promise<NodeDrainPlan> {
    const state = await this.stateStore.ensureInitialized();
    const nodes = this.resolveClusterNodes();
    const target = nodes.find((n) => n.id === nodeId);
    const isLocalNode = nodeId === state.hubId;
    const peerNodes = nodes.filter((n) => n.id !== state.hubId);
    const isSoleHub = isLocalNode && peerNodes.length === 0;
    const online = isLocalNode ? true : Boolean(target?.online ?? false);

    const workloads = this.leaseService.listDecodedWorkloads();
    const activeWorkloads = workloads.filter(
      (w) => w.ownerHubId === nodeId && (w.state === 'active' || w.state === 'draining'),
    );

    const survivingHubIds = [
      ...(isLocalNode ? [] : [state.hubId]),
      ...peerNodes.filter((n) => n.id !== nodeId && n.online && n.enabled).map((n) => n.id),
    ];

    const capacities = this.nodeCapacitiesHook
      ? this.nodeCapacitiesHook()
      : [
          {
            hubId: state.hubId,
            name: 'Primary Hub',
            available: true,
            capacity: detectLocalCapacity(),
          },
          ...peerNodes.map((n) => ({
            hubId: n.id,
            name: n.name,
            available: n.online && n.enabled,
            capacity: detectLocalCapacity(),
          })),
        ];

    const soleRadioWarnings: string[] = [];
    for (const wl of activeWorkloads) {
      const radio = wl.requirements.requiredRadio;
      if (!radio) continue;
      const survivorHasRadio = capacities.some(
        (c) => c.hubId !== nodeId && c.available && c.capacity.attachedRadios.includes(radio),
      );
      if (!survivorHasRadio) {
        soleRadioWarnings.push(`sole_${radio}_owner:${wl.workloadId}`);
      }
    }

    const { soleCopyMediaDigests, soleCopyBackupDigests, soleCopyMediaBytes } =
      await collectSoleCopyAssets({
        nodeId,
        localHubId: state.hubId,
        isLocalNode,
        enabledPeerIds: new Set(peerNodes.filter((p) => p.enabled).map((p) => p.id)),
        dataDir: this.dataDir,
        transactions: this.transactions,
      });

    const hasUndrainedData =
      soleCopyMediaDigests.length > 0 ||
      soleCopyBackupDigests.length > 0 ||
      activeWorkloads.length > 0;

    const blockingReasons: string[] = [];
    if (isSoleHub) blockingReasons.push('cannot_remove_sole_hub');
    else if (isLocalNode) blockingReasons.push('transfer_coordinator_before_removing_self');
    if (soleCopyMediaDigests.length > 0) {
      blockingReasons.push(`sole_copy_media:${soleCopyMediaDigests.length}`);
    }
    if (soleCopyBackupDigests.length > 0) {
      blockingReasons.push(`sole_copy_backups:${soleCopyBackupDigests.length}`);
    }
    if (activeWorkloads.length > 0) {
      blockingReasons.push(`active_workloads:${activeWorkloads.length}`);
    }
    if (soleRadioWarnings.length > 0) {
      blockingReasons.push(...soleRadioWarnings);
    }

    const canEvacuateBlobs =
      (soleCopyMediaDigests.length === 0 && soleCopyBackupDigests.length === 0) ||
      (online && survivingHubIds.length > 0 && Boolean(target?.url));
    const canEvacuateWorkloads =
      activeWorkloads.length === 0 ||
      (survivingHubIds.length > 0 && soleRadioWarnings.length === 0);

    const canDrainAutomatically =
      !isLocalNode && hasUndrainedData && canEvacuateBlobs && canEvacuateWorkloads;
    const requiresForce =
      !isLocalNode &&
      hasUndrainedData &&
      (!online || survivingHubIds.length === 0 || soleRadioWarnings.length > 0 || !target?.url);

    return {
      nodeId,
      isLocalNode,
      isCoordinator: nodeId === state.coordinatorId,
      isSoleHub,
      online,
      canRemoveSafely:
        !isSoleHub && !isLocalNode && !hasUndrainedData && soleRadioWarnings.length === 0,
      requiresForceIfOffline: requiresForce,
      ...(isSoleHub
        ? { blockReason: 'cannot_remove_sole_hub' }
        : isLocalNode
          ? { blockReason: 'transfer_coordinator_before_removing_self' }
          : {}),
      activeWorkloadIds: activeWorkloads.map((w) => w.workloadId),
      workloadsToMigrate: activeWorkloads.map((w) => ({
        workloadId: w.workloadId,
        name: w.name,
        kind: w.kind,
        ...(survivingHubIds[0] ? { suggestedTargetHubId: survivingHubIds[0] } : {}),
      })),
      soleCopyMediaCount: soleCopyMediaDigests.length,
      soleCopyMediaBytes,
      soleCopyMediaDigests,
      soleCopyBackupsCount: soleCopyBackupDigests.length,
      soleCopyBackupDigests,
      soleRadioWarnings,
      exclusiveRadios: soleRadioWarnings,
      survivingHubIds,
      canDrainAutomatically,
      requiresForce,
      blockingReasons,
    };
  }

  /**
   * Migrates active workloads to surviving Hubs and evacuates sole-copy NVR recordings/backups
   * with SHA-256 verification before allowing safe node removal.
   */
  async drainNode(
    nodeId: string,
    options?: {
      readonly targetHubId?: string;
      readonly allowOfflineWorkloadFence?: boolean;
      readonly decommissionPeer?: boolean;
    },
  ): Promise<NodeDrainResult> {
    const state = await this.stateStore.ensureInitialized();
    const plan = await this.inspectDrainPlan(nodeId);
    if (plan.isSoleHub) throw Error('cannot_remove_sole_hub');
    if (plan.isLocalNode) throw Error('transfer_coordinator_before_removing_self');

    const nodes = this.resolveClusterNodes();
    const target = nodes.find((n) => n.id === nodeId);
    const peerTrust = this.stateStore.getPeerTrustRecord(nodeId);
    const identity = this.stateStore.getIdentitySync(state.hubId);

    // 1. Migrate active workloads away from departing node.
    const migratedWorkloadIds: string[] = [];
    if (plan.activeWorkloadIds.length > 0) {
      const capacities: NodeCapacityInput[] = (
        this.nodeCapacitiesHook
          ? this.nodeCapacitiesHook()
          : [
              {
                hubId: state.hubId,
                name: 'Coordinator Hub',
                available: true,
                capacity: detectLocalCapacity(),
              },
              ...nodes.map((n) => ({
                hubId: n.id,
                name: n.name,
                available: n.online && n.enabled,
                capacity: detectLocalCapacity(),
              })),
            ]
      ).map((n) => (n.hubId === nodeId ? { ...n, draining: true, available: false } : n));

      const allPlacementWorkloads = this.leaseService
        .listPlacementWorkloads()
        .filter((w) => plan.activeWorkloadIds.includes(w.id));
      const summary = this.planner.planDistribution({
        workloads: allPlacementWorkloads,
        nodes: capacities,
        currentOwners: new Map(
          this.leaseService.listDecodedWorkloads().map((w) => [w.workloadId, w.ownerHubId]),
        ),
        forceRebalance: true,
      });

      for (const item of summary.plans) {
        const destHubId =
          options?.targetHubId && options.targetHubId !== nodeId
            ? options.targetHubId
            : (item.decision.assignedHubId ?? state.hubId);
        await this.leaseService.handoffWorkload({
          workloadId: item.workload.id,
          targetHubId: destHubId,
          allowOfflineForceFence: options?.allowOfflineWorkloadFence ?? !plan.online,
          beforePromoteSync: async (peerId) => {
            if (this.stateStore.getPeerTrustRecord(peerId)) {
              await this.syncService.syncPeer(peerId).catch(() => undefined);
            }
          },
        });
        migratedWorkloadIds.push(item.workload.id);
      }
    }

    // 2. Evacuate sole-copy NVR media & backups with strict SHA-256 verification.
    let evacuatedMediaCount = 0;
    let evacuatedBackupCount = 0;
    const failedDigests: string[] = [];

    if (target?.url && peerTrust && !peerTrust.revoked) {
      const allDigests: Array<{ digest: string; kind: 'media' | 'backup' }> = [
        ...plan.soleCopyMediaDigests.map((digest) => ({ digest, kind: 'media' as const })),
        ...plan.soleCopyBackupDigests.map((digest) => ({ digest, kind: 'backup' as const })),
      ];

      for (const item of allDigests) {
        try {
          const mediaPath = await resolvePeerMediaDownloadPath(
            item.digest,
            item.kind,
            this.transactions,
          );
          const bytes = await fetchSignedPeerBytes({
            identity,
            homeId: state.homeId,
            targetHubId: nodeId,
            targetUrl: target.url,
            allowHttp: true,
            channelSecret: peerTrust.channelSecret,
            path: mediaPath,
            expectedSha256: item.digest,
          });
          if (createHash('sha256').update(bytes).digest('hex') !== item.digest) {
            throw Error('digest_mismatch');
          }
          await saveEvacuatedBlobAndLocations({
            digest: item.digest,
            kind: item.kind,
            bytes,
            survivingHubId: state.hubId,
            departedHubId: nodeId,
            dataDir: this.dataDir,
            transactions: this.transactions,
            mediaSaveHook: this.mediaSaveHook,
          });

          if (item.kind === 'backup') evacuatedBackupCount += 1;
          else evacuatedMediaCount += 1;
        } catch (err: unknown) {
          this.logger.warn(`Failed evacuating blob ${item.digest} from ${nodeId}: ${String(err)}`);
          failedDigests.push(item.digest);
        }
      }
    } else if (plan.soleCopyMediaDigests.length > 0 || plan.soleCopyBackupDigests.length > 0) {
      failedDigests.push(...plan.soleCopyMediaDigests, ...plan.soleCopyBackupDigests);
    }

    // 3. Optionally notify departing Hub to scrub replicated cluster secrets & keys.
    let decommissionedRemote = false;
    if ((options?.decommissionPeer ?? true) && target?.url && peerTrust && !peerTrust.revoked) {
      try {
        await sendSignedPeerRequest({
          identity,
          homeId: state.homeId,
          targetHubId: nodeId,
          targetUrl: target.url,
          allowHttp: true,
          channelSecret: peerTrust.channelSecret,
          method: 'POST',
          path: '/api/cluster/peer/decommission',
          body: { reason: 'removed_from_cluster', issuedByHubId: state.hubId },
        });
        decommissionedRemote = true;
      } catch {
        // Departing node may be offline; keys are revoked locally regardless.
      }
    }

    const remainingPlan = await this.inspectDrainPlan(nodeId);
    const drained =
      remainingPlan.soleCopyMediaCount === 0 &&
      remainingPlan.soleCopyBackupsCount === 0 &&
      remainingPlan.activeWorkloadIds.length === 0 &&
      failedDigests.length === 0;

    return {
      nodeId,
      drained,
      migratedWorkloadIds,
      migratedWorkloads: migratedWorkloadIds.length,
      evacuatedMediaCount,
      evacuatedBackupCount,
      evacuatedBlobs: evacuatedMediaCount + evacuatedBackupCount,
      remainingBlobs: failedDigests.length,
      failedDigests,
      decommissionedRemote,
      remainingPlan,
    };
  }
}
