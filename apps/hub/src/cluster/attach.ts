/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { HttpException, HttpStatus } from '@nestjs/common';
import type { HubAuthService } from '../auth/service.js';
import { ClusterNodeEntity } from '../storage/entities/domains.js';
import { StandaloneHomeEntryEntity } from '../storage/standalone/entities.js';
import type { Transactions } from '../storage/transactions.js';
import type {
  AttachClusterDto,
  ClusterNodeRecordDto,
  JoinClusterDto,
  JoinClusterResponseDto,
} from './cluster.dto.js';
import type { ClusterOrchestrator } from './coordination/orchestrator.js';
import type { ClusterStateStore } from './coordination/state.js';
import { ClusterCryptoIdentity } from './crypto/identity.js';
import { validateClusterPeerUrl } from './crypto/transport.js';
import type { ClusterTransferManager } from './transfer.js';

export const VALID_CLUSTER_ROLES = new Set(['storage', 'stream', 'radio', 'bridge']);

/** Validates requested cluster roles against the allowed Hub role vocabulary. */
export function assertValidClusterRoles(roles: unknown): asserts roles is string[] {
  if (
    !Array.isArray(roles) ||
    roles.length === 0 ||
    roles.some((role) => typeof role !== 'string' || !VALID_CLUSTER_ROLES.has(role))
  ) {
    throw new HttpException({ error: 'invalid_node_roles' }, HttpStatus.BAD_REQUEST);
  }
}

/** Accepts an authenticated peer join request on the Coordinator Hub. */
export async function acceptCoordinatorJoinRequest(params: {
  readonly joinRequest: JoinClusterDto;
  readonly coordinatorFallbackId: string;
  readonly consumedGrantIds: Set<string>;
  readonly nodesMap: Map<string, ClusterNodeRecordDto>;
  readonly initialize: () => Promise<void>;
  readonly stateStore?: ClusterStateStore;
  readonly transferManager?: ClusterTransferManager;
  readonly orchestrator?: ClusterOrchestrator;
  readonly authService?: HubAuthService;
  readonly transactions?: Transactions;
}): Promise<JoinClusterResponseDto> {
  params.transferManager?.assertNotFenced();
  const { joinRequest } = params;
  if (!joinRequest?.url || typeof joinRequest.url !== 'string' || !joinRequest?.hubId) {
    throw new HttpException({ error: 'invalid_join_request' }, HttpStatus.BAD_REQUEST);
  }

  const coordinatorHomeId = params.authService?.getIdentity().homeId ?? 'home-default';
  const coordinatorHubId = params.authService?.getIdentity().hubId ?? params.coordinatorFallbackId;
  if (joinRequest.homeId !== coordinatorHomeId) {
    throw new HttpException({ error: 'wrong_home' }, HttpStatus.FORBIDDEN);
  }

  assertValidClusterRoles(joinRequest.roles);

  let validatedUrl: string;
  try {
    validatedUrl = validateClusterPeerUrl(joinRequest.url, true);
  } catch {
    throw new HttpException({ error: 'invalid_node_address' }, HttpStatus.BAD_REQUEST);
  }

  await params.initialize();
  const id = joinRequest.hubId.trim();
  if (id === coordinatorHubId) {
    throw new HttpException({ error: 'cannot_join_self_hub_id' }, HttpStatus.CONFLICT);
  }

  if (params.authService) {
    if (!joinRequest.grant || typeof joinRequest.grant !== 'object') {
      throw new HttpException({ error: 'invalid_pairing_grant' }, HttpStatus.UNAUTHORIZED);
    }
    const grantId = typeof joinRequest.grant.grantId === 'string' ? joinRequest.grant.grantId : '';
    if (!grantId) {
      throw new HttpException({ error: 'invalid_pairing_grant' }, HttpStatus.UNAUTHORIZED);
    }
    if (params.consumedGrantIds.has(grantId)) {
      throw new HttpException({ error: 'grant_revoked' }, HttpStatus.UNAUTHORIZED);
    }
    if (
      typeof joinRequest.grant.clientId === 'string' &&
      joinRequest.grant.clientId &&
      joinRequest.grant.clientId !== id
    ) {
      throw new HttpException({ error: 'grant_hub_mismatch' }, HttpStatus.FORBIDDEN);
    }
    try {
      params.authService.pairing.assertGrant(grantId, {
        expectedHubId: coordinatorHubId,
        expectedHomeId: coordinatorHomeId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid_pairing_grant';
      throw new HttpException({ error: msg }, HttpStatus.UNAUTHORIZED);
    }
    params.consumedGrantIds.add(grantId);
    if (params.transactions) {
      await params.transactions.run((manager) =>
        manager.upsert(
          StandaloneHomeEntryEntity,
          {
            kind: 'consumed_grant',
            entryId: grantId,
            value: JSON.stringify({ hubId: id, consumedAt: Date.now() }),
            updatedAt: Date.now(),
          },
          ['kind', 'entryId'],
        ),
      );
    }
  }

  const trustResult =
    joinRequest.publicIdentity && params.orchestrator
      ? await params.orchestrator.establishJoinedPeerTrust({
          hubId: id,
          homeId: coordinatorHomeId,
          coordinatorHubId,
          publicIdentity: joinRequest.publicIdentity,
        })
      : undefined;

  const record: ClusterNodeRecordDto = {
    id,
    name: joinRequest.name ?? `Secondary Hub ${id.slice(0, 6)}`,
    url: validatedUrl,
    enabled: true,
    roles: joinRequest.roles,
    online: true,
    homeId: coordinatorHomeId,
  };
  if (params.transactions) {
    await params.transactions.run((manager) =>
      manager.upsert(ClusterNodeEntity, { id, value: JSON.stringify(record) }, ['id']),
    );
  }
  params.nodesMap.set(id, record);

  if (trustResult && params.orchestrator) {
    params.orchestrator.triggerInitialPeerSync(id);
  }

  return {
    status: 'joined',
    homeId: coordinatorHomeId,
    coordinatorHubId,
    coordinatorEpoch: params.stateStore?.getStateSync().coordinatorEpoch ?? 1,
    node: record,
    ...trustResult,
  };
}

/**
 * Performs secondary Hub enrollment against a Coordinator Hub purely over HTTP,
 * establishing mutual Ed25519/X25519/HMAC trust and pulling initial E2EE state.
 */
export async function attachSecondaryHubToCoordinator(params: {
  readonly dto: AttachClusterDto;
  readonly nodesMap: Map<string, ClusterNodeRecordDto>;
  readonly initialize: () => Promise<void>;
  readonly stateStore?: ClusterStateStore;
  readonly transferManager?: ClusterTransferManager;
  readonly orchestrator?: ClusterOrchestrator;
  readonly authService?: HubAuthService;
  readonly transactions?: Transactions;
}): Promise<JoinClusterResponseDto> {
  params.transferManager?.assertNotFenced();
  await params.initialize();

  if (!params.stateStore) {
    throw new HttpException({ error: 'cluster_state_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (!params.dto?.coordinatorUrl || typeof params.dto.coordinatorUrl !== 'string') {
    throw new HttpException({ error: 'invalid_coordinator_url' }, HttpStatus.BAD_REQUEST);
  }
  const grant = params.dto.grant;
  if (!grant || typeof grant !== 'object' || typeof grant.grantId !== 'string' || !grant.grantId) {
    throw new HttpException({ error: 'invalid_pairing_grant' }, HttpStatus.BAD_REQUEST);
  }

  const roles = params.dto.roles ?? ['storage', 'stream'];
  assertValidClusterRoles(roles);

  let coordinatorUrl: string;
  let selfUrl: string;
  try {
    coordinatorUrl = validateClusterPeerUrl(params.dto.coordinatorUrl, true);
    const rawSelfUrl = params.dto.selfUrl ?? params.authService?.getHubUrl() ?? '';
    selfUrl = validateClusterPeerUrl(rawSelfUrl, true);
  } catch {
    throw new HttpException({ error: 'invalid_node_address' }, HttpStatus.BAD_REQUEST);
  }

  const state = await params.stateStore.ensureInitialized();
  const existingOtherNodes = Array.from(params.nodesMap.values()).filter(
    (n) => n.id !== state.hubId,
  );
  if (existingOtherNodes.length > 0 || state.role === 'node') {
    throw new HttpException({ error: 'already_clustered' }, HttpStatus.CONFLICT);
  }

  const localIdentity = params.stateStore.getIdentitySync(state.hubId);
  const authIdentity = params.authService?.getIdentity();
  const targetHomeId =
    params.dto.homeId?.trim() ||
    (typeof grant.homeId === 'string' && grant.homeId.trim() ? grant.homeId.trim() : '') ||
    state.homeId;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const coordinatorToken = params.dto.coordinatorToken?.trim();
  if (coordinatorToken) {
    headers.authorization = `Bearer ${coordinatorToken}`;
  }

  const response = await fetch(`${coordinatorUrl}/api/cluster/join`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      hubId: state.hubId,
      url: selfUrl,
      homeId: targetHomeId,
      name: params.dto.name?.trim() || authIdentity?.name || `Secondary Hub ${state.hubId}`,
      roles,
      grant,
      publicIdentity: localIdentity.publicIdentity(),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    let errorCode = 'coordinator_join_failed';
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === 'string') errorCode = payload.error;
    } catch {
      // Keep generic code for non-JSON error payloads.
    }
    const status =
      response.status >= 400 && response.status < 500 ? response.status : HttpStatus.BAD_GATEWAY;
    throw new HttpException({ error: errorCode }, status);
  }

  const joined = (await response.json()) as JoinClusterResponseDto;
  if (
    !joined?.coordinatorHubId ||
    !joined.coordinatorPublicIdentity ||
    !ClusterCryptoIdentity.validatePeerPublicIdentity(joined.coordinatorPublicIdentity) ||
    joined.coordinatorPublicIdentity.hubId !== joined.coordinatorHubId ||
    typeof joined.channelSecret !== 'string' ||
    joined.channelSecret.length < 32
  ) {
    throw new HttpException(
      { error: 'invalid_coordinator_trust_response' },
      HttpStatus.BAD_GATEWAY,
    );
  }

  const epoch =
    typeof joined.coordinatorEpoch === 'number' && joined.coordinatorEpoch >= 1
      ? joined.coordinatorEpoch
      : state.coordinatorEpoch;

  await params.stateStore.saveState({
    role: 'node',
    homeId: joined.homeId,
    coordinatorId: joined.coordinatorHubId,
    coordinatorUrl,
    coordinatorEpoch: epoch,
    fenced: false,
    fencedReason: undefined,
  });
  params.transferManager?.setRoleOverride('node');
  params.transferManager?.setCoordinatorIdOverride(joined.coordinatorHubId);
  params.transferManager?.setCoordinatorEpoch(epoch);
  params.authService?.setHomeId(joined.homeId);

  await params.stateStore.upsertPeerTrust({
    hubId: joined.coordinatorHubId,
    homeId: joined.homeId,
    publicIdentity: joined.coordinatorPublicIdentity,
    channelSecret: joined.channelSecret,
  });

  const coordinatorRecord: ClusterNodeRecordDto = {
    id: joined.coordinatorHubId,
    name: params.dto.coordinatorName?.trim() || 'Primary Coordinator',
    url: coordinatorUrl,
    enabled: true,
    roles: ['storage', 'stream'],
    online: true,
    homeId: joined.homeId,
  };
  if (params.transactions) {
    await params.transactions.run((manager) =>
      manager.upsert(
        ClusterNodeEntity,
        { id: coordinatorRecord.id, value: JSON.stringify(coordinatorRecord) },
        ['id'],
      ),
    );
  }
  params.nodesMap.set(coordinatorRecord.id, coordinatorRecord);

  if (params.orchestrator) {
    await params.orchestrator.pullPeerSync(joined.coordinatorHubId).catch(() => undefined);
    await params.orchestrator.pollPeerStatuses().catch(() => undefined);
  }

  return joined;
}
