/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import type { ClusterStateStore } from '../coordination/state.js';
import { sealClusterEnvelope, type ClusterSecretEnvelope } from '../crypto/envelope.js';
import { exportSyncCandidates, yieldEventLoop } from './merge.js';
import type { ClusterSnapshotCodec } from './snapshot.js';

export type CoreSyncBundleKind = 'credential' | 'config' | 'cache';

export const ALL_CORE_SYNC_KINDS: readonly CoreSyncBundleKind[] = ['credential', 'config', 'cache'];
export const ALL_CORE_SYNC_KINDS_SET: ReadonlySet<CoreSyncBundleKind> = new Set(
  ALL_CORE_SYNC_KINDS,
);

export interface BuildPeerEnvelopesParams {
  readonly recipientHubId: string;
  readonly includeHomeKit?: boolean;
  readonly includeHistory?: boolean;
  readonly force?: boolean;
  readonly kinds?: readonly CoreSyncBundleKind[];
}

/** Exports dirty bundle candidates, bumps local revisions when changed, and seals E2EE envelopes. */
export async function buildSealedPeerEnvelopes(params: {
  readonly stateStore: ClusterStateStore;
  readonly codec: ClusterSnapshotCodec;
  readonly peerLastSentDigest: ReadonlyMap<string, string>;
  readonly peerLastSentStatesDigest: ReadonlyMap<string, string>;
  readonly request: BuildPeerEnvelopesParams;
}): Promise<{
  readonly envelopes: readonly ClusterSecretEnvelope[];
  readonly workloads: readonly ClusterWorkloadRow[];
  readonly digests: ReadonlyArray<{ readonly syncKey: string; readonly sha256: string }>;
  readonly cacheStatesDigest?: string;
}> {
  const { stateStore, codec, request } = params;
  const state = await stateStore.ensureInitialized();
  const identity = stateStore.getIdentitySync(state.hubId);
  const peer = stateStore.getPeerTrustRecord(request.recipientHubId);
  if (!peer || peer.revoked) throw Error('untrusted_or_revoked_peer');

  const requestedKinds = request.kinds ? new Set(request.kinds) : ALL_CORE_SYNC_KINDS_SET;
  const includeHistory = Boolean(request.force) || request.includeHistory !== false;
  const candidates = await exportSyncCandidates({
    codec,
    requestedKinds,
    includeHomeKit: request.includeHomeKit ?? true,
    includeHistory,
  });

  const envelopes: ClusterSecretEnvelope[] = [];
  const digests: Array<{ readonly syncKey: string; readonly sha256: string }> = [];
  let cacheStatesDigest: string | undefined;
  for (const item of candidates) {
    if (
      item.kind === 'cache' &&
      !includeHistory &&
      !request.force &&
      item.statesDigest &&
      params.peerLastSentStatesDigest.get(peer.hubId) === item.statesDigest
    ) {
      continue;
    }
    const syncKey = `${item.kind}:${item.resourceId}`;
    const sha256 = codec.computePayloadDigest(item.payload);
    const current = stateStore.getSyncState(syncKey);
    const localChanged = !current || current.sha256 !== sha256 || Boolean(request.force);
    const peerKey = `${peer.hubId}:${syncKey}`;
    const peerChanged = params.peerLastSentDigest.get(peerKey) !== sha256 || Boolean(request.force);
    if (!request.force && !localChanged && !peerChanged) continue;
    const revision = localChanged ? (current?.revision ?? 0) + 1 : current.revision;
    const generation = localChanged ? (current?.generation ?? 0) + 1 : current.generation;

    if (localChanged) {
      await stateStore.saveSyncState({
        syncKey,
        kind: item.kind,
        resourceId: item.resourceId,
        revision,
        generation,
        epoch: state.coordinatorEpoch,
        sha256,
        sourceHubId: state.hubId,
        updatedAt: Date.now(),
      });
    }

    digests.push({ syncKey, sha256 });
    if (item.statesDigest) cacheStatesDigest = item.statesDigest;
    await yieldEventLoop();
    envelopes.push(
      sealClusterEnvelope({
        identity,
        homeId: state.homeId,
        recipientHubId: peer.hubId,
        recipientExchangePublicKey: peer.exchangePublicKey,
        kind: item.kind,
        resourceId: item.resourceId,
        revision,
        generation,
        epoch: state.coordinatorEpoch,
        payload: item.payload,
      }),
    );
  }

  return {
    envelopes,
    workloads: stateStore.listWorkloadsSync(),
    digests,
    cacheStatesDigest,
  };
}
