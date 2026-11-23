/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type BeforeApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
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
  clearPeerSentDigests,
  computeDirtyBundleKinds,
  isShutdownStorageError,
  pushPeerKindWithCoalescing,
  runSerialized,
  shouldSuppressStandbyCachePush,
} from './merge.js';
import {
  applyReceivedPeerEnvelopes,
  EMPTY_SYNC_RESULT,
  type ReceiveEnvelopesInput,
  type ReceiveEnvelopesResult,
} from './receive.js';
import { recordPeerSyncDelivery } from './reconcile-rows.js';
import { ClusterTelemetrySync, pushTelemetryDeltasToPeer } from './telemetry.js';

export type PeerSyncPushResult = ReceiveEnvelopesResult;

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
export class ClusterSyncService implements BeforeApplicationShutdown, OnModuleDestroy {
  private readonly logger = new Logger(ClusterSyncService.name);
  private readonly codec: ClusterSnapshotCodec;
  private readonly telemetrySync: ClusterTelemetrySync;
  private readonly replayGuard = new BoundedReplayGuard();
  private readonly appliedListeners = new Set<SnapshotAppliedListener>();
  private readonly peerNotifyInFlight = new Set<string>();
  private readonly peerNotifyPending = new Set<string>();
  private readonly peerPushLanes = new Map<string, Promise<void>>();
  private readonly inboundReceiveLanes = new Map<string, Promise<void>>();
  private readonly peerBackoff = new Map<string, { until: number; failures: number }>();
  private readonly peerRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly peerLastSentDigest = new Map<string, string>();
  private readonly peerLastSentStatesDigest = new Map<string, string>();
  private readonly peerLastHistorySyncAt = new Map<string, number>();
  private readonly bundleDirtyAt = new Map<CoreSyncBundleKind, number>();
  private readonly peerLastSyncedKindAt = new Map<string, number>();
  private readonly shutdownController = new AbortController();
  private unsubscribeSessionChange?: () => void;
  private peerLookup?: (hubId: string) => PeerEndpointLookup | undefined;
  private listPeerIdsHook?: () => readonly string[];
  private destroyed = false;

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

  beforeApplicationShutdown(): void {
    this.shutdown();
  }

  onModuleDestroy(): void {
    this.shutdown();
  }

  private shutdown(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shutdownController.abort(Error('cluster_sync_shutdown'));
    this.unsubscribeSessionChange?.();
    this.unsubscribeSessionChange = undefined;
    for (const timer of this.peerRetryTimers.values()) clearTimeout(timer);
    this.peerRetryTimers.clear();
  }

  private schedulePeerRetry(peerId: string, delayMs: number): void {
    if (this.destroyed || this.peerRetryTimers.has(peerId)) return;
    const waitMs = Math.max(500, Math.min(SYNC_BACKOFF_MAX_MS, delayMs));
    const timer = setTimeout(() => {
      this.peerRetryTimers.delete(peerId);
      if (this.destroyed) return;
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
    if (this.destroyed) return;
    const peerIds = this.listPeerIdsHook?.() ?? [];
    const now = Date.now();
    await Promise.all(
      peerIds.map((peerId) => {
        const handleErr = (err: unknown) => {
          if (this.destroyed || isShutdownStorageError(err)) return;
          this.logger.warn(`Cluster peer sync failed for ${peerId}: ${String(err)}`);
        };
        if (options?.kinds) return this.syncPeer(peerId, { ...options }).catch(handleErr);
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
        }).catch(handleErr);
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
        if (!this.destroyed && !isShutdownStorageError(err)) {
          this.logger.warn(`Snapshot apply listener error: ${String(err)}`);
        }
      }
    }
  }

  async bumpRevision(
    kind: Extract<ClusterSyncArtifactKind, 'credential' | 'config' | 'cache'>,
    resourceId: string,
    payloadForDigest?: unknown,
  ): Promise<number> {
    const state = await this.stateStore.ensureInitialized();
    if (state.fenced || state.role === 'fenced') throw Error('coordinator_fenced');
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
  receiveEnvelopes(params: ReceiveEnvelopesInput): Promise<PeerSyncPushResult> {
    const telemetryOnly =
      !params.workloads?.length &&
      params.envelopes.length > 0 &&
      params.envelopes.every((env) => env.kind === 'telemetry');
    const laneKey = `${params.senderHubId}:${telemetryOnly ? 'telemetry' : 'core'}`;
    return runSerialized(this.inboundReceiveLanes, laneKey, () =>
      applyReceivedPeerEnvelopes({
        stateStore: this.stateStore,
        leaseService: this.leaseService,
        codec: this.codec,
        telemetrySync: this.telemetrySync,
        replayGuard: this.replayGuard,
        authService: this.authService,
        isDestroyed: () => this.destroyed,
        notifyApplied: (kinds) => this.notifyAppliedListeners(kinds),
        params,
      }),
    );
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
    if (this.destroyed) return EMPTY_SYNC_RESULT;
    const endpoint = this.peerLookup?.(recipientHubId);
    if (!endpoint || !endpoint.enabled) throw Error('peer_unavailable');
    const peer = this.stateStore.getPeerTrustRecord(recipientHubId);
    if (!peer || peer.revoked) throw Error('untrusted_or_revoked_peer');
    const state = this.stateStore.getStateSync();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const wantsTelemetry = Boolean(
      options?.includeTelemetry || options?.force || options?.kinds?.includes('telemetry'),
    );
    const coreKinds = options?.kinds
      ? options.kinds.filter((k): k is CoreSyncBundleKind => k !== 'telemetry')
      : undefined;
    let result: PeerSyncPushResult = EMPTY_SYNC_RESULT;

    if (!coreKinds || coreKinds.length > 0 || options?.sendWorkloadsOnlyIfEmpty) {
      result = await runSerialized(this.peerPushLanes, `${recipientHubId}:core`, async () => {
        if (this.destroyed) return EMPTY_SYNC_RESULT;
        const syncStartedAt = Date.now();
        const requestedKinds = coreKinds ?? ALL_CORE_SYNC_KINDS;
        const includeHistory =
          Boolean(options?.force) ||
          syncStartedAt - (this.peerLastHistorySyncAt.get(recipientHubId) ?? 0) >=
            HISTORY_SYNC_INTERVAL_MS;
        const { envelopes, workloads, digests, cacheStatesDigest } = await buildSealedPeerEnvelopes(
          {
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
          },
        );
        if (this.destroyed) return EMPTY_SYNC_RESULT;
        if (envelopes.length === 0 && !options?.sendWorkloadsOnlyIfEmpty && coreKinds) {
          for (const kind of requestedKinds) {
            this.peerLastSyncedKindAt.set(`${recipientHubId}:${kind}`, syncStartedAt);
          }
          return EMPTY_SYNC_RESULT;
        }
        const pushResult = await sendSignedPeerRequest<PeerSyncPushResult>({
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
          signal: this.shutdownController.signal,
        });
        recordPeerSyncDelivery({
          recipientHubId,
          digests,
          rejected: pushResult.rejected,
          requestedKinds,
          includeHistory,
          cacheStatesDigest,
          syncStartedAt,
          peerLastSentDigest: this.peerLastSentDigest,
          peerLastSentStatesDigest: this.peerLastSentStatesDigest,
          peerLastHistorySyncAt: this.peerLastHistorySyncAt,
          peerLastSyncedKindAt: this.peerLastSyncedKindAt,
        });
        return pushResult;
      });
    }

    if (!this.destroyed && wantsTelemetry && this.telemetrySync.isAvailable()) {
      const tel = await runSerialized(
        this.peerPushLanes,
        `${recipientHubId}:telemetry`,
        async () => {
          if (this.destroyed) return { accepted: 0, appliedItems: 0 };
          return pushTelemetryDeltasToPeer({
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
            signal: this.shutdownController.signal,
          });
        },
      );
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
    if (this.destroyed) return;
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
    if (this.destroyed) return;

    const peerIds = this.listPeerIdsHook?.() ?? [];
    await Promise.all(
      peerIds.map(async (peerId) => {
        if (this.destroyed || peerId === state.hubId || !this.stateStore.getPeerTrustRecord(peerId))
          return;
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
            if (this.destroyed || isShutdownStorageError(err)) return;
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
