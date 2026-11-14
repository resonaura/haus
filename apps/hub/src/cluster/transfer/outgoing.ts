/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ClusterNodeEntity } from '../../storage/entities/domains.js';
import type { ClusterStateStore } from '../coordination/state.js';
import type { ClusterSnapshotCodec } from '../sync/snapshot.js';
import type { HubTransferIntentDto } from '../transfer.dto.js';
import {
  buildTransferCredentialEnvelope,
  sendRemoteTransferCommit,
  sendRemoteTransferPrepare,
  sendRemoteTransferRollback,
  type HubTransferManifest,
} from './remote.js';

export interface OutgoingTransferRecord {
  intent: HubTransferIntentDto;
  manifest: HubTransferManifest;
  remotePrepared?: boolean;
}

export async function lookupClusterNodeUrl(
  source: DataSource | undefined,
  hubId: string,
): Promise<string | undefined> {
  if (!source) return undefined;
  try {
    const row = await source.manager.findOneBy(ClusterNodeEntity, { id: hubId });
    if (!row) return undefined;
    const parsed = JSON.parse(row.value) as { url?: unknown };
    return typeof parsed.url === 'string' && parsed.url ? parsed.url : undefined;
  } catch {
    return undefined;
  }
}

export async function tryDispatchRemotePrepare(params: {
  readonly stateStore?: ClusterStateStore;
  readonly source?: DataSource;
  readonly codec: ClusterSnapshotCodec;
  readonly record: OutgoingTransferRecord;
}): Promise<boolean> {
  if (!params.stateStore) return false;
  const targetHubId = params.record.intent.targetHubId;
  const peer = params.stateStore.getPeerTrustRecord(targetHubId);
  const targetUrl = await lookupClusterNodeUrl(params.source, targetHubId);
  if (!peer || peer.revoked || !targetUrl) return false;

  const credBundle = await params.codec.exportCredentialBundle(
    params.record.manifest.preservePairing,
  );
  const state = params.stateStore.getStateSync();
  const identity = params.stateStore.getIdentitySync(state.hubId);
  const credentialEnvelope = buildTransferCredentialEnvelope({
    identity,
    homeId: params.record.intent.homeId,
    targetHubId,
    targetExchangePublicKey: peer.exchangePublicKey,
    transferId: params.record.intent.transferId,
    epoch: params.record.intent.epoch,
    bundle: credBundle,
  });
  await sendRemoteTransferPrepare({
    identity,
    homeId: params.record.intent.homeId,
    targetHubId,
    targetUrl,
    channelSecret: peer.channelSecret,
    body: {
      transferId: params.record.intent.transferId,
      homeId: params.record.intent.homeId,
      sourceHubId: params.record.intent.sourceHubId,
      targetHubId,
      epoch: params.record.intent.epoch,
      checksum: params.record.intent.checksum,
      manifest: params.record.manifest,
      credentialEnvelope,
      workloads: params.stateStore.listWorkloadsSync(),
    },
  });
  params.record.remotePrepared = true;
  return true;
}

export async function dispatchRemoteTransferCommit(params: {
  readonly stateStore?: ClusterStateStore;
  readonly source?: DataSource;
  readonly codec: ClusterSnapshotCodec;
  readonly record: OutgoingTransferRecord;
}): Promise<void> {
  if (!params.stateStore) return;
  const targetHubId = params.record.intent.targetHubId;
  const peer = params.stateStore.getPeerTrustRecord(targetHubId);
  const targetUrl = await lookupClusterNodeUrl(params.source, targetHubId);
  if (!peer || peer.revoked || !targetUrl) return;

  try {
    if (!params.record.remotePrepared) {
      await tryDispatchRemotePrepare(params);
    }
    const state = params.stateStore.getStateSync();
    await sendRemoteTransferCommit({
      identity: params.stateStore.getIdentitySync(state.hubId),
      homeId: params.record.intent.homeId,
      targetHubId,
      targetUrl,
      channelSecret: peer.channelSecret,
      body: {
        transferId: params.record.intent.transferId,
        homeId: params.record.intent.homeId,
        sourceHubId: params.record.intent.sourceHubId,
        targetHubId,
        epoch: params.record.intent.epoch,
        checksum: params.record.intent.checksum,
      },
    });
  } catch (err: unknown) {
    throw new HttpException(
      {
        error: 'remote_transfer_commit_failed',
        message: err instanceof Error ? err.message : 'remote_transfer_commit_failed',
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export async function dispatchRemoteTransferRollback(params: {
  readonly stateStore?: ClusterStateStore;
  readonly source?: DataSource;
  readonly record: OutgoingTransferRecord;
  readonly reason?: string;
}): Promise<void> {
  if (!params.record.remotePrepared || !params.stateStore) return;
  const peer = params.stateStore.getPeerTrustRecord(params.record.intent.targetHubId);
  const targetUrl = await lookupClusterNodeUrl(params.source, params.record.intent.targetHubId);
  if (!peer || peer.revoked || !targetUrl) return;
  const state = params.stateStore.getStateSync();
  await sendRemoteTransferRollback({
    identity: params.stateStore.getIdentitySync(state.hubId),
    homeId: params.record.intent.homeId,
    targetHubId: params.record.intent.targetHubId,
    targetUrl,
    channelSecret: peer.channelSecret,
    body: {
      transferId: params.record.intent.transferId,
      homeId: params.record.intent.homeId,
      sourceHubId: params.record.intent.sourceHubId,
      reason: params.reason,
    },
  });
}
