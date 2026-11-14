/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import type {
  BackupRow,
  ClusterLocationRow,
  ClusterMediaRow,
  HomeKitIdentityRow,
  SharedConfigRow,
} from '../../storage/entities/domains.js';
import type {
  ClientSessionRow,
  StandaloneHomeEntryRow,
} from '../../storage/standalone/entities.js';
import {
  openClusterEnvelope,
  sealClusterEnvelope,
  type BoundedReplayGuard,
  type ClusterSecretEnvelope,
} from '../crypto/envelope.js';
import type { ClusterCryptoIdentity } from '../crypto/identity.js';
import { sendSignedPeerRequest } from '../crypto/transport.js';
import type { CredentialBundlePayload } from '../sync/snapshot.js';

export interface HubTransferManifest {
  readonly version: 1;
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly epoch: number;
  readonly timestamp: number;
  readonly preservePairing: boolean;
  readonly preferences: SharedConfigRow[];
  readonly homeEntries: StandaloneHomeEntryRow[];
  readonly homekitIdentities: HomeKitIdentityRow[];
  readonly clusterLocations: ClusterLocationRow[];
  readonly clusterMedia: ClusterMediaRow[];
  readonly backups: BackupRow[];
  readonly sessions: ClientSessionRow[];
}

export interface RemoteTransferPreparePayload {
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly epoch: number;
  readonly checksum: string;
  readonly manifest: HubTransferManifest;
  readonly credentialEnvelope?: ClusterSecretEnvelope;
  readonly workloads?: readonly ClusterWorkloadRow[];
  readonly sourceUrl?: string;
}

export interface RemoteTransferCommitPayload {
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly epoch: number;
  readonly checksum: string;
  readonly sourceUrl?: string;
}

export interface RemoteTransferRollbackPayload {
  readonly transferId: string;
  readonly homeId: string;
  readonly sourceHubId: string;
  readonly reason?: string;
}

export function calculateTransferManifestChecksum(manifest: HubTransferManifest): string {
  const canonical = JSON.stringify({
    version: manifest.version,
    transferId: manifest.transferId,
    homeId: manifest.homeId,
    sourceHubId: manifest.sourceHubId,
    targetHubId: manifest.targetHubId,
    epoch: manifest.epoch,
    preservePairing: manifest.preservePairing,
    preferences: manifest.preferences,
    homeEntries: manifest.homeEntries,
    homekitIdentities: manifest.homekitIdentities,
    clusterLocations: manifest.clusterLocations,
    clusterMedia: manifest.clusterMedia,
    backups: manifest.backups,
    sessions: manifest.sessions,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildTransferCredentialEnvelope(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly targetExchangePublicKey: string;
  readonly transferId: string;
  readonly epoch: number;
  readonly bundle: CredentialBundlePayload;
}): ClusterSecretEnvelope {
  return sealClusterEnvelope({
    identity: params.identity,
    homeId: params.homeId,
    recipientHubId: params.targetHubId,
    recipientExchangePublicKey: params.targetExchangePublicKey,
    kind: 'transfer_bundle',
    resourceId: params.transferId,
    revision: 1,
    generation: params.epoch,
    epoch: params.epoch,
    payload: params.bundle,
  });
}

export function openTransferCredentialEnvelope(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly expectedHomeId: string;
  readonly senderSigningPublicKey: string;
  readonly envelope: ClusterSecretEnvelope;
  readonly replayGuard: BoundedReplayGuard;
  readonly minExpectedEpoch: number;
}): CredentialBundlePayload {
  const opened = openClusterEnvelope({
    identity: params.identity,
    expectedHomeId: params.expectedHomeId,
    senderSigningPublicKey: params.senderSigningPublicKey,
    envelope: params.envelope,
    replayGuard: params.replayGuard,
    minExpectedEpoch: params.minExpectedEpoch,
  });
  return opened.payload as CredentialBundlePayload;
}

export async function sendRemoteTransferPrepare(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly targetUrl: string;
  readonly channelSecret?: string;
  readonly body: RemoteTransferPreparePayload;
}): Promise<{ readonly prepared: boolean; readonly transferId: string }> {
  return sendSignedPeerRequest({
    identity: params.identity,
    homeId: params.homeId,
    targetHubId: params.targetHubId,
    targetUrl: params.targetUrl,
    channelSecret: params.channelSecret,
    method: 'POST',
    path: '/api/cluster/peer/transfer/prepare',
    body: params.body,
    timeoutMs: 12_000,
  });
}

export async function sendRemoteTransferCommit(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly targetUrl: string;
  readonly channelSecret?: string;
  readonly body: RemoteTransferCommitPayload;
}): Promise<{ readonly committed: boolean; readonly transferId: string; readonly epoch: number }> {
  return sendSignedPeerRequest({
    identity: params.identity,
    homeId: params.homeId,
    targetHubId: params.targetHubId,
    targetUrl: params.targetUrl,
    channelSecret: params.channelSecret,
    method: 'POST',
    path: '/api/cluster/peer/transfer/commit',
    body: params.body,
    timeoutMs: 12_000,
  });
}

export async function sendRemoteTransferRollback(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly targetUrl: string;
  readonly channelSecret?: string;
  readonly body: RemoteTransferRollbackPayload;
}): Promise<{ readonly rolledBack: boolean; readonly transferId: string }> {
  return sendSignedPeerRequest({
    identity: params.identity,
    homeId: params.homeId,
    targetHubId: params.targetHubId,
    targetUrl: params.targetUrl,
    channelSecret: params.channelSecret,
    method: 'POST',
    path: '/api/cluster/peer/transfer/rollback',
    body: params.body,
    timeoutMs: 8_000,
  });
}
