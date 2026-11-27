/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { isPrivateIpv4, type HubIdentityClusterInfo } from '@haus/core/pairing';
import type { HubAuthService } from '../../auth/service.js';
import type { ClusterNodeRecordDto, JoinClusterResponseDto } from '../cluster.dto.js';
import { assertValidClusterRoles } from '../attach.js';
import { sendSignedPeerRequest, validateClusterPeerUrl } from '../crypto/transport.js';
import type { ClusterStateStore } from './state.js';

export interface ClusterMemberSummary {
  readonly id: string;
  readonly name: string;
  readonly url?: string;
  readonly role: 'coordinator' | 'node' | 'fenced' | 'standalone';
  readonly online: boolean;
  readonly enabled: boolean;
  readonly isSelf: boolean;
  readonly isCoordinator: boolean;
}

export interface AuthenticatedClusterSummary {
  readonly homeName: string;
  readonly coordinatorHubId: string;
  readonly coordinatorUrl?: string;
  readonly role: 'coordinator' | 'node' | 'fenced' | 'standalone';
  readonly epoch: number;
  readonly endpoints: readonly {
    readonly hubId: string;
    readonly name: string;
    readonly url: string;
    readonly role: 'coordinator' | 'node';
    readonly online: boolean;
  }[];
}

export interface EnrollHubDto {
  readonly targetUrl: string;
  readonly name?: string;
  readonly roles?: string[];
  readonly pairingCode?: string;
  readonly challengeSessionId?: string;
}

export type EnrollHubResponse =
  | ({ readonly status: 'joined' } & JoinClusterResponseDto)
  | {
      readonly status: 'pairing_code_required';
      readonly challengeSessionId: string;
      readonly targetHubId: string;
      readonly targetName: string;
    };

function isVirtualIface(name: string): boolean {
  return /^(docker|br-|veth|virbr|cni|flannel|cali|tailscale|utun|tun|tap)/i.test(name);
}

/** Resolves a non-loopback private LAN URL for this Hub when `HAUS_HUB_URL` uses loopback. */
export function resolveLocalHubLanUrl(
  configuredUrl?: string,
  targetHintUrl?: string,
): string | undefined {
  let port = Number(process.env.PORT || 8790);
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.port) port = Number(parsed.port);
      if (
        parsed.hostname !== '127.0.0.1' &&
        parsed.hostname !== 'localhost' &&
        parsed.hostname !== '0.0.0.0'
      ) {
        return parsed.origin;
      }
    } catch {
      // Fall through to interface scan.
    }
  }

  let preferredPrefix = '';
  if (targetHintUrl) {
    try {
      const host = new URL(targetHintUrl).hostname;
      if (isPrivateIpv4(host)) {
        preferredPrefix = host.split('.').slice(0, 2).join('.') + '.';
      }
    } catch {
      preferredPrefix = '';
    }
  }

  const candidates: string[] = [];
  const ifaces = networkInterfaces();
  for (const [ifaceName, entries] of Object.entries(ifaces)) {
    if (isVirtualIface(ifaceName)) continue;
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address)) {
        candidates.push(entry.address);
      }
    }
  }
  const chosen =
    (preferredPrefix ? candidates.find((ip) => ip.startsWith(preferredPrefix)) : undefined) ??
    candidates[0];
  return chosen ? `http://${chosen}:${port}` : configuredUrl;
}

export function buildClusterTopologyView(params: {
  readonly stateStore?: ClusterStateStore;
  readonly authService?: HubAuthService;
  readonly nodes: Iterable<ClusterNodeRecordDto>;
  readonly fallbackHubId: string;
  readonly role: 'coordinator' | 'node' | 'fenced' | 'standalone';
  readonly coordinatorId: string;
  readonly epoch: number;
}): {
  readonly selfHubId: string;
  readonly coordinatorUrl?: string;
  readonly publicCluster: HubIdentityClusterInfo;
  readonly homeName: string;
  readonly members: ClusterMemberSummary[];
  readonly authenticated: AuthenticatedClusterSummary;
} {
  const identity = params.authService?.getIdentitySummary?.();
  const state = params.stateStore?.getStateSync();
  const selfHubId = state?.hubId ?? identity?.hubId ?? params.fallbackHubId;
  const selfName = identity?.name ?? 'Haus Hub';
  const selfUrl = resolveLocalHubLanUrl(params.authService?.getHubUrl());
  const peers = Array.from(params.nodes).filter((n) => n.id !== selfHubId);
  const enabledPeers = peers.filter((n) => n.enabled !== false);
  const hubCount = 1 + enabledPeers.length;
  const effectiveRole: HubIdentityClusterInfo['role'] =
    params.role === 'fenced'
      ? 'fenced'
      : hubCount === 1 && params.role === 'coordinator'
        ? 'standalone'
        : params.role === 'node'
          ? 'node'
          : 'coordinator';

  const coordinatorPeer = peers.find((p) => p.id === params.coordinatorId);
  const coordinatorUrl =
    params.coordinatorId === selfHubId ? selfUrl : (coordinatorPeer?.url ?? state?.coordinatorUrl);
  const homeName =
    params.coordinatorId === selfHubId ? selfName : (coordinatorPeer?.name ?? selfName);

  const members: ClusterMemberSummary[] = [
    {
      id: selfHubId,
      name: selfName,
      ...(selfUrl ? { url: selfUrl } : {}),
      role: effectiveRole,
      online: true,
      enabled: true,
      isSelf: true,
      isCoordinator: params.coordinatorId === selfHubId,
    },
    ...peers.map((peer) => ({
      id: peer.id,
      name: peer.name,
      url: peer.url,
      role: (peer.id === params.coordinatorId ? 'coordinator' : 'node') as 'coordinator' | 'node',
      online: peer.online !== false,
      enabled: peer.enabled !== false,
      isSelf: false,
      isCoordinator: peer.id === params.coordinatorId,
    })),
  ];

  const endpoints = members
    .filter((m): m is ClusterMemberSummary & { readonly url: string } =>
      Boolean(m.enabled && m.url),
    )
    .sort((a, b) => Number(b.isCoordinator) - Number(a.isCoordinator))
    .map((m) => ({
      hubId: m.id,
      name: m.name,
      url: m.url,
      role: (m.isCoordinator ? 'coordinator' : 'node') as 'coordinator' | 'node',
      online: m.online,
    }));

  return {
    selfHubId,
    ...(coordinatorUrl ? { coordinatorUrl } : {}),
    homeName,
    publicCluster: {
      role: effectiveRole,
      coordinatorHubId: params.coordinatorId,
      hubCount,
      epoch: params.epoch,
    },
    members,
    authenticated: {
      homeName,
      coordinatorHubId: params.coordinatorId,
      ...(coordinatorUrl ? { coordinatorUrl } : {}),
      role: effectiveRole,
      epoch: params.epoch,
      endpoints,
    },
  };
}

/** Forwards a coordinator-authoritative cluster RPC when invoked on a secondary `node` Hub. */
export async function forwardCoordinatorActionIfSecondary<T>(params: {
  readonly stateStore?: ClusterStateStore;
  readonly nodesMap: ReadonlyMap<string, ClusterNodeRecordDto>;
  readonly action: string;
  readonly payload?: unknown;
}): Promise<{ readonly forwarded: true; readonly result: T } | { readonly forwarded: false }> {
  if (!params.stateStore) return { forwarded: false };
  const state = await params.stateStore.ensureInitialized();
  if (state.role !== 'node' || !state.coordinatorId || state.coordinatorId === state.hubId) {
    return { forwarded: false };
  }
  const peerNode = params.nodesMap.get(state.coordinatorId);
  const targetUrl = peerNode?.url ?? state.coordinatorUrl;
  const trust = params.stateStore.getPeerTrustRecord(state.coordinatorId);
  if (!targetUrl || !trust || trust.revoked) {
    throw new HttpException({ error: 'coordinator_unreachable' }, HttpStatus.BAD_GATEWAY);
  }
  const identity = params.stateStore.getIdentitySync(state.hubId);
  try {
    const response = await sendSignedPeerRequest<{ readonly ok?: boolean; readonly result?: T }>({
      identity,
      homeId: state.homeId,
      targetHubId: state.coordinatorId,
      targetUrl,
      allowHttp: true,
      channelSecret: trust.channelSecret,
      method: 'POST',
      path: '/api/cluster/peer/coordinator-proxy',
      body: { action: params.action, payload: params.payload },
      timeoutMs: 25_000,
    });
    return { forwarded: true, result: response.result as T };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'coordinator_proxy_failed';
    throw new HttpException({ error: msg }, HttpStatus.BAD_GATEWAY);
  }
}

/**
 * Enrolls a standalone or secondary Haus Hub into this Coordinator's Home network over LAN HTTP:
 * 1. Verifies `/api/auth/identity` on `targetUrl`.
 * 2. Authenticates via `/api/auth/challenge` -> `/api/auth/confirm` -> `/api/auth/pair`
 *    (zero-code auto-claim if `firstOnboarding === true`, or returns `pairing_code_required`).
 * 3. Issues a one-time Coordinator `PairingGrant` for `targetHubId` and dispatches `/api/cluster/attach`.
 */
export async function enrollSecondaryHubIntoHome(params: {
  readonly dto: EnrollHubDto;
  readonly stateStore?: ClusterStateStore;
  readonly authService?: HubAuthService;
  readonly nodesMap: ReadonlyMap<string, ClusterNodeRecordDto>;
  readonly fallbackCoordinatorId: string;
}): Promise<EnrollHubResponse> {
  if (!params.dto?.targetUrl || typeof params.dto.targetUrl !== 'string') {
    throw new HttpException({ error: 'invalid_node_url' }, HttpStatus.BAD_REQUEST);
  }
  let targetUrl: string;
  try {
    targetUrl = validateClusterPeerUrl(params.dto.targetUrl, true);
  } catch {
    throw new HttpException({ error: 'invalid_node_address' }, HttpStatus.BAD_REQUEST);
  }

  const roles = params.dto.roles?.length ? params.dto.roles : ['storage', 'stream'];
  assertValidClusterRoles(roles);

  const identity = params.authService?.getIdentitySummary?.();
  const state = await params.stateStore?.ensureInitialized();
  const coordinatorHubId = state?.hubId ?? identity?.hubId ?? params.fallbackCoordinatorId;
  const coordinatorHomeId = state?.homeId ?? identity?.homeId ?? 'home-default';
  const coordinatorName = identity?.name ?? 'Haus Hub';
  const targetIsLoopback = targetUrl.includes('://127.0.0.1') || targetUrl.includes('://localhost');
  const rawConfiguredCoordUrl = state?.coordinatorUrl ?? params.authService?.getHubUrl();
  const coordinatorUrl = targetIsLoopback
    ? rawConfiguredCoordUrl
    : resolveLocalHubLanUrl(rawConfiguredCoordUrl, targetUrl);
  if (!coordinatorUrl || (!targetIsLoopback && coordinatorUrl.includes('://127.0.0.1'))) {
    throw new HttpException({ error: 'coordinator_lan_url_unavailable' }, HttpStatus.CONFLICT);
  }

  // 1. Inspect target Hub identity
  const idRes = await fetch(`${targetUrl}/api/auth/identity`, {
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {
    throw new HttpException({ error: 'target_hub_unreachable' }, HttpStatus.BAD_GATEWAY);
  });
  const idBody = (await idRes.json().catch(() => ({}))) as {
    hub?: {
      hubId?: string;
      homeId?: string;
      name?: string;
      onboarded?: boolean;
      cluster?: { hubCount?: number; role?: string };
    };
  };
  const targetHub = idBody?.hub;
  if (!idRes.ok || !targetHub?.hubId) {
    throw new HttpException({ error: 'not_a_haus_hub' }, HttpStatus.BAD_REQUEST);
  }
  if (targetHub.hubId === coordinatorHubId) {
    throw new HttpException({ error: 'cannot_join_self_hub_id' }, HttpStatus.CONFLICT);
  }
  if (params.nodesMap.has(targetHub.hubId)) {
    throw new HttpException({ error: 'already_clustered' }, HttpStatus.CONFLICT);
  }
  if ((targetHub.cluster?.hubCount ?? 1) > 1 || targetHub.cluster?.role === 'node') {
    throw new HttpException({ error: 'target_hub_already_clustered' }, HttpStatus.CONFLICT);
  }

  // 2. Acquire transient admin session on target Hub
  let sessionId = params.dto.challengeSessionId?.trim() ?? '';
  let challengeCode = params.dto.pairingCode?.replace(/[\s-]+/g, '').toUpperCase() ?? '';

  if (!sessionId) {
    const chRes = await fetch(`${targetUrl}/api/auth/challenge`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8_000),
    });
    const offer = (await chRes.json().catch(() => ({}))) as {
      sessionId?: string;
      challengeCode?: string;
      firstOnboarding?: boolean;
    };
    if (!chRes.ok || !offer.sessionId) {
      throw new HttpException({ error: 'target_challenge_failed' }, HttpStatus.BAD_GATEWAY);
    }
    sessionId = offer.sessionId;
    if (offer.firstOnboarding && typeof offer.challengeCode === 'string' && offer.challengeCode) {
      challengeCode = offer.challengeCode;
    } else if (!challengeCode) {
      return {
        status: 'pairing_code_required',
        challengeSessionId: sessionId,
        targetHubId: targetHub.hubId,
        targetName: targetHub.name ?? 'Haus Hub',
      };
    }
  }

  const confRes = await fetch(`${targetUrl}/api/auth/confirm`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      challengeCode,
      client: {
        clientId: `cluster-enroller:${coordinatorHubId}`,
        clientName: `${coordinatorName} Coordinator`,
        role: 'admin',
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const confBody = (await confRes.json().catch(() => ({}))) as {
    grant?: Record<string, unknown>;
    error?: string;
  };
  if (!confRes.ok || !confBody.grant) {
    throw new HttpException(
      { error: confBody.error ?? 'invalid_pairing_code' },
      HttpStatus.UNAUTHORIZED,
    );
  }

  const pairRes = await fetch(`${targetUrl}/api/auth/pair`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant: confBody.grant }),
    signal: AbortSignal.timeout(8_000),
  });
  const pairBody = (await pairRes.json().catch(() => ({}))) as {
    credentials?: { sessionToken?: string; sessionId?: string };
  };
  const tempToken = pairBody.credentials?.sessionToken;
  if (!pairRes.ok || !tempToken) {
    throw new HttpException({ error: 'target_pair_failed' }, HttpStatus.BAD_GATEWAY);
  }

  try {
    // 3. Mint one-time Coordinator PairingGrant for targetHubId
    if (!params.authService) {
      throw new HttpException(
        { error: 'auth_service_unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const localOffer = params.authService.createChallenge({ ttlMs: 120_000 });
    const joinGrant = params.authService.pairing.confirmClient({
      sessionId: localOffer.sessionId,
      client: {
        clientId: targetHub.hubId,
        clientName: params.dto.name?.trim() || targetHub.name || `Hub ${targetHub.hubId}`,
        role: 'admin',
      },
      challengeCode: localOffer.challengeCode,
      expectedHomeId: coordinatorHomeId,
    });
    const rawCoordToken = `enroll_${localOffer.sessionId}_${localOffer.challengeCode}`;
    const tempCoordSession = params.authService.registerToken(rawCoordToken, {
      clientId: `enroll:${targetHub.hubId}`,
      clientRole: 'admin',
      clientName: 'Cluster Enrollment',
    });

    try {
      const attachRes = await fetch(`${targetUrl}/api/cluster/attach`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({
          coordinatorUrl,
          coordinatorName,
          selfUrl: targetUrl,
          homeId: coordinatorHomeId,
          name: params.dto.name?.trim() || targetHub.name || 'Secondary Hub',
          roles,
          grant: joinGrant,
          coordinatorToken: rawCoordToken,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const attachBody = (await attachRes.json().catch(() => ({}))) as JoinClusterResponseDto & {
        error?: string;
      };
      if (!attachRes.ok) {
        throw new HttpException(
          { error: attachBody?.error ?? 'target_attach_failed' },
          attachRes.status >= 400 && attachRes.status < 500
            ? attachRes.status
            : HttpStatus.BAD_GATEWAY,
        );
      }
      return { ...attachBody, status: 'joined' };
    } finally {
      await params.authService.logout(tempCoordSession.sessionId).catch(() => undefined);
    }
  } finally {
    await fetch(`${targetUrl}/api/auth/logout`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tempToken}`,
      },
      body: JSON.stringify({ sessionId: pairBody.credentials?.sessionId }),
      signal: AbortSignal.timeout(4_000),
    }).catch(() => undefined);
  }
}
