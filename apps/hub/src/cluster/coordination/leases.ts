/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PartitionFencingGuard,
  ScopedLeaseManager,
  type PlacementWorkload,
  type WorkloadKind,
  type WorkloadRequirements,
} from '@haus/core/cluster';
import type { ClusterWorkloadRow } from '../../storage/cluster/entities.js';
import { ClusterCryptoIdentity } from '../crypto/identity.js';
import { sha256Hex } from '../crypto/transport.js';
import { ClusterStateStore } from './state.js';
import {
  DEFAULT_LEASE_TTL_MS,
  decodeClusterWorkloadRow,
  type DecodedClusterWorkload,
  type SignedFencingProof,
  type WorkloadExecutionController,
} from './lease-types.js';
import { reconcileControllersWithLeases, renewAndEnforceLeases } from './maintenance.js';

export type {
  DecodedClusterWorkload,
  SignedFencingProof,
  WorkloadExecutionController,
  WorkloadLeaseState,
} from './lease-types.js';

@Injectable()
export class ClusterLeaseService {
  private readonly logger = new Logger(ClusterLeaseService.name);
  private readonly leaseManager = new ScopedLeaseManager(undefined, DEFAULT_LEASE_TTL_MS);
  private readonly partitionGuard = new PartitionFencingGuard();
  private readonly controllers = new Map<string, WorkloadExecutionController>();
  private hasPeerCheck?: () => boolean;
  private remoteStopHook?: (
    targetHubId: string,
    workloadId: string,
    proof: SignedFencingProof,
  ) => Promise<boolean>;
  private remoteStartHook?: (
    targetHubId: string,
    workloadId: string,
    generation: number,
    epoch: number,
  ) => Promise<boolean>;

  constructor(
    @Optional() @Inject(ClusterStateStore) private readonly stateStore?: ClusterStateStore,
  ) {}

  setClusterTopologyHooks(hooks: {
    readonly hasPeers: () => boolean;
    readonly stopRemoteWorkload?: (
      targetHubId: string,
      workloadId: string,
      proof: SignedFencingProof,
    ) => Promise<boolean>;
    readonly startRemoteWorkload?: (
      targetHubId: string,
      workloadId: string,
      generation: number,
      epoch: number,
    ) => Promise<boolean>;
  }): void {
    this.hasPeerCheck = hooks.hasPeers;
    this.remoteStopHook = hooks.stopRemoteWorkload;
    this.remoteStartHook = hooks.startRemoteWorkload;
  }

  registerWorkloadController(
    workloadId: string,
    controller: WorkloadExecutionController,
  ): () => void {
    this.controllers.set(workloadId, controller);
    return () => {
      if (this.controllers.get(workloadId) === controller) {
        this.controllers.delete(workloadId);
      }
    };
  }

  getController(workloadId: string): WorkloadExecutionController | undefined {
    return this.controllers.get(workloadId);
  }

  listRegisteredWorkloadIds(): string[] {
    return Array.from(this.controllers.keys());
  }

  listPlacementWorkloads(): PlacementWorkload[] {
    const out = new Map<string, PlacementWorkload>();
    for (const row of this.stateStore?.listWorkloadsSync() ?? []) {
      const decoded = this.decodeRow(row);
      out.set(decoded.workloadId, {
        id: decoded.workloadId,
        name: decoded.name,
        kind: decoded.kind,
        requirements: decoded.requirements,
        ...(decoded.preferredHubId ? { userPreferredHubId: decoded.preferredHubId } : {}),
        fallbackHubIds: decoded.standbyHubIds,
      });
    }
    for (const [id, ctrl] of this.controllers) {
      if (!out.has(id)) {
        out.set(id, {
          id,
          name: ctrl.name,
          kind: ctrl.kind,
          requirements: ctrl.requirements ?? {},
          ...(ctrl.preferredHubId ? { userPreferredHubId: ctrl.preferredHubId } : {}),
        });
      }
    }
    return Array.from(out.values());
  }

  /**
   * Strict Single-Active execution gate.
   * Single-Hub homes (0 peers) run all local workloads unless fenced.
   * Multi-Hub clusters permit local execution ONLY when localHubId holds an active, unfenced lease.
   */
  shouldRunLocally(workloadId: string, now = Date.now()): boolean {
    const state = this.stateStore?.getStateSync();
    if (!state) return true;
    if (state.fenced || state.role === 'fenced') return false;

    const existing = this.stateStore?.getWorkloadSync(workloadId);
    const hasPeers = this.hasPeerCheck
      ? this.hasPeerCheck()
      : (this.stateStore?.listTrustedPeers().length ?? 0) > 0;

    if (!hasPeers && (state.role === 'coordinator' || state.role === 'standalone')) {
      return existing ? existing.state !== 'stopped' && existing.state !== 'fenced' : true;
    }

    if (!existing) {
      return state.role === 'coordinator' && !hasPeers;
    }

    if (existing.ownerHubId !== state.hubId) return false;
    if (existing.state !== 'active') return false;
    if (existing.epoch < state.coordinatorEpoch) return false;
    if (existing.leaseExpiresAt > 0 && existing.leaseExpiresAt <= now && hasPeers) {
      // Wait for explicit lease renewal / coordinator confirmation if lease expired in multi-hub mode.
      return false;
    }
    return true;
  }

  async ensureLocalOwnership(params: {
    readonly workloadId: string;
    readonly kind: WorkloadKind;
    readonly name: string;
    readonly requirements?: WorkloadRequirements;
    readonly preferredHubId?: string;
    readonly active?: boolean;
  }): Promise<DecodedClusterWorkload | undefined> {
    if (!this.stateStore) return undefined;
    const state = await this.stateStore.ensureInitialized();
    const existing = this.stateStore.getWorkloadSync(params.workloadId);
    const now = Date.now();
    if (existing) {
      return this.decodeRow(existing);
    }

    const row: ClusterWorkloadRow = {
      workloadId: params.workloadId,
      kind: params.kind,
      name: params.name,
      ownerHubId: state.role === 'node' ? state.coordinatorId : state.hubId,
      standbyHubIdsJson: JSON.stringify(
        state.role === 'node'
          ? [state.hubId]
          : this.stateStore.listTrustedPeers().map((p) => p.hubId),
      ),
      generation: 1,
      epoch: state.coordinatorEpoch,
      state: state.role === 'node' ? 'standby' : (params.active ?? true) ? 'active' : 'stopped',
      leaseExpiresAt: now + DEFAULT_LEASE_TTL_MS,
      configRevision: 1,
      credentialRevision: 1,
      cacheRevision: 1,
      requirementsJson: JSON.stringify(params.requirements ?? {}),
      preferredHubId: params.preferredHubId ?? null,
      updatedAt: now,
    };
    await this.stateStore.saveWorkload(row);
    this.partitionGuard.registerOwnership(row.workloadId, row.ownerHubId, row.generation);
    return this.decodeRow(row);
  }

  async renewLocalLeases(
    now = Date.now(),
    onlinePeerHubIds?: ReadonlySet<string>,
  ): Promise<{ readonly renewedPeerLeases: boolean }> {
    if (!this.stateStore) return { renewedPeerLeases: false };
    return renewAndEnforceLeases({
      stateStore: this.stateStore,
      controllers: this.controllers,
      shouldRunLocally: (id, ts) => this.shouldRunLocally(id, ts),
      stopAllLocalWorkloads: (reason) => this.stopAllLocalWorkloads(reason),
      logger: this.logger,
      now,
      onlinePeerHubIds,
    });
  }

  async reconcileLocalControllers(now = Date.now()): Promise<void> {
    if (!this.stateStore) return;
    await reconcileControllersWithLeases({
      stateStore: this.stateStore,
      controllers: this.controllers,
      shouldRunLocally: (id, ts) => this.shouldRunLocally(id, ts),
      stopAllLocalWorkloads: (reason) => this.stopAllLocalWorkloads(reason),
      logger: this.logger,
      now,
    });
  }

  async stopAllLocalWorkloads(reason: string): Promise<void> {
    for (const [id, ctrl] of this.controllers) {
      if (ctrl.getLocalStatus() === 'running') {
        try {
          await ctrl.stopLocal(reason);
        } catch (err: unknown) {
          this.logger.warn(`Failed stopping local workload ${id}: ${String(err)}`);
        }
      }
    }
  }

  async fenceLocalWorkload(params: {
    readonly workloadId: string;
    readonly reason: string;
    readonly newOwnerHubId?: string;
    readonly newGeneration?: number;
    readonly newEpoch?: number;
  }): Promise<void> {
    const ctrl = this.controllers.get(params.workloadId);
    if (ctrl && ctrl.getLocalStatus() === 'running') {
      await ctrl.stopLocal(params.reason);
    }
    if (!this.stateStore) return;
    const state = await this.stateStore.ensureInitialized();
    const existing = this.stateStore.getWorkloadSync(params.workloadId);
    const generation = Math.max(
      existing?.generation ?? 0,
      params.newGeneration ?? (existing?.generation ?? 0) + 1,
    );
    const epoch = Math.max(existing?.epoch ?? 1, params.newEpoch ?? state.coordinatorEpoch);
    const row: ClusterWorkloadRow = {
      workloadId: params.workloadId,
      kind: existing?.kind ?? ctrl?.kind ?? 'app',
      name: existing?.name ?? ctrl?.name ?? params.workloadId,
      ownerHubId: params.newOwnerHubId ?? existing?.ownerHubId ?? state.coordinatorId,
      standbyHubIdsJson: existing?.standbyHubIdsJson ?? JSON.stringify([state.hubId]),
      generation,
      epoch,
      state: params.newOwnerHubId && params.newOwnerHubId !== state.hubId ? 'standby' : 'fenced',
      leaseExpiresAt: Date.now() + DEFAULT_LEASE_TTL_MS,
      configRevision: existing?.configRevision ?? 1,
      credentialRevision: existing?.credentialRevision ?? 1,
      cacheRevision: existing?.cacheRevision ?? 1,
      requirementsJson: existing?.requirementsJson ?? JSON.stringify(ctrl?.requirements ?? {}),
      preferredHubId: existing?.preferredHubId ?? ctrl?.preferredHubId ?? null,
      updatedAt: Date.now(),
    };
    await this.stateStore.saveWorkload(row);
    this.partitionGuard.registerOwnership(row.workloadId, row.ownerHubId, row.generation);
  }

  createSignedFencingProof(params: {
    readonly resourceId: string;
    readonly priorOwnerHubId: string;
    readonly newOwnerHubId: string;
    readonly fencedGeneration: number;
    readonly epoch: number;
    readonly proofType?: SignedFencingProof['proofType'];
  }): SignedFencingProof {
    if (!this.stateStore) throw Error('cluster_state_unavailable');
    const state = this.stateStore.getStateSync();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    const issuedAt = Date.now();
    const proofType = params.proofType ?? 'signed_revocation';
    const digest = sha256Hex(
      JSON.stringify([
        'haus.fence',
        state.homeId,
        params.resourceId,
        params.priorOwnerHubId,
        params.newOwnerHubId,
        params.fencedGeneration,
        params.epoch,
        proofType,
        identity.hubId,
        issuedAt,
      ]),
    );
    return {
      resourceId: params.resourceId,
      homeId: state.homeId,
      priorOwnerHubId: params.priorOwnerHubId,
      newOwnerHubId: params.newOwnerHubId,
      fencedGeneration: params.fencedGeneration,
      epoch: params.epoch,
      proofType,
      issuedByHubId: identity.hubId,
      issuedAt,
      signature: identity.signPayload(Buffer.from(digest, 'utf8')),
    };
  }

  verifySignedFencingProof(proof: SignedFencingProof): boolean {
    if (!this.stateStore) return false;
    const state = this.stateStore.getStateSync();
    if (proof.homeId !== state.homeId) return false;
    const keyPem =
      proof.issuedByHubId === state.hubId
        ? this.stateStore.getIdentitySync(state.hubId).signingPublicKey
        : this.stateStore.getPeerPublic(proof.issuedByHubId)?.signingPublicKey;
    if (!keyPem) return false;
    const digest = sha256Hex(
      JSON.stringify([
        'haus.fence',
        proof.homeId,
        proof.resourceId,
        proof.priorOwnerHubId,
        proof.newOwnerHubId,
        proof.fencedGeneration,
        proof.epoch,
        proof.proofType,
        proof.issuedByHubId,
        proof.issuedAt,
      ]),
    );
    return ClusterCryptoIdentity.verifySignature(
      keyPem,
      Buffer.from(digest, 'utf8'),
      proof.signature,
    );
  }

  /**
   * Executes atomic Fence-Before-Promote handoff between Hubs so two copies never actively run together.
   */
  async handoffWorkload(params: {
    readonly workloadId: string;
    readonly targetHubId: string;
    readonly allowOfflineForceFence?: boolean;
    readonly beforePromoteSync?: (targetHubId: string) => Promise<void>;
  }): Promise<DecodedClusterWorkload> {
    if (!this.stateStore) throw Error('cluster_state_unavailable');
    const state = await this.stateStore.ensureInitialized();
    const existing = this.stateStore.getWorkloadSync(params.workloadId);
    const ctrl = this.controllers.get(params.workloadId);
    if (!existing && !ctrl) throw Error(`unknown_workload:${params.workloadId}`);

    const previousOwner = existing?.ownerHubId ?? state.hubId;
    const prevGeneration = existing?.generation ?? 1;
    const nextGeneration = prevGeneration + 1;
    const epoch = state.coordinatorEpoch;
    const now = Date.now();

    if (previousOwner === params.targetHubId && existing?.state === 'active') {
      return this.decodeRow(existing);
    }

    // 1. Mark draining first to prevent re-activation on prior owner.
    const drainingRow: ClusterWorkloadRow = {
      workloadId: params.workloadId,
      kind: existing?.kind ?? ctrl?.kind ?? 'app',
      name: existing?.name ?? ctrl?.name ?? params.workloadId,
      ownerHubId: previousOwner,
      standbyHubIdsJson: existing?.standbyHubIdsJson ?? '[]',
      generation: nextGeneration,
      epoch,
      state: 'draining',
      leaseExpiresAt: now + DEFAULT_LEASE_TTL_MS,
      configRevision: existing?.configRevision ?? 1,
      credentialRevision: existing?.credentialRevision ?? 1,
      cacheRevision: existing?.cacheRevision ?? 1,
      requirementsJson: existing?.requirementsJson ?? JSON.stringify(ctrl?.requirements ?? {}),
      preferredHubId: existing?.preferredHubId ?? ctrl?.preferredHubId ?? null,
      updatedAt: now,
    };
    await this.stateStore.saveWorkload(drainingRow);

    const proof = this.createSignedFencingProof({
      resourceId: params.workloadId,
      priorOwnerHubId: previousOwner,
      newOwnerHubId: params.targetHubId,
      fencedGeneration: prevGeneration,
      epoch,
    });

    // 2. Fence / stop previous owner BEFORE activating target!
    if (previousOwner === state.hubId) {
      if (ctrl && ctrl.getLocalStatus() === 'running') {
        await ctrl.stopLocal(`handoff_to_${params.targetHubId}`);
      }
    } else if (this.remoteStopHook) {
      const stopped = await this.remoteStopHook(previousOwner, params.workloadId, proof).catch(
        () => false,
      );
      if (!stopped && !params.allowOfflineForceFence) {
        // Restore prior metadata cleanly without promoting second copy!
        if (existing) await this.stateStore.saveWorkload(existing);
        throw Error('previous_owner_stop_unconfirmed');
      }
    }

    // Register fencing token in core PartitionFencingGuard
    const token = `fence:${params.workloadId}:${prevGeneration}`;
    this.partitionGuard.registerOwnership(params.workloadId, previousOwner, prevGeneration);
    this.partitionGuard.registerValidRevocationToken(token);
    this.partitionGuard.applyVerifiedFencingProof(
      {
        resourceId: params.workloadId,
        priorOwnerHubId: previousOwner,
        fencedGeneration: prevGeneration,
        proofType: 'signed_revocation',
        token,
        issuedAt: new Date(now).toISOString(),
      },
      params.targetHubId,
    );
    this.leaseManager.fenceResource(params.workloadId);
    this.leaseManager.acquireLease(params.workloadId, params.targetHubId, {
      durationMs: DEFAULT_LEASE_TTL_MS,
      currentTime: now,
    });

    // 3. Push encrypted config/credentials to target BEFORE starting target!
    if (params.targetHubId !== state.hubId && params.beforePromoteSync) {
      await params.beforePromoteSync(params.targetHubId);
    }

    // 4. Commit active lease on target
    const peers = this.stateStore.listTrustedPeers().map((p) => p.hubId);
    const allHubIds = Array.from(new Set([state.hubId, ...peers]));
    const standbyHubIds = allHubIds.filter((id) => id !== params.targetHubId);
    const activeRow: ClusterWorkloadRow = {
      ...drainingRow,
      ownerHubId: params.targetHubId,
      standbyHubIdsJson: JSON.stringify(standbyHubIds),
      generation: nextGeneration,
      epoch,
      state: 'active',
      leaseExpiresAt: Date.now() + DEFAULT_LEASE_TTL_MS,
      updatedAt: Date.now(),
    };
    await this.stateStore.saveWorkload(activeRow);

    // 5. Start target execution cleanly
    if (params.targetHubId === state.hubId) {
      if (ctrl && ctrl.getLocalStatus() !== 'running') {
        await ctrl.startLocal();
      }
    } else if (this.remoteStartHook) {
      await this.remoteStartHook(params.targetHubId, params.workloadId, nextGeneration, epoch);
    }

    return this.decodeRow(activeRow);
  }

  async bumpWorkloadRevision(
    workloadId: string,
    field: 'configRevision' | 'credentialRevision' | 'cacheRevision',
  ): Promise<void> {
    if (!this.stateStore) return;
    const row = this.stateStore.getWorkloadSync(workloadId);
    if (!row) return;
    await this.stateStore.saveWorkload({
      ...row,
      [field]: row[field] + 1,
      updatedAt: Date.now(),
    });
  }

  listDecodedWorkloads(): DecodedClusterWorkload[] {
    if (!this.stateStore) return [];
    return this.stateStore.listWorkloadsSync().map((row) => this.decodeRow(row));
  }

  decodeRow(row: ClusterWorkloadRow): DecodedClusterWorkload {
    return decodeClusterWorkloadRow(row);
  }
}
