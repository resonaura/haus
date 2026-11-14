/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LIVE_SERVICE } from '../../live/tokens.js';
import type { LiveService } from '../../live/types.js';
import { ClusterLeaseService, type SignedFencingProof } from './leases.js';
import { ClusterStateStore } from './state.js';

export interface ActiveWorkloadClaim {
  readonly workloadId: string;
  readonly hubId: string;
  readonly generation: number;
  readonly epoch: number;
  readonly role: 'coordinator' | 'node' | 'standalone' | 'fenced';
  readonly preferredHubId?: string;
  readonly configRevision: number;
  readonly credentialRevision: number;
  readonly cacheRevision: number;
  readonly runningLocally: boolean;
}

export interface HubClaimSnapshot {
  readonly hubId: string;
  readonly homeId: string;
  readonly role: 'coordinator' | 'node' | 'standalone' | 'fenced';
  readonly coordinatorEpoch: number;
  readonly coordinatorId: string;
  readonly fenced: boolean;
  readonly generatedAt: number;
  readonly activeWorkloads: readonly ActiveWorkloadClaim[];
}

export interface SplitBrainConflictResolution {
  readonly workloadId: string;
  readonly conflictingHubIds: readonly string[];
  readonly winnerHubId: string;
  readonly fencedHubIds: readonly string[];
  readonly newerCredentialSourceHubId?: string;
}

export interface ReconciliationOutcome {
  readonly converged: boolean;
  readonly reconciled: boolean;
  readonly conflictsDetected: number;
  readonly resolvedConflicts: readonly SplitBrainConflictResolution[];
  readonly dualCoordinatorResolved: boolean;
  readonly winningCoordinatorId: string;
  readonly coordinatorId: string;
  readonly winningEpoch: number;
  readonly epoch: number;
  readonly role: 'coordinator' | 'node' | 'standalone' | 'fenced';
  readonly fencedLocalCount: number;
  readonly fencedRemoteCount: number;
  readonly stoppedWorkloads: number;
  readonly conflictingCoordinators: readonly string[];
  readonly reconciledAt: string;
}

/** Deterministic total order over competing active workload claims (identical on every Hub). */
export function compareClaimPriority(a: ActiveWorkloadClaim, b: ActiveWorkloadClaim): number {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? -1 : 1;
  if (a.generation !== b.generation) return a.generation > b.generation ? -1 : 1;
  const aCoord = a.role === 'coordinator' ? 1 : 0;
  const bCoord = b.role === 'coordinator' ? 1 : 0;
  if (aCoord !== bCoord) return aCoord > bCoord ? -1 : 1;
  const aPref = a.preferredHubId === a.hubId ? 1 : 0;
  const bPref = b.preferredHubId === b.hubId ? 1 : 0;
  if (aPref !== bPref) return aPref > bPref ? -1 : 1;
  return a.hubId.localeCompare(b.hubId);
}

@Injectable()
export class ClusterReconciliationService {
  private readonly logger = new Logger(ClusterReconciliationService.name);
  private remoteFenceHook?: (
    targetHubId: string,
    workloadId: string,
    winnerHubId: string,
    newGeneration: number,
    newEpoch: number,
    proof: SignedFencingProof,
  ) => Promise<boolean>;
  private pullHigherRevisionHook?: (sourceHubId: string, workloadId: string) => Promise<void>;

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly leaseService: ClusterLeaseService,
    @Optional() @Inject(LIVE_SERVICE) private readonly liveService?: LiveService,
  ) {}

  setRemoteHandlers(handlers: {
    readonly fenceRemoteWorkload: (
      targetHubId: string,
      workloadId: string,
      winnerHubId: string,
      newGeneration: number,
      newEpoch: number,
      proof: SignedFencingProof,
    ) => Promise<boolean>;
    readonly pullHigherRevision?: (sourceHubId: string, workloadId: string) => Promise<void>;
  }): void {
    this.remoteFenceHook = handlers.fenceRemoteWorkload;
    this.pullHigherRevisionHook = handlers.pullHigherRevision;
  }

  buildLocalClaimSnapshot(): HubClaimSnapshot {
    const state = this.stateStore.getStateSync();
    const workloads = this.leaseService.listDecodedWorkloads();
    const registeredIds = new Set(this.leaseService.listRegisteredWorkloadIds());
    const activeWorkloads: ActiveWorkloadClaim[] = [];

    for (const wl of workloads) {
      const ctrl = this.leaseService.getController(wl.workloadId);
      const runningLocally = ctrl ? ctrl.getLocalStatus() === 'running' : false;
      if ((wl.ownerHubId === state.hubId && wl.state === 'active') || runningLocally) {
        activeWorkloads.push({
          workloadId: wl.workloadId,
          hubId: state.hubId,
          generation: wl.generation,
          epoch: Math.max(wl.epoch, state.coordinatorEpoch),
          role: state.role,
          ...(wl.preferredHubId ? { preferredHubId: wl.preferredHubId } : {}),
          configRevision: wl.configRevision,
          credentialRevision: wl.credentialRevision,
          cacheRevision: wl.cacheRevision,
          runningLocally,
        });
      }
      registeredIds.delete(wl.workloadId);
    }

    // Check if an unrecorded local controller was accidentally left running during split/recovery.
    for (const workloadId of registeredIds) {
      const ctrl = this.leaseService.getController(workloadId);
      if (ctrl && ctrl.getLocalStatus() === 'running') {
        activeWorkloads.push({
          workloadId,
          hubId: state.hubId,
          generation: 1,
          epoch: state.coordinatorEpoch,
          role: state.role,
          ...(ctrl.preferredHubId ? { preferredHubId: ctrl.preferredHubId } : {}),
          configRevision: 1,
          credentialRevision: 1,
          cacheRevision: 1,
          runningLocally: true,
        });
      }
    }

    return {
      hubId: state.hubId,
      homeId: state.homeId,
      role: state.role,
      coordinatorEpoch: state.coordinatorEpoch,
      coordinatorId: state.coordinatorId,
      fenced: state.fenced,
      generatedAt: Date.now(),
      activeWorkloads,
    };
  }

  /**
   * Resolves dual-active Apps/integrations AND dual-coordinator split-brain deterministically across peers,
   * fencing losing hardware copies, preserving newer credential revisions, and publishing converged state once.
   */
  async reconcileClaims(
    peerSnapshots: readonly HubClaimSnapshot[],
  ): Promise<ReconciliationOutcome> {
    const local = this.buildLocalClaimSnapshot();
    const state = this.stateStore.getStateSync();
    const validPeers = peerSnapshots.filter(
      (snap) => snap.homeId === state.homeId && snap.hubId !== state.hubId,
    );
    const allSnapshots = [local, ...validPeers];

    // 1. Resolve Dual-Coordinator split-brain if multiple unfenced Hubs claim coordinator role.
    const coordinators = allSnapshots
      .filter((s) => s.role === 'coordinator' && !s.fenced)
      .sort((a, b) => {
        if (a.coordinatorEpoch !== b.coordinatorEpoch) {
          return b.coordinatorEpoch - a.coordinatorEpoch;
        }
        return a.hubId.localeCompare(b.hubId);
      });

    let dualCoordinatorResolved = false;
    let winningCoordinatorId = state.coordinatorId;
    let winningEpoch = Math.max(
      ...allSnapshots.map((s) => s.coordinatorEpoch),
      state.coordinatorEpoch,
    );

    if (coordinators.length > 0) {
      winningCoordinatorId = coordinators[0]!.hubId;
      winningEpoch = Math.max(winningEpoch, coordinators[0]!.coordinatorEpoch);
      if (coordinators.length > 1) {
        dualCoordinatorResolved = true;
        if (state.role === 'coordinator' && !state.fenced && winningCoordinatorId !== state.hubId) {
          this.logger.warn(
            `Dual-coordinator split-brain detected: yielding ${state.hubId} to winning coordinator ${winningCoordinatorId} at epoch ${winningEpoch}`,
          );
          await this.stateStore.saveState({
            role: 'node',
            coordinatorId: winningCoordinatorId,
            coordinatorEpoch: winningEpoch,
            fenced: false,
            fencedReason: undefined,
          });
        } else if (
          state.coordinatorId !== winningCoordinatorId ||
          state.coordinatorEpoch < winningEpoch
        ) {
          await this.stateStore.saveState({
            coordinatorId: winningCoordinatorId,
            coordinatorEpoch: winningEpoch,
          });
        }
      }
    }

    // 2. Group active workload claims across all reachable Hubs.
    const byWorkload = new Map<string, ActiveWorkloadClaim[]>();
    for (const snap of allSnapshots) {
      for (const claim of snap.activeWorkloads) {
        const list = byWorkload.get(claim.workloadId) ?? [];
        list.push(claim);
        byWorkload.set(claim.workloadId, list);
      }
    }

    const resolvedConflicts: SplitBrainConflictResolution[] = [];
    let fencedLocalCount = 0;
    let fencedRemoteCount = 0;

    for (const [workloadId, claims] of byWorkload) {
      if (claims.length <= 1) continue;
      const sorted = [...claims].sort(compareClaimPriority);
      const winner = sorted[0]!;
      const losers = sorted.slice(1);
      const nextGeneration = winner.generation + 1;
      const nextEpoch = Math.max(winner.epoch, winningEpoch);

      // Identify if any fenced loser obtained a higher credential/config revision during partition.
      let newerCredHub: string | undefined;
      let highestCredRev = winner.credentialRevision;
      for (const loser of losers) {
        if (loser.credentialRevision > highestCredRev) {
          highestCredRev = loser.credentialRevision;
          newerCredHub = loser.hubId;
        }
      }

      if (newerCredHub && winner.hubId === state.hubId && this.pullHigherRevisionHook) {
        await this.pullHigherRevisionHook(newerCredHub, workloadId).catch((err: unknown) => {
          this.logger.warn(`Failed pulling newer revision from ${newerCredHub}: ${String(err)}`);
        });
      }

      const fencedHubIds: string[] = [];
      for (const loser of losers) {
        if (loser.hubId === state.hubId) {
          await this.leaseService.fenceLocalWorkload({
            workloadId,
            reason: 'split_brain_reconciled',
            newOwnerHubId: winner.hubId,
            newGeneration: nextGeneration,
            newEpoch: nextEpoch,
          });
          fencedLocalCount += 1;
          fencedHubIds.push(loser.hubId);
        } else {
          const proof = this.leaseService.createSignedFencingProof({
            resourceId: workloadId,
            priorOwnerHubId: loser.hubId,
            newOwnerHubId: winner.hubId,
            fencedGeneration: loser.generation,
            epoch: nextEpoch,
            proofType: 'witness_quorum',
          });
          if (this.remoteFenceHook) {
            await this.remoteFenceHook(
              loser.hubId,
              workloadId,
              winner.hubId,
              nextGeneration,
              nextEpoch,
              proof,
            ).catch((err: unknown) => {
              this.logger.warn(
                `Failed delivering fence command to ${loser.hubId} for ${workloadId}: ${String(err)}`,
              );
            });
          }
          fencedRemoteCount += 1;
          fencedHubIds.push(loser.hubId);
        }
      }

      const existing = this.stateStore.getWorkloadSync(workloadId);
      if (existing) {
        let existingStandby: string[] = [];
        try {
          const parsed: unknown = JSON.parse(existing.standbyHubIdsJson || '[]');
          if (Array.isArray(parsed)) {
            existingStandby = parsed.filter((id): id is string => typeof id === 'string');
          }
        } catch {
          existingStandby = [];
        }
        const standbyIds = new Set<string>(existingStandby);
        for (const claim of claims) {
          if (claim.hubId !== winner.hubId) {
            standbyIds.add(claim.hubId);
          }
        }
        standbyIds.delete(winner.hubId);
        await this.stateStore.saveWorkload({
          ...existing,
          ownerHubId: winner.hubId,
          standbyHubIdsJson: JSON.stringify([...standbyIds]),
          state:
            winner.hubId === state.hubId || state.role === 'coordinator' ? 'active' : 'standby',
          generation: nextGeneration,
          epoch: nextEpoch,
          credentialRevision: Math.max(existing.credentialRevision, highestCredRev),
          updatedAt: Date.now(),
        });
      }

      resolvedConflicts.push({
        workloadId,
        conflictingHubIds: claims.map((c) => c.hubId),
        winnerHubId: winner.hubId,
        fencedHubIds,
        ...(newerCredHub ? { newerCredentialSourceHubId: newerCredHub } : {}),
      });
    }

    if (dualCoordinatorResolved || resolvedConflicts.length > 0) {
      // Single debounced converged publication so UI clients do not oscillate.
      this.liveService?.publish('cluster');
      this.liveService?.publish('apps');
      this.liveService?.publish('devices');
    }

    const updatedState = this.stateStore.getStateSync();
    return {
      converged: true,
      reconciled: true,
      conflictsDetected: resolvedConflicts.length,
      resolvedConflicts,
      dualCoordinatorResolved,
      winningCoordinatorId,
      coordinatorId: winningCoordinatorId,
      winningEpoch,
      epoch: winningEpoch,
      role: updatedState.role,
      fencedLocalCount,
      fencedRemoteCount,
      stoppedWorkloads: fencedLocalCount + fencedRemoteCount,
      conflictingCoordinators: resolvedConflicts.flatMap((c) => c.fencedHubIds),
      reconciledAt: new Date().toISOString(),
    };
  }
}
