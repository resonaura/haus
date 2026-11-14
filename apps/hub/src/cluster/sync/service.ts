/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { HUB_AUTH_SERVICE } from '../../auth/tokens.js';
import { HubAuthService } from '../../auth/service.js';
import { CATALOG_TRANSACTIONS } from '../../storage/storage.module.js';
import type { Transactions } from '../../storage/transactions.js';
import { HUB_DATA_DIRECTORY } from '../crypto/master-key.js';
import {
  BoundedReplayGuard,
  openClusterEnvelope,
  sealClusterEnvelope,
  type ClusterSecretEnvelope,
  type ClusterSyncArtifactKind,
} from '../crypto/envelope.js';
import { sendSignedPeerRequest, sha256Hex } from '../crypto/transport.js';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import { ClusterStateStore } from '../coordination/state.js';
import { ClusterLeaseService } from '../coordination/leases.js';
import {
  ClusterSnapshotCodec,
  type CacheBundlePayload,
  type ConfigBundlePayload,
  type CredentialBundlePayload,
} from './snapshot.js';

export interface PeerSyncPushResult {
  readonly accepted: number;
  readonly rejected: readonly { readonly resourceId: string; readonly reason: string }[];
  readonly appliedItems: number;
}

export interface PeerEndpointLookup {
  readonly url: string;
  readonly allowHttp?: boolean;
  readonly enabled: boolean;
}

@Injectable()
export class ClusterSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(ClusterSyncService.name);
  private readonly codec: ClusterSnapshotCodec;
  private readonly replayGuard = new BoundedReplayGuard();
  private readonly appliedListeners = new Set<() => Promise<void> | void>();
  private readonly unsubscribeSessionChange?: () => void;
  private peerLookup?: (hubId: string) => PeerEndpointLookup | undefined;
  private listPeerIdsHook?: () => readonly string[];

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly leaseService: ClusterLeaseService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(HUB_DATA_DIRECTORY) dataDir?: string,
    @Optional() @Inject(HUB_AUTH_SERVICE) private readonly authService?: HubAuthService,
  ) {
    this.codec = new ClusterSnapshotCodec(transactions, dataDir);
    this.unsubscribeSessionChange = this.authService?.onSessionChange(() => {
      void this.notifyLocalCredentialOrConfigChange('credential', 'client_sessions').catch(
        () => undefined,
      );
    });
  }

  onModuleDestroy(): void {
    this.unsubscribeSessionChange?.();
  }

  getCodec(): ClusterSnapshotCodec {
    return this.codec;
  }

  setPeerDirectory(hooks: {
    readonly lookupPeer: (hubId: string) => PeerEndpointLookup | undefined;
    readonly listPeerIds: () => readonly string[];
  }): void {
    this.peerLookup = hooks.lookupPeer;
    this.listPeerIdsHook = hooks.listPeerIds;
  }

  async syncAllPeers(options?: {
    readonly includeHomeKit?: boolean;
    readonly force?: boolean;
  }): Promise<void> {
    const peerIds = this.listPeerIdsHook?.() ?? [];
    await Promise.all(
      peerIds.map((peerId) =>
        this.syncPeer(peerId, options).catch((err: unknown) => {
          this.logger.warn(`Cluster peer sync failed for ${peerId}: ${String(err)}`);
        }),
      ),
    );
  }

  onSnapshotApplied(listener: () => Promise<void> | void): () => void {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  async notifySnapshotApplied(): Promise<void> {
    await this.notifyAppliedListeners();
  }

  private async notifyAppliedListeners(): Promise<void> {
    for (const listener of this.appliedListeners) {
      try {
        await listener();
      } catch (err: unknown) {
        this.logger.warn(`Snapshot apply listener error: ${String(err)}`);
      }
    }
  }

  async bumpRevision(
    kind: Extract<ClusterSyncArtifactKind, 'credential' | 'config' | 'cache'>,
    resourceId: string,
    payloadForDigest?: unknown,
  ): Promise<number> {
    const state = await this.stateStore.ensureInitialized();
    if (state.fenced || state.role === 'fenced') {
      throw Error('coordinator_fenced');
    }
    const syncKey = `${kind}:${resourceId}`;
    const existing = this.stateStore.getSyncState(syncKey);
    const nextRevision = (existing?.revision ?? 0) + 1;
    const sha256 =
      payloadForDigest !== undefined
        ? sha256Hex(JSON.stringify(payloadForDigest))
        : (existing?.sha256 ?? sha256Hex(`${syncKey}:${nextRevision}`));

    await this.stateStore.saveSyncState({
      syncKey,
      kind,
      resourceId,
      revision: nextRevision,
      generation: (existing?.generation ?? 0) + 1,
      epoch: state.coordinatorEpoch,
      sha256,
      sourceHubId: state.hubId,
      updatedAt: Date.now(),
    });
    return nextRevision;
  }

  async buildEnvelopesForPeer(params: {
    readonly recipientHubId: string;
    readonly includeHomeKit?: boolean;
    readonly force?: boolean;
  }): Promise<{
    readonly envelopes: readonly ClusterSecretEnvelope[];
    readonly workloads: readonly ClusterWorkloadRow[];
  }> {
    const state = await this.stateStore.ensureInitialized();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const peer = this.stateStore.getPeerTrustRecord(params.recipientHubId);
    if (!peer || peer.revoked) {
      throw Error('untrusted_or_revoked_peer');
    }

    const credBundle = await this.codec.exportCredentialBundle(params.includeHomeKit ?? true);
    const configBundle = await this.codec.exportConfigBundle();
    const cacheBundle = await this.codec.exportCacheBundle();

    const candidates: Array<{
      readonly kind: 'credential' | 'config' | 'cache';
      readonly resourceId: string;
      readonly payload: unknown;
    }> = [
      { kind: 'credential', resourceId: 'bundle', payload: credBundle },
      { kind: 'config', resourceId: 'bundle', payload: configBundle },
      { kind: 'cache', resourceId: 'bundle', payload: cacheBundle },
    ];

    const envelopes: ClusterSecretEnvelope[] = [];
    for (const item of candidates) {
      const syncKey = `${item.kind}:${item.resourceId}`;
      const sha256 = this.codec.computePayloadDigest(item.payload);
      const current = this.stateStore.getSyncState(syncKey);
      const changed = !current || current.sha256 !== sha256 || params.force;
      const revision = changed ? (current?.revision ?? 0) + 1 : current.revision;
      const generation = changed ? (current?.generation ?? 0) + 1 : current.generation;

      if (changed) {
        await this.stateStore.saveSyncState({
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
      workloads: this.stateStore.listWorkloadsSync(),
    };
  }

  /** Verifies, decrypts, enforces monotonic watermarks, and re-seals received cluster state. */
  async receiveEnvelopes(params: {
    readonly senderHubId: string;
    readonly envelopes: readonly ClusterSecretEnvelope[];
    readonly workloads?: readonly ClusterWorkloadRow[];
    readonly acceptEqualRevision?: boolean;
  }): Promise<PeerSyncPushResult> {
    const state = await this.stateStore.ensureInitialized();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const peer = this.stateStore.getPeerTrustRecord(params.senderHubId);
    if (!peer || peer.revoked) {
      throw Error('untrusted_or_revoked_peer');
    }
    if (peer.homeId !== state.homeId) {
      throw Error('wrong_home');
    }

    let accepted = 0;
    let appliedItems = 0;
    const rejected: Array<{ readonly resourceId: string; readonly reason: string }> = [];

    // Apply workload lease hints before config bundle so standby Apps stay stopped unless owned here.
    // Non-coordinator peers must never overwrite equal-(epoch, generation) leases during split-brain reconnect.
    if (Array.isArray(params.workloads)) {
      const fromCoordinator =
        state.role !== 'coordinator' && params.senderHubId === state.coordinatorId;
      for (const incoming of params.workloads) {
        const existing = this.stateStore.getWorkloadSync(incoming.workloadId);
        const acceptEqualGeneration =
          fromCoordinator &&
          existing !== undefined &&
          incoming.epoch === existing.epoch &&
          incoming.generation === existing.generation;
        if (
          !existing ||
          incoming.epoch > existing.epoch ||
          (incoming.epoch === existing.epoch && incoming.generation > existing.generation) ||
          acceptEqualGeneration
        ) {
          await this.stateStore.saveWorkload(incoming);
        }
      }
    }

    for (const env of params.envelopes) {
      if (env.senderHubId !== params.senderHubId) {
        rejected.push({ resourceId: env.resourceId, reason: 'sender_mismatch' });
        continue;
      }
      const syncKey = `${env.kind}:${env.resourceId}`;
      const existingSync = this.stateStore.getSyncState(syncKey);
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
          replayGuard: this.replayGuard,
          minExpectedEpoch: state.coordinatorEpoch,
          lastAcceptedWatermark,
        });

        if (opened.meta.kind === 'credential') {
          appliedItems += await this.codec.applyCredentialBundle(
            opened.payload as CredentialBundlePayload,
          );
        } else if (opened.meta.kind === 'config') {
          appliedItems += await this.codec.applyConfigBundle(
            opened.payload as ConfigBundlePayload,
            state.hubId,
          );
        } else if (opened.meta.kind === 'cache') {
          appliedItems += await this.codec.applyCacheBundle(opened.payload as CacheBundlePayload);
        }

        await this.stateStore.saveSyncState({
          syncKey,
          kind: opened.meta.kind,
          resourceId: opened.meta.resourceId,
          revision: opened.meta.revision,
          generation: opened.meta.generation,
          epoch: opened.meta.epoch,
          sha256: this.codec.computePayloadDigest(opened.payload),
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
      await this.authService?.loadPersistedSessions();
      await this.notifyAppliedListeners();
    } else if (Array.isArray(params.workloads) && params.workloads.length > 0) {
      await this.leaseService.reconcileLocalControllers();
    }

    return { accepted, rejected, appliedItems };
  }

  async syncPeer(
    recipientHubId: string,
    options?: { readonly includeHomeKit?: boolean; readonly force?: boolean },
  ): Promise<PeerSyncPushResult> {
    const endpoint = this.peerLookup?.(recipientHubId);
    if (!endpoint || !endpoint.enabled) {
      throw Error('peer_unavailable');
    }
    const peer = this.stateStore.getPeerTrustRecord(recipientHubId);
    if (!peer || peer.revoked) {
      throw Error('untrusted_or_revoked_peer');
    }
    const state = this.stateStore.getStateSync();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const { envelopes, workloads } = await this.buildEnvelopesForPeer({
      recipientHubId,
      includeHomeKit: options?.includeHomeKit ?? true,
      force: options?.force ?? false,
    });

    return sendSignedPeerRequest<PeerSyncPushResult>({
      identity,
      homeId: state.homeId,
      targetHubId: recipientHubId,
      targetUrl: endpoint.url,
      allowHttp: endpoint.allowHttp ?? true,
      channelSecret: peer.channelSecret,
      method: 'POST',
      path: '/api/cluster/peer/sync',
      body: { envelopes, workloads },
    });
  }

  async notifyLocalCredentialOrConfigChange(
    kind: 'credential' | 'config' | 'cache',
    resourceId: string,
  ): Promise<void> {
    const state = this.stateStore.getStateSync();
    if (state.fenced || state.role === 'fenced') return;
    await this.bumpRevision(kind, resourceId).catch(() => undefined);

    const peerIds = this.listPeerIdsHook?.() ?? [];
    for (const peerId of peerIds) {
      if (peerId === state.hubId) continue;
      if (!this.stateStore.getPeerTrustRecord(peerId)) continue;
      await this.syncPeer(peerId).catch((err: unknown) => {
        this.logger.warn(`Deferred E2EE sync push to ${peerId}: ${String(err)}`);
      });
    }
  }
}
