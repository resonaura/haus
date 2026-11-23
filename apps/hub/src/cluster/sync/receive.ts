/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HubAuthService } from '../../auth/service.js';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import type { ClusterLeaseService } from '../coordination/leases.js';
import type { ClusterStateStore } from '../coordination/state.js';
import {
  openClusterEnvelope,
  type BoundedReplayGuard,
  type ClusterSecretEnvelope,
} from '../crypto/envelope.js';
import { applyIncomingWorkloads, applyOpenedSyncBundle } from './merge.js';
import type { ClusterSnapshotCodec } from './snapshot.js';
import type { ClusterTelemetrySync } from './telemetry.js';

export interface ReceiveEnvelopesInput {
  readonly senderHubId: string;
  readonly envelopes: readonly ClusterSecretEnvelope[];
  readonly workloads?: readonly ClusterWorkloadRow[];
  readonly acceptEqualRevision?: boolean;
}

export interface ReceiveEnvelopesResult {
  readonly accepted: number;
  readonly rejected: readonly { readonly resourceId: string; readonly reason: string }[];
  readonly appliedItems: number;
}

export const EMPTY_SYNC_RESULT: ReceiveEnvelopesResult = {
  accepted: 0,
  rejected: [],
  appliedItems: 0,
};

/** Verifies, decrypts, enforces monotonic watermarks, and re-seals received cluster state. */
export async function applyReceivedPeerEnvelopes(deps: {
  readonly stateStore: ClusterStateStore;
  readonly leaseService: ClusterLeaseService;
  readonly codec: ClusterSnapshotCodec;
  readonly telemetrySync: ClusterTelemetrySync;
  readonly replayGuard: BoundedReplayGuard;
  readonly authService?: HubAuthService;
  readonly isDestroyed: () => boolean;
  readonly notifyApplied: (
    appliedKinds: ReadonlySet<'credential' | 'config' | 'cache' | 'telemetry'>,
  ) => Promise<void>;
  readonly params: ReceiveEnvelopesInput;
}): Promise<ReceiveEnvelopesResult> {
  if (deps.isDestroyed()) return EMPTY_SYNC_RESULT;
  const { params } = deps;
  const state = await deps.stateStore.ensureInitialized();
  const identity = deps.stateStore.getIdentitySync(state.hubId);
  const peer = deps.stateStore.getPeerTrustRecord(params.senderHubId);
  if (!peer || peer.revoked) throw Error('untrusted_or_revoked_peer');
  if (peer.homeId !== state.homeId) throw Error('wrong_home');

  let accepted = 0;
  let appliedItems = 0;
  let workloadsUpdated = false;
  const appliedKinds = new Set<'credential' | 'config' | 'cache' | 'telemetry'>();
  const rejected: Array<{ readonly resourceId: string; readonly reason: string }> = [];
  const fromCoordinator =
    state.role !== 'coordinator' && params.senderHubId === state.coordinatorId;

  // Apply workload lease hints before config bundle so standby Apps stay stopped unless owned here.
  if (Array.isArray(params.workloads)) {
    workloadsUpdated = await applyIncomingWorkloads(
      deps.stateStore,
      params.workloads,
      fromCoordinator,
    );
  }

  for (const env of params.envelopes) {
    if (deps.isDestroyed()) break;
    if (env.senderHubId !== params.senderHubId) {
      rejected.push({ resourceId: env.resourceId, reason: 'sender_mismatch' });
      continue;
    }
    const inboundSyncKey = `inbound:${params.senderHubId}:${env.kind}:${env.resourceId}`;
    const existingSync = deps.stateStore.getSyncState(inboundSyncKey);
    const lastAcceptedWatermark =
      existingSync && !params.acceptEqualRevision
        ? {
            epoch: existingSync.epoch,
            revision: existingSync.revision,
            generation: existingSync.generation,
          }
        : undefined;

    try {
      const opened = openClusterEnvelope({
        identity,
        expectedHomeId: state.homeId,
        senderSigningPublicKey: peer.signingPublicKey,
        envelope: env,
        replayGuard: deps.replayGuard,
        minExpectedEpoch: state.coordinatorEpoch,
        lastAcceptedWatermark,
      });
      const applied = await applyOpenedSyncBundle({
        kind: opened.meta.kind,
        payload: opened.payload,
        localHubId: state.hubId,
        authoritativePrune: fromCoordinator,
        codec: deps.codec,
        applyTelemetryDelta: (delta) => deps.telemetrySync.applyDelta(delta),
      });
      appliedItems += applied.appliedItems;
      if (applied.appliedKind) appliedKinds.add(applied.appliedKind);

      await deps.stateStore.saveSyncState({
        syncKey: inboundSyncKey,
        kind: opened.meta.kind,
        resourceId: opened.meta.resourceId,
        revision: opened.meta.revision,
        generation: opened.meta.generation,
        epoch: opened.meta.epoch,
        sha256: deps.codec.computePayloadDigest(opened.payload),
        sourceHubId: opened.meta.senderHubId,
        updatedAt: Date.now(),
      });
      accepted += 1;
    } catch (err: unknown) {
      rejected.push({
        resourceId: `${env.kind}:${env.resourceId}`,
        reason: err instanceof Error ? err.message : 'envelope_rejected',
      });
    }
  }

  if (accepted > 0) {
    if (appliedKinds.has('credential')) await deps.authService?.loadPersistedSessions();
    await deps.notifyApplied(appliedKinds);
    if (workloadsUpdated && !appliedKinds.has('config') && !appliedKinds.has('credential')) {
      await deps.leaseService.reconcileLocalControllers();
    }
  } else if (Array.isArray(params.workloads) && params.workloads.length > 0) {
    await deps.leaseService.reconcileLocalControllers();
  }
  return { accepted, rejected, appliedItems };
}
