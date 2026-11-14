/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import type { ClusterDrainService } from '../drain/service.js';
import type { ClusterSyncService } from '../sync/service.js';
import { DEFAULT_LEASE_TTL_MS, type WorkloadExecutionController } from './lease-types.js';
import type { ClusterLeaseService } from './leases.js';
import type { ClusterReconciliationService, HubClaimSnapshot } from './reconcile.js';
import type { ClusterStateStore } from './state.js';

export async function reconcileControllersWithLeases(params: {
  readonly stateStore: ClusterStateStore;
  readonly controllers: ReadonlyMap<string, WorkloadExecutionController>;
  readonly shouldRunLocally: (workloadId: string, now: number) => boolean;
  readonly stopAllLocalWorkloads: (reason: string) => Promise<void>;
  readonly logger: Logger;
  readonly now?: number;
}): Promise<void> {
  const now = params.now ?? Date.now();
  const state = await params.stateStore.ensureInitialized();
  if (state.fenced || state.role === 'fenced') {
    await params.stopAllLocalWorkloads('node_fenced');
    return;
  }

  for (const [workloadId, ctrl] of params.controllers) {
    const row = params.stateStore.getWorkloadSync(workloadId);
    const allowed = params.shouldRunLocally(workloadId, now);
    const status = ctrl.getLocalStatus();
    if (!allowed && status === 'running') {
      const reason =
        row && row.leaseExpiresAt > 0 && row.leaseExpiresAt <= now
          ? 'lease_expired'
          : 'lease_not_owned';
      try {
        await ctrl.stopLocal(reason);
      } catch (err: unknown) {
        params.logger.warn(`Failed stopping local workload ${workloadId}: ${String(err)}`);
      }
      continue;
    }

    if (
      allowed &&
      status !== 'running' &&
      row &&
      row.state === 'active' &&
      row.ownerHubId === state.hubId
    ) {
      try {
        await ctrl.startLocal();
      } catch (err: unknown) {
        params.logger.warn(`Failed starting local workload ${workloadId}: ${String(err)}`);
      }
    }
  }
}

export async function renewAndEnforceLeases(params: {
  readonly stateStore: ClusterStateStore;
  readonly controllers: ReadonlyMap<string, WorkloadExecutionController>;
  readonly shouldRunLocally: (workloadId: string, now: number) => boolean;
  readonly stopAllLocalWorkloads: (reason: string) => Promise<void>;
  readonly logger: Logger;
  readonly now?: number;
  readonly onlinePeerHubIds?: ReadonlySet<string>;
}): Promise<{ readonly renewedPeerLeases: boolean }> {
  const now = params.now ?? Date.now();
  const state = await params.stateStore.ensureInitialized();
  if (state.fenced || state.role === 'fenced') {
    await params.stopAllLocalWorkloads('node_fenced');
    return { renewedPeerLeases: false };
  }

  // Only Coordinator / Standalone Hubs hold authority to extend lease expirations.
  // Secondary nodes rely on synced heartbeats so partitioned secondaries expire deterministically.
  const hasAuthority = state.role === 'coordinator' || state.role === 'standalone';
  let renewedPeerLeases = false;
  if (hasAuthority) {
    for (const row of params.stateStore.listWorkloadsSync()) {
      if (row.state !== 'active') continue;
      if (row.ownerHubId === state.hubId) {
        const nextRow: ClusterWorkloadRow = {
          ...row,
          epoch: Math.max(row.epoch, state.coordinatorEpoch),
          leaseExpiresAt: now + DEFAULT_LEASE_TTL_MS,
          updatedAt: now,
        };
        await params.stateStore.saveWorkload(nextRow);
      } else if (params.onlinePeerHubIds?.has(row.ownerHubId)) {
        const nextRow: ClusterWorkloadRow = {
          ...row,
          epoch: Math.max(row.epoch, state.coordinatorEpoch),
          leaseExpiresAt: now + DEFAULT_LEASE_TTL_MS,
          updatedAt: now,
        };
        await params.stateStore.saveWorkload(nextRow);
        renewedPeerLeases = true;
      }
    }
  }

  await reconcileControllersWithLeases({
    stateStore: params.stateStore,
    controllers: params.controllers,
    shouldRunLocally: params.shouldRunLocally,
    stopAllLocalWorkloads: params.stopAllLocalWorkloads,
    logger: params.logger,
    now,
  });

  return { renewedPeerLeases };
}

export async function runOrchestratorMaintenanceTick(params: {
  readonly stateStore: ClusterStateStore;
  readonly leaseService: ClusterLeaseService;
  readonly syncService: ClusterSyncService;
  readonly reconcileService: ClusterReconciliationService;
  readonly hasEnabledPeers: () => boolean;
  readonly pollPeerStatuses: () => Promise<HubClaimSnapshot[]>;
  readonly isDestroyed: () => boolean;
}): Promise<void> {
  const state = await params.stateStore.ensureInitialized();
  if (params.isDestroyed()) return;
  if (state.fenced || state.role === 'fenced') {
    await params.leaseService.stopAllLocalWorkloads('node_fenced');
    return;
  }

  const hasPeers = params.hasEnabledPeers();
  const peerSnapshots = hasPeers ? await params.pollPeerStatuses() : [];
  if (params.isDestroyed()) return;

  const onlinePeerHubIds = new Set(peerSnapshots.map((snapshot) => snapshot.hubId));
  const { renewedPeerLeases } = await params.leaseService.renewLocalLeases(
    Date.now(),
    hasPeers ? onlinePeerHubIds : undefined,
  );
  if (params.isDestroyed()) return;

  if (hasPeers) {
    const outcome = await params.reconcileService.reconcileClaims(peerSnapshots);
    const converged = outcome.resolvedConflicts.length > 0 || outcome.dualCoordinatorResolved;
    const latest = params.stateStore.getStateSync();
    if ((converged || renewedPeerLeases) && latest.role === 'coordinator' && !latest.fenced) {
      await params.syncService.syncAllPeers();
    }
  }
}

export async function verifyAndDrainBeforeRemoveNode(params: {
  readonly stateStore: ClusterStateStore;
  readonly drainService: ClusterDrainService;
  readonly nodeId: string;
  readonly options?: { readonly force?: boolean; readonly targetHubId?: string };
}): Promise<void> {
  const { drainService, stateStore, nodeId, options } = params;
  const plan = await drainService.inspectDrainPlan(nodeId);
  if (plan.isSoleHub) {
    throw new HttpException(
      { error: 'cannot_remove_sole_hub', drainPlan: plan },
      HttpStatus.CONFLICT,
    );
  }
  if (plan.isLocalNode) {
    throw new HttpException(
      { error: 'transfer_coordinator_before_removing_self', drainPlan: plan },
      HttpStatus.CONFLICT,
    );
  }
  const needsDrain =
    plan.activeWorkloadIds.length > 0 ||
    plan.soleCopyMediaCount > 0 ||
    plan.soleCopyBackupsCount > 0 ||
    Boolean(stateStore.getPeerTrustRecord(nodeId));
  if (!needsDrain) return;

  let drainResult;
  try {
    drainResult = await drainService.drainNode(nodeId, {
      targetHubId: options?.targetHubId,
      allowOfflineWorkloadFence: Boolean(options?.force),
      decommissionPeer: true,
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message === 'previous_owner_stop_unconfirmed' &&
      !options?.force
    ) {
      throw new HttpException(
        {
          error: 'undrained_data_requires_force',
          drainPlan: plan,
          failedWorkloads: plan.activeWorkloadIds,
        },
        HttpStatus.CONFLICT,
      );
    }
    throw err;
  }
  const unresolved = !drainResult.drained || plan.soleRadioWarnings.length > 0;
  if (unresolved && !options?.force) {
    throw new HttpException(
      {
        error: 'undrained_data_requires_force',
        drainPlan: drainResult.remainingPlan,
        failedDigests: drainResult.failedDigests,
      },
      HttpStatus.CONFLICT,
    );
  }
}
