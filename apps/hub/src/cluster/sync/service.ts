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
import { STATS_ENGINE, STATS_STORE } from '../../stats/tokens.js';
import type { StatsEngine } from '../../stats/stats.engine.js';
import type { StatsStore } from '../../stats/stats.store.js';
import { HUB_DATA_DIRECTORY } from '../crypto/master-key.js';
import {
  BoundedReplayGuard,
  openClusterEnvelope,
  type ClusterSecretEnvelope,
  type ClusterSyncArtifactKind,
} from '../crypto/envelope.js';
import { sendSignedPeerRequest, sha256Hex } from '../crypto/transport.js';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import { ClusterStateStore } from '../coordination/state.js';
import { ClusterLeaseService } from '../coordination/leases.js';
import { ClusterSnapshotCodec } from './snapshot.js';
import {
  ALL_CORE_SYNC_KINDS,
  ALL_CORE_SYNC_KINDS_SET,
  buildSealedPeerEnvelopes,
  type BuildPeerEnvelopesParams,
  type CoreSyncBundleKind,
} from './envelopes.js';
import {
  applyIncomingWorkloads,
  applyOpenedSyncBundle,
  clearPeerSentDigests,
  computeDirtyBundleKinds,
  pushPeerKindWithCoalescing,
  shouldSuppressStandbyCachePush,
} from './merge.js';
import { recordPeerSyncDelivery } from './reconcile-rows.js';
import { ClusterTelemetrySync, pushTelemetryDeltasToPeer } from './telemetry.js';

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

export type SyncBundleKind = 'credential' | 'config' | 'cache' | 'telemetry';
export type SnapshotAppliedListener = (
  appliedKinds: ReadonlySet<SyncBundleKind>,
) => Promise<void> | void;

const SYNC_BACKOFF_BASE_MS = 5_000;
const SYNC_BACKOFF_MAX_MS = 60_000;
const HISTORY_SYNC_INTERVAL_MS = 30_000;
const FULL_RECONCILE_INTERVAL_MS = 300_000;

@Injectable()
export class ClusterSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(ClusterSyncService.name);
  private readonly codec: ClusterSnapshotCodec;
  private readonly telemetrySync: ClusterTelemetrySync;
  private readonly replayGuard = new BoundedReplayGuard();
  private readonly appliedListeners = new Set<SnapshotAppliedListener>();
  private readonly peerNotifyInFlight = new Set<string>();
  private readonly peerNotifyPending = new Set<string>();
  private readonly peerBackoff = new Map<string, { until: number; failures: number }>();
  private readonly peerRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly peerLastSentDigest = new Map<string, string>();
  private readonly peerLastSentStatesDigest = new Map<string, string>();
  private readonly peerLastHistorySyncAt = new Map<string, number>();
  private readonly bundleDirtyAt = new Map<CoreSyncBundleKind, number>();
  private readonly peerLastSyncedKindAt = new Map<string, number>();
  private readonly unsubscribeSessionChange?: () => void;
  private peerLookup?: (hubId: string) => PeerEndpointLookup | undefined;
  private listPeerIdsHook?: () => readonly string[];

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly leaseService: ClusterLeaseService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(HUB_DATA_DIRECTORY) dataDir?: string,
    @Optional() @Inject(HUB_AUTH_SERVICE) private readonly authService?: HubAuthService,
    @Optional() @Inject(STATS_STORE) statsStore?: StatsStore,
    @Optional() @Inject(STATS_ENGINE) statsEngine?: StatsEngine,
  ) {
    this.codec = new ClusterSnapshotCodec(transactions, dataDir);
    this.telemetrySync = new ClusterTelemetrySync(transactions, statsStore, statsEngine);
    this.unsubscribeSessionChange = this.authService?.onSessionChange(() => {
      void this.notifyLocalCredentialOrConfigChange('credential', 'client_sessions').catch(
        () => undefined,
      );
    });
  }

  onModuleDestroy(): void {
    this.unsubscribeSessionChange?.();
    for (const timer of this.peerRetryTimers.values()) clearTimeout(timer);
    this.peerRetryTimers.clear();
  }

  private schedulePeerRetry(peerId: string, delayMs: number): void {
    if (this.peerRetryTimers.has(peerId)) return;
    const waitMs = Math.max(500, Math.min(SYNC_BACKOFF_MAX_MS, delayMs));
    const timer = setTimeout(() => {
      this.peerRetryTimers.delete(peerId);
      void this.syncPeer(peerId, { includeTelemetry: true }).catch(() => undefined);
    }, waitMs);
    timer.unref();
    this.peerRetryTimers.set(peerId, timer);
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
    readonly kinds?: readonly SyncBundleKind[];
  }): Promise<void> {
    const peerIds = this.listPeerIdsHook?.() ?? [];
    const now = Date.now();
    await Promise.all(
      peerIds.map((peerId) => {
        if (options?.kinds) {
          return this.syncPeer(peerId, { ...options }).catch((err: unknown) => {
            this.logger.warn(`Cluster peer sync failed for ${peerId}: ${String(err)}`);
          });
        }
        const dirtyKinds = options?.force
          ? undefined
          : computeDirtyBundleKinds({
              peerId,
              allKinds: ALL_CORE_SYNC_KINDS,
              peerLastSyncedKindAt: this.peerLastSyncedKindAt,
              bundleDirtyAt: this.bundleDirtyAt,
              now,
              fullReconcileIntervalMs: FULL_RECONCILE_INTERVAL_MS,
            });
        return this.syncPeer(peerId, {
          ...options,
          includeTelemetry: true,
          ...(dirtyKinds !== undefined
            ? { kinds: dirtyKinds, sendWorkloadsOnlyIfEmpty: true }
            : {}),
        }).catch((err: unknown) => {
          this.logger.warn(`Cluster peer sync failed for ${peerId}: ${String(err)}`);
        });
      }),
    );
  }

  onSnapshotApplied(listener: SnapshotAppliedListener): () => void {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  async notifySnapshotApplied(
    appliedKinds: ReadonlySet<SyncBundleKind> = ALL_CORE_SYNC_KINDS_SET,
  ): Promise<void> {
    await this.notifyAppliedListeners(appliedKinds);
  }

  private async notifyAppliedListeners(appliedKinds: ReadonlySet<SyncBundleKind>): Promise<void> {
    for (const listener of this.appliedListeners) {
      try {
        await listener(appliedKinds);
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
    this.bundleDirtyAt.set(kind, Date.now());
    return nextRevision;
  }

  async buildEnvelopesForPeer(params: BuildPeerEnvelopesParams): Promise<{
    readonly envelopes: readonly ClusterSecretEnvelope[];
    readonly workloads: readonly ClusterWorkloadRow[];
  }> {
    const { envelopes, workloads } = await buildSealedPeerEnvelopes({
      stateStore: this.stateStore,
      codec: this.codec,
      peerLastSentDigest: this.peerLastSentDigest,
      peerLastSentStatesDigest: this.peerLastSentStatesDigest,
      request: params,
    });
    return { envelopes, workloads };
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
    let workloadsUpdated = false;
    const appliedKinds = new Set<SyncBundleKind>();
    const rejected: Array<{ readonly resourceId: string; readonly reason: string }> = [];
    const fromCoordinator =
      state.role !== 'coordinator' && params.senderHubId === state.coordinatorId;

    // Apply workload lease hints before config bundle so standby Apps stay stopped unless owned here.
    if (Array.isArray(params.workloads)) {
      workloadsUpdated = await applyIncomingWorkloads(
        this.stateStore,
        params.workloads,
        fromCoordinator,
      );
    }

    for (const env of params.envelopes) {
      if (env.senderHubId !== params.senderHubId) {
        rejected.push({ resourceId: env.resourceId, reason: 'sender_mismatch' });
        continue;
      }
      const inboundSyncKey = `inbound:${params.senderHubId}:${env.kind}:${env.resourceId}`;
      const existingSync = this.stateStore.getSyncState(inboundSyncKey);
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

        const applied = await applyOpenedSyncBundle({
          kind: opened.meta.kind,
          payload: opened.payload,
          localHubId: state.hubId,
          authoritativePrune: fromCoordinator,
          codec: this.codec,
          applyTelemetryDelta: (delta) => this.telemetrySync.applyDelta(delta),
        });
        appliedItems += applied.appliedItems;
        if (applied.appliedKind) appliedKinds.add(applied.appliedKind);

        await this.stateStore.saveSyncState({
          syncKey: inboundSyncKey,
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
      if (appliedKinds.has('credential')) await this.authService?.loadPersistedSessions();
      await this.notifyAppliedListeners(appliedKinds);
      if (workloadsUpdated && !appliedKinds.has('config') && !appliedKinds.has('credential')) {
        await this.leaseService.reconcileLocalControllers();
      }
    } else if (Array.isArray(params.workloads) && params.workloads.length > 0) {
      await this.leaseService.reconcileLocalControllers();
    }

    return { accepted, rejected, appliedItems };
  }

  async syncPeer(
    recipientHubId: string,
    options?: {
      readonly includeHomeKit?: boolean;
      readonly force?: boolean;
      readonly kinds?: readonly SyncBundleKind[];
      readonly sendWorkloadsOnlyIfEmpty?: boolean;
      readonly includeTelemetry?: boolean;
    },
  ): Promise<PeerSyncPushResult> {
    const endpoint = this.peerLookup?.(recipientHubId);
    if (!endpoint || !endpoint.enabled) throw Error('peer_unavailable');
    const peer = this.stateStore.getPeerTrustRecord(recipientHubId);
    if (!peer || peer.revoked) throw Error('untrusted_or_revoked_peer');
    const state = this.stateStore.getStateSync();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const syncStartedAt = Date.now();
    const wantsTelemetry = Boolean(
      options?.includeTelemetry || options?.force || options?.kinds?.includes('telemetry'),
    );
    const coreKinds = options?.kinds
      ? options.kinds.filter((k): k is CoreSyncBundleKind => k !== 'telemetry')
      : undefined;
    let result: PeerSyncPushResult = { accepted: 0, rejected: [], appliedItems: 0 };

    if (!coreKinds || coreKinds.length > 0 || options?.sendWorkloadsOnlyIfEmpty) {
      const requestedKinds = coreKinds ?? ALL_CORE_SYNC_KINDS;
      const includeHistory =
        Boolean(options?.force) ||
        syncStartedAt - (this.peerLastHistorySyncAt.get(recipientHubId) ?? 0) >=
          HISTORY_SYNC_INTERVAL_MS;
      const { envelopes, workloads, digests, cacheStatesDigest } = await buildSealedPeerEnvelopes({
        stateStore: this.stateStore,
        codec: this.codec,
        peerLastSentDigest: this.peerLastSentDigest,
        peerLastSentStatesDigest: this.peerLastSentStatesDigest,
        request: {
          recipientHubId,
          includeHomeKit: options?.includeHomeKit ?? true,
          includeHistory,
          force: options?.force ?? false,
          kinds: coreKinds,
        },
      });
      if (envelopes.length === 0 && !options?.sendWorkloadsOnlyIfEmpty && coreKinds) {
        for (const kind of requestedKinds) {
          this.peerLastSyncedKindAt.set(`${recipientHubId}:${kind}`, syncStartedAt);
        }
      } else {
        result = await sendSignedPeerRequest<PeerSyncPushResult>({
          identity,
          homeId: state.homeId,
          targetHubId: recipientHubId,
          targetUrl: endpoint.url,
          allowHttp: endpoint.allowHttp ?? true,
          channelSecret: peer.channelSecret,
          method: 'POST',
          path: '/api/cluster/peer/sync',
          body: { envelopes, workloads },
          timeoutMs: 30_000,
        });
        recordPeerSyncDelivery({
          recipientHubId,
          digests,
          rejected: result.rejected,
          requestedKinds,
          includeHistory,
          cacheStatesDigest,
          syncStartedAt,
          peerLastSentDigest: this.peerLastSentDigest,
          peerLastSentStatesDigest: this.peerLastSentStatesDigest,
          peerLastHistorySyncAt: this.peerLastHistorySyncAt,
          peerLastSyncedKindAt: this.peerLastSyncedKindAt,
        });
      }
    }

    if (wantsTelemetry && this.telemetrySync.isAvailable()) {
      const tel = await pushTelemetryDeltasToPeer({
        telemetrySync: this.telemetrySync,
        stateStore: this.stateStore,
        identity,
        homeId: state.homeId,
        epoch: state.coordinatorEpoch,
        recipientHubId,
        recipientExchangePublicKey: peer.exchangePublicKey,
        channelSecret: peer.channelSecret,
        targetUrl: endpoint.url,
        allowHttp: endpoint.allowHttp ?? true,
      });
      result = {
        accepted: result.accepted + tel.accepted,
        rejected: result.rejected,
        appliedItems: result.appliedItems + tel.appliedItems,
      };
    }

    this.peerBackoff.delete(recipientHubId);
    const pendingRetry = this.peerRetryTimers.get(recipientHubId);
    if (pendingRetry) {
      clearTimeout(pendingRetry);
      this.peerRetryTimers.delete(recipientHubId);
    }
    return result;
  }

  async notifyLocalCredentialOrConfigChange(
    kind: CoreSyncBundleKind,
    resourceId: string,
  ): Promise<void> {
    const state = this.stateStore.getStateSync();
    if (state.fenced || state.role === 'fenced') return;
    if (
      shouldSuppressStandbyCachePush(
        kind,
        state.role,
        state.hubId,
        this.stateStore.listWorkloadsSync(),
      )
    ) {
      return;
    }
    await this.bumpRevision(kind, resourceId).catch(() => undefined);

    const peerIds = this.listPeerIdsHook?.() ?? [];
    await Promise.all(
      peerIds.map(async (peerId) => {
        if (peerId === state.hubId || !this.stateStore.getPeerTrustRecord(peerId)) return;
        const backoff = this.peerBackoff.get(peerId);
        if (backoff && backoff.until > Date.now()) {
          this.schedulePeerRetry(peerId, backoff.until - Date.now());
          return;
        }
        await pushPeerKindWithCoalescing({
          key: `${peerId}:${kind}`,
          peerId,
          inFlight: this.peerNotifyInFlight,
          pending: this.peerNotifyPending,
          backoffMap: this.peerBackoff,
          baseBackoffMs: SYNC_BACKOFF_BASE_MS,
          maxBackoffMs: SYNC_BACKOFF_MAX_MS,
          send: () => this.syncPeer(peerId, { kinds: [kind] }),
          onError: (delayMs, err) => {
            clearPeerSentDigests(this.peerLastSentDigest, this.peerLastSentStatesDigest, peerId);
            this.schedulePeerRetry(peerId, delayMs);
            this.logger.warn(
              `Deferred E2EE sync push to ${peerId} (backoff ${Math.round(delayMs / 1000)}s): ${String(err)}`,
            );
          },
        });
      }),
    );
  }
}
