/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ClusterPeerVerifier, sha256Hex, type PeerTrustRecord } from './crypto/transport.js';
import { ClusterStateStore } from './coordination/state.js';

export interface AuthenticatedPeerRequest {
  readonly method: string;
  readonly url?: string;
  readonly originalUrl?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody?: Buffer;
  readonly body?: unknown;
  clusterPeer?: PeerTrustRecord;
}

function extractRawBodyBytes(req: AuthenticatedPeerRequest): Uint8Array {
  if (req.rawBody && req.rawBody.length > 0) {
    return req.rawBody;
  }
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || !req.headers['content-type']) {
    return Buffer.alloc(0);
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8');
  }
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return Buffer.alloc(0);
}

/**
 * Authenticates mutually-signed Hub-to-Hub RPC traffic using Ed25519 + HMAC-SHA256 + anti-replay nonces.
 */
@Injectable()
export class ClusterPeerGuard implements CanActivate {
  private readonly verifier = new ClusterPeerVerifier();

  constructor(@Inject(ClusterStateStore) private readonly stateStore: ClusterStateStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedPeerRequest>();
    const state = await this.stateStore.ensureInitialized();
    const rawUrl = req.originalUrl ?? req.url ?? '/';
    const path = rawUrl.split('?')[0] || '/';
    const bodyDigestHex = sha256Hex(extractRawBodyBytes(req));

    const verified = this.verifier.verify({
      localHubId: state.hubId,
      localHomeId: state.homeId,
      method: req.method,
      path,
      headers: req.headers,
      bodyDigestHex,
      lookupPeer: (hubId) => this.stateStore.getPeerTrustRecord(hubId),
    });

    if (!verified.ok) {
      throw new ForbiddenException({
        error: verified.reason,
        message: `Peer request rejected: ${verified.reason}`,
      });
    }

    req.clusterPeer = verified.peer;
    return true;
  }
}
