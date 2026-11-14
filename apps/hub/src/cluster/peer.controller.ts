/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import type { ClusterWorkloadRow } from '../storage/cluster/entities.js';
import { ClusterLeaseService, type SignedFencingProof } from './coordination/leases.js';
import { detectLocalCapacity } from './coordination/placement.js';
import { ClusterReconciliationService } from './coordination/reconcile.js';
import { ClusterStateStore } from './coordination/state.js';
import type { ClusterSecretEnvelope } from './crypto/envelope.js';
import { HUB_DATA_DIRECTORY } from './crypto/master-key.js';
import { findLocalDigestMediaPath } from './drain/media.js';
import { ClusterPeerGuard, type AuthenticatedPeerRequest } from './peer.guard.js';
import { ClusterSyncService } from './sync/service.js';
import { ClusterTransferManager } from './transfer.js';
import type {
  RemoteTransferCommitPayload,
  RemoteTransferPreparePayload,
  RemoteTransferRollbackPayload,
} from './transfer/remote.js';

interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * Authenticated internal Hub-to-Hub cluster RPC controller.
 * Every endpoint requires mutual Ed25519 + HMAC-SHA256 + anti-replay verification via ClusterPeerGuard.
 */
@Controller('api/cluster/peer')
@UseGuards(ClusterPeerGuard)
export class ClusterPeerController {
  constructor(
    @Inject(ClusterStateStore) private readonly stateStore: ClusterStateStore,
    @Inject(ClusterLeaseService) private readonly leaseService: ClusterLeaseService,
    @Inject(ClusterSyncService) private readonly syncService: ClusterSyncService,
    @Inject(ClusterReconciliationService)
    private readonly reconcileService: ClusterReconciliationService,
    @Optional()
    @Inject(ClusterTransferManager)
    private readonly transferManager?: ClusterTransferManager,
    @Optional() @Inject(HUB_DATA_DIRECTORY) private readonly dataDir?: string,
    @Optional() @Inject(CATALOG_TRANSACTIONS) private readonly transactions?: Transactions,
  ) {}

  @Get('status')
  async getPeerStatus() {
    const state = await this.stateStore.ensureInitialized();
    const identity = this.stateStore.getIdentitySync(state.hubId);
    return {
      snapshot: this.reconcileService.buildLocalClaimSnapshot(),
      capacity: detectLocalCapacity(),
      publicIdentity: identity.publicIdentity(),
    };
  }

  @Post('sync')
  @HttpCode(200)
  async receiveSync(
    @Req() req: AuthenticatedPeerRequest,
    @Body()
    body: {
      readonly envelopes?: readonly ClusterSecretEnvelope[];
      readonly workloads?: readonly ClusterWorkloadRow[];
      readonly acceptEqualRevision?: boolean;
    },
  ) {
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId) {
      throw new ForbiddenException({ error: 'unauthenticated_peer' });
    }
    const envelopes = Array.isArray(body?.envelopes) ? body.envelopes : [];
    const workloads = Array.isArray(body?.workloads) ? body.workloads : undefined;
    return this.syncService.receiveEnvelopes({
      senderHubId,
      envelopes,
      workloads,
      acceptEqualRevision: body?.acceptEqualRevision,
    });
  }

  @Post('request-sync')
  @HttpCode(200)
  async requestSync(
    @Req() req: AuthenticatedPeerRequest,
    @Body() body: { readonly includeHomeKit?: boolean; readonly force?: boolean },
  ) {
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId) {
      throw new ForbiddenException({ error: 'unauthenticated_peer' });
    }
    return this.syncService.buildEnvelopesForPeer({
      recipientHubId: senderHubId,
      includeHomeKit: body?.includeHomeKit ?? true,
      force: body?.force ?? true,
    });
  }

  @Post('workloads/:workloadId/start')
  @HttpCode(200)
  async startWorkload(
    @Req() req: AuthenticatedPeerRequest,
    @Param('workloadId') workloadId: string,
    @Body() body: { readonly generation?: number; readonly epoch?: number },
  ) {
    const state = await this.stateStore.ensureInitialized();
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId || senderHubId !== state.coordinatorId) {
      throw new ForbiddenException({ error: 'coordinator_authority_required' });
    }
    if (state.fenced || state.role === 'fenced') {
      throw new ForbiddenException({ error: 'coordinator_fenced' });
    }
    const existing = this.stateStore.getWorkloadSync(workloadId);
    const generation = Math.max(existing?.generation ?? 0, body?.generation ?? 1);
    const epoch = Math.max(state.coordinatorEpoch, body?.epoch ?? state.coordinatorEpoch);

    const ctrl = this.leaseService.getController(workloadId);
    if (existing) {
      await this.stateStore.saveWorkload({
        ...existing,
        ownerHubId: state.hubId,
        state: 'active',
        generation,
        epoch,
        leaseExpiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      });
    } else if (ctrl) {
      await this.stateStore.saveWorkload({
        workloadId,
        kind: ctrl.kind,
        name: ctrl.name,
        ownerHubId: state.hubId,
        standbyHubIdsJson: JSON.stringify(this.stateStore.listTrustedPeers().map((p) => p.hubId)),
        generation,
        epoch,
        state: 'active',
        leaseExpiresAt: Date.now() + 60_000,
        configRevision: 1,
        credentialRevision: 1,
        cacheRevision: 1,
        requirementsJson: JSON.stringify(ctrl.requirements ?? {}),
        preferredHubId: ctrl.preferredHubId ?? null,
        updatedAt: Date.now(),
      });
    }

    if (ctrl && ctrl.getLocalStatus() !== 'running') {
      await ctrl.startLocal();
    }
    return { started: true, workloadId, ownerHubId: state.hubId, generation, epoch };
  }

  @Post('workloads/:workloadId/stop')
  @HttpCode(200)
  async stopWorkload(
    @Param('workloadId') workloadId: string,
    @Body()
    body: {
      readonly proof?: SignedFencingProof;
      readonly reason?: string;
      readonly newOwnerHubId?: string;
      readonly newGeneration?: number;
      readonly newEpoch?: number;
    },
  ) {
    if (!body?.proof || !this.leaseService.verifySignedFencingProof(body.proof)) {
      throw new ForbiddenException({ error: 'invalid_fencing_proof' });
    }
    if (body.proof.resourceId !== workloadId) {
      throw new ForbiddenException({ error: 'fencing_proof_resource_mismatch' });
    }
    const state = await this.stateStore.ensureInitialized();
    const existing = this.stateStore.getWorkloadSync(workloadId);
    if (body.proof.epoch < state.coordinatorEpoch) {
      throw new ForbiddenException({ error: 'stale_fencing_epoch' });
    }
    if (existing && body.proof.fencedGeneration < existing.generation) {
      throw new ForbiddenException({ error: 'stale_fencing_generation' });
    }
    await this.leaseService.fenceLocalWorkload({
      workloadId,
      reason: body.reason ?? 'peer_handoff_stop',
      newOwnerHubId: body.newOwnerHubId ?? body.proof.newOwnerHubId,
      newGeneration: body.newGeneration ?? body.proof.fencedGeneration + 1,
      newEpoch: body.newEpoch ?? body.proof.epoch,
    });
    return { stopped: true, workloadId };
  }

  @Post('fence-workload')
  @HttpCode(200)
  async fenceWorkload(
    @Body()
    body: {
      readonly workloadId?: string;
      readonly winnerHubId?: string;
      readonly newGeneration?: number;
      readonly newEpoch?: number;
      readonly proof?: SignedFencingProof;
      readonly reason?: string;
    },
  ) {
    if (!body?.workloadId || !body.proof) {
      throw new BadRequestException({ error: 'invalid_fence_payload' });
    }
    if (!this.leaseService.verifySignedFencingProof(body.proof)) {
      throw new ForbiddenException({ error: 'invalid_fencing_proof' });
    }
    if (body.proof.resourceId !== body.workloadId) {
      throw new ForbiddenException({ error: 'fencing_proof_resource_mismatch' });
    }
    const state = await this.stateStore.ensureInitialized();
    const existing = this.stateStore.getWorkloadSync(body.workloadId);
    if (body.proof.epoch < state.coordinatorEpoch) {
      throw new ForbiddenException({ error: 'stale_fencing_epoch' });
    }
    if (existing && body.proof.fencedGeneration < existing.generation) {
      throw new ForbiddenException({ error: 'stale_fencing_generation' });
    }
    await this.leaseService.fenceLocalWorkload({
      workloadId: body.workloadId,
      reason: body.reason ?? 'split_brain_fenced',
      newOwnerHubId: body.winnerHubId ?? body.proof.newOwnerHubId,
      newGeneration: body.newGeneration ?? body.proof.fencedGeneration + 1,
      newEpoch: body.newEpoch ?? body.proof.epoch,
    });
    return { fenced: true, workloadId: body.workloadId };
  }

  @Post('command')
  @HttpCode(200)
  async executeCommand(
    @Body()
    body: {
      readonly workloadId?: string;
      readonly action?: string;
      readonly payload?: Record<string, unknown>;
    },
  ) {
    if (!body?.workloadId || !body.action) {
      throw new BadRequestException({ error: 'invalid_command_payload' });
    }
    if (!this.leaseService.shouldRunLocally(body.workloadId)) {
      const existing = this.stateStore.getWorkloadSync(body.workloadId);
      throw new ConflictException({
        error: 'workload_not_owned_locally',
        ownerHubId: existing?.ownerHubId,
      });
    }
    const ctrl = this.leaseService.getController(body.workloadId);
    if (!ctrl || !ctrl.executeRemote) {
      throw new NotFoundException({ error: 'workload_controller_unavailable' });
    }
    const result = await ctrl.executeRemote(body.action, body.payload);
    return { ok: true, result };
  }

  @Get('media/:digest')
  async downloadVerifiedMedia(
    @Param('digest') digest: string,
    @Query('eventId') queryEventId: string | undefined,
    @Query('variant') queryVariant: string | undefined,
    @Res() res: ExpressLikeResponse,
  ) {
    if (!DIGEST_PATTERN.test(digest)) {
      throw new BadRequestException({ error: 'invalid_media_digest' });
    }
    const normalized = digest.toLowerCase();
    const safeEventId =
      typeof queryEventId === 'string' &&
      /^[a-zA-Z0-9._:-]{1,128}$/.test(queryEventId) &&
      !queryEventId.includes('..') &&
      !queryEventId.startsWith('.')
        ? queryEventId
        : undefined;
    const hintRefs = safeEventId
      ? [
          {
            eventId: safeEventId,
            variant: queryVariant === 'prepared' ? 'prepared' : 'original',
            version: 1,
          },
        ]
      : undefined;
    const candidate = await findLocalDigestMediaPath({
      digest: normalized,
      dataDir: this.dataDir,
      archiveRefs: hintRefs,
      transactions: this.transactions,
    });
    if (!candidate) {
      throw new NotFoundException({ error: 'media_not_found' });
    }
    const info = await stat(candidate);
    if (info.size > 256 * 1024 * 1024) {
      throw new BadRequestException({ error: 'media_blob_too_large' });
    }
    const bytes = await readFile(candidate);
    if (createHash('sha256').update(bytes).digest('hex') !== normalized) {
      throw new NotFoundException({ error: 'media_not_found' });
    }
    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Haus-Media-Sha256', normalized);
    res.send(bytes);
  }

  @Post('decommission')
  @HttpCode(200)
  async decommission(
    @Req() req: AuthenticatedPeerRequest,
    @Body() body: { readonly reason?: string; readonly issuedByHubId?: string },
  ) {
    const state = await this.stateStore.ensureInitialized();
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId || senderHubId !== state.coordinatorId) {
      throw new ForbiddenException({ error: 'coordinator_authority_required' });
    }
    await this.leaseService.stopAllLocalWorkloads(body?.reason ?? 'removed_from_cluster');
    await this.stateStore.clearClusterPeersAndSync({ wipeSecrets: true });
    await this.stateStore.saveState({
      role: 'standalone',
      coordinatorId: state.hubId,
      coordinatorUrl: undefined,
      fenced: false,
      fencedReason: undefined,
    });
    return { decommissioned: true, hubId: state.hubId };
  }

  @Post('transfer/prepare')
  @HttpCode(200)
  async prepareIncomingTransfer(
    @Req() req: AuthenticatedPeerRequest,
    @Body() body: RemoteTransferPreparePayload,
  ) {
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId || !this.transferManager) {
      throw new ForbiddenException({ error: 'transfer_unavailable' });
    }
    return this.transferManager.receiveIncomingPrepare({ senderHubId, payload: body });
  }

  @Post('transfer/commit')
  @HttpCode(200)
  async commitIncomingTransfer(
    @Req() req: AuthenticatedPeerRequest,
    @Body() body: RemoteTransferCommitPayload,
  ) {
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId || !this.transferManager) {
      throw new ForbiddenException({ error: 'transfer_unavailable' });
    }
    return this.transferManager.receiveIncomingCommit({ senderHubId, payload: body });
  }

  @Post('transfer/rollback')
  @HttpCode(200)
  rollbackIncomingTransfer(
    @Req() req: AuthenticatedPeerRequest,
    @Body() body: RemoteTransferRollbackPayload,
  ) {
    const senderHubId = req.clusterPeer?.hubId;
    if (!senderHubId || !this.transferManager) {
      throw new ForbiddenException({ error: 'transfer_unavailable' });
    }
    return this.transferManager.receiveIncomingRollback({ senderHubId, payload: body });
  }
}
