/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import type { ClusterStateStore } from '../coordination/state.js';
import type { BoundedReplayGuard } from '../crypto/envelope.js';
import type { CredentialBundlePayload } from '../sync/snapshot.js';
import {
  calculateTransferManifestChecksum,
  openTransferCredentialEnvelope,
  type HubTransferManifest,
  type RemoteTransferCommitPayload,
  type RemoteTransferPreparePayload,
  type RemoteTransferRollbackPayload,
} from './remote.js';

export async function transferWorkloadsOwnership(
  stateStore: ClusterStateStore | undefined,
  sourceHubId: string,
  targetHubId: string,
  epoch: number,
): Promise<void> {
  if (!stateStore) return;
  for (const wl of stateStore.listWorkloadsSync()) {
    if (wl.ownerHubId !== sourceHubId) continue;
    await stateStore.saveWorkload({
      ...wl,
      ownerHubId: targetHubId,
      generation: wl.generation + 1,
      epoch: Math.max(wl.epoch, epoch),
      state: 'active',
      updatedAt: Date.now(),
    });
  }
}

export async function handleIncomingTransferPrepare(params: {
  readonly stateStore?: ClusterStateStore;
  readonly incomingPrepared: Map<string, RemoteTransferPreparePayload>;
  readonly senderHubId: string;
  readonly payload: RemoteTransferPreparePayload;
}): Promise<{ readonly prepared: boolean; readonly transferId: string }> {
  if (!params.stateStore) {
    throw new HttpException({ error: 'cluster_state_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
  }
  const state = await params.stateStore.ensureInitialized();
  const { payload } = params;
  if (payload.homeId !== state.homeId) {
    throw new HttpException({ error: 'wrong_home' }, HttpStatus.FORBIDDEN);
  }
  if (payload.targetHubId !== state.hubId || payload.sourceHubId !== params.senderHubId) {
    throw new HttpException({ error: 'transfer_target_mismatch' }, HttpStatus.FORBIDDEN);
  }
  if (payload.epoch <= state.coordinatorEpoch) {
    throw new HttpException({ error: 'stale_transfer_epoch' }, HttpStatus.CONFLICT);
  }
  if (calculateTransferManifestChecksum(payload.manifest) !== payload.checksum) {
    throw new HttpException({ error: 'checksum_mismatch' }, HttpStatus.BAD_REQUEST);
  }
  params.incomingPrepared.set(payload.transferId, payload);
  return { prepared: true, transferId: payload.transferId };
}

export async function handleIncomingTransferCommit(params: {
  readonly stateStore?: ClusterStateStore;
  readonly incomingPrepared: Map<string, RemoteTransferPreparePayload>;
  readonly transferReplayGuard: BoundedReplayGuard;
  readonly senderHubId: string;
  readonly payload: RemoteTransferCommitPayload;
  readonly applyManifest: (manifest: HubTransferManifest) => Promise<void>;
  readonly applyCredentialBundle: (bundle: CredentialBundlePayload) => Promise<void>;
  readonly promoteAfterIncomingTransfer: (args: {
    readonly epoch: number;
    readonly newCoordinatorHubId: string;
    readonly previousCoordinatorHubId: string;
  }) => Promise<void>;
}): Promise<{ readonly committed: boolean; readonly transferId: string; readonly epoch: number }> {
  if (!params.stateStore) {
    throw new HttpException({ error: 'cluster_state_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
  }
  const state = await params.stateStore.ensureInitialized();
  const prepared = params.incomingPrepared.get(params.payload.transferId);
  if (!prepared) {
    throw new HttpException({ error: 'prepared_transfer_not_found' }, HttpStatus.NOT_FOUND);
  }
  if (
    prepared.sourceHubId !== params.senderHubId ||
    prepared.targetHubId !== state.hubId ||
    prepared.checksum !== params.payload.checksum ||
    prepared.epoch !== params.payload.epoch
  ) {
    throw new HttpException({ error: 'transfer_commit_mismatch' }, HttpStatus.CONFLICT);
  }
  if (prepared.credentialEnvelope) {
    const peer = params.stateStore.getPeerTrustRecord(params.senderHubId);
    if (!peer || peer.revoked) {
      throw new HttpException({ error: 'untrusted_or_revoked_peer' }, HttpStatus.FORBIDDEN);
    }
    const bundle = openTransferCredentialEnvelope({
      identity: params.stateStore.getIdentitySync(state.hubId),
      expectedHomeId: state.homeId,
      senderSigningPublicKey: peer.signingPublicKey,
      envelope: prepared.credentialEnvelope,
      replayGuard: params.transferReplayGuard,
      minExpectedEpoch: state.coordinatorEpoch,
    });
    await params.applyManifest(prepared.manifest);
    await params.applyCredentialBundle(bundle);
  } else {
    await params.applyManifest(prepared.manifest);
  }
  if (Array.isArray(prepared.workloads)) {
    for (const wl of prepared.workloads) await params.stateStore.saveWorkload(wl);
  }
  await params.promoteAfterIncomingTransfer({
    epoch: prepared.epoch,
    newCoordinatorHubId: state.hubId,
    previousCoordinatorHubId: prepared.sourceHubId,
  });
  params.incomingPrepared.delete(params.payload.transferId);
  return { committed: true, transferId: params.payload.transferId, epoch: prepared.epoch };
}

export function handleIncomingTransferRollback(params: {
  readonly incomingPrepared: Map<string, RemoteTransferPreparePayload>;
  readonly senderHubId: string;
  readonly payload: RemoteTransferRollbackPayload;
}): { readonly rolledBack: boolean; readonly transferId: string } {
  const existing = params.incomingPrepared.get(params.payload.transferId);
  if (existing && existing.sourceHubId === params.senderHubId) {
    params.incomingPrepared.delete(params.payload.transferId);
  }
  return { rolledBack: true, transferId: params.payload.transferId };
}
