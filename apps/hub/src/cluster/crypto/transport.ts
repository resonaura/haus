/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { ClusterCryptoIdentity } from './identity.js';
import { BoundedReplayGuard } from './envelope.js';

const MAX_SKEW_MS = 60_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_TRANSFER_BYTES = 256 * 1024 * 1024;

function isForbiddenLinkLocalOrUnspecified(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === '0.0.0.0' || bare === '::') return true;
  if (
    bare === '169.254.169.254' ||
    bare.startsWith('::ffff:169.254.') ||
    bare === '::ffff:0.0.0.0'
  ) {
    return true;
  }
  if (isIP(bare) === 4 && bare.startsWith('169.254.')) return true;
  if (
    isIP(bare) === 6 &&
    (bare.startsWith('fe80:') || bare.startsWith('ff') || bare.startsWith('fd00:ec2:'))
  ) {
    return true;
  }
  return false;
}

/** Validates peer Hub URLs against SSRF / open-redirect / credential injection primitives. */
export function validateClusterPeerUrl(rawUrl: string, allowHttp = true): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw Error('invalid_node_address');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    !url.hostname ||
    isForbiddenLinkLocalOrUnspecified(url.hostname) ||
    (url.protocol === 'http:' && !allowHttp)
  ) {
    throw Error('invalid_node_address');
  }
  return url.origin;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalPeerRequestString(params: {
  readonly method: string;
  readonly path: string;
  readonly homeId: string;
  readonly senderHubId: string;
  readonly recipientHubId: string;
  readonly time: string;
  readonly nonce: string;
  readonly digest: string;
}): string {
  return [
    params.method.toUpperCase(),
    params.path,
    params.homeId,
    params.senderHubId,
    params.recipientHubId,
    params.time,
    params.nonce,
    params.digest,
  ].join('\n');
}

export function buildSignedPeerHeaders(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly recipientHubId: string;
  readonly homeId: string;
  readonly channelSecret?: string;
  readonly method: string;
  readonly path: string;
  readonly bodyBytes?: Uint8Array;
  readonly now?: number;
  readonly nonce?: string;
}): Record<string, string> {
  const time = String(params.now ?? Date.now());
  const nonce = params.nonce ?? randomBytes(16).toString('hex');
  const digest = sha256Hex(params.bodyBytes ?? '');
  const canonical = canonicalPeerRequestString({
    method: params.method,
    path: params.path,
    homeId: params.homeId,
    senderHubId: params.identity.hubId,
    recipientHubId: params.recipientHubId,
    time,
    nonce,
    digest,
  });
  const edSig = params.identity.signPayload(Buffer.from(canonical, 'utf8'));
  const hmacSig = params.channelSecret
    ? createHmac('sha256', params.channelSecret).update(canonical).digest('hex')
    : '';
  return {
    'x-haus-hub-id': params.identity.hubId,
    'x-haus-recipient-id': params.recipientHubId,
    'x-haus-home-id': params.homeId,
    'x-haus-time': time,
    'x-haus-nonce': nonce,
    'x-haus-digest': digest,
    'x-haus-ed25519': edSig,
    ...(hmacSig ? { 'x-haus-signature': hmacSig } : {}),
  };
}

export interface PeerTrustRecord {
  readonly hubId: string;
  readonly homeId: string;
  readonly signingPublicKey: string;
  readonly channelSecret?: string;
  readonly revoked: boolean;
}

/** Verifies inbound mutual Hub-to-Hub requests with Ed25519 + optional HMAC + anti-replay nonces. */
export class ClusterPeerVerifier {
  private readonly replayGuard = new BoundedReplayGuard();

  verify(params: {
    readonly localHubId: string;
    readonly localHomeId: string;
    readonly method: string;
    readonly path: string;
    readonly headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
    readonly bodyDigestHex: string;
    readonly lookupPeer: (hubId: string) => PeerTrustRecord | undefined;
    readonly now?: number;
  }):
    | { readonly ok: true; readonly peer: PeerTrustRecord }
    | { readonly ok: false; readonly reason: string } {
    const readHeader = (name: string): string | undefined => {
      const value = params.headers[name];
      return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
    };

    const senderHubId = readHeader('x-haus-hub-id');
    const recipientHubId = readHeader('x-haus-recipient-id');
    const homeId = readHeader('x-haus-home-id');
    const time = readHeader('x-haus-time');
    const nonce = readHeader('x-haus-nonce');
    const digest = readHeader('x-haus-digest');
    const edSig = readHeader('x-haus-ed25519');
    const hmacSig = readHeader('x-haus-signature');

    if (!senderHubId || !recipientHubId || !homeId || !time || !nonce || !digest || !edSig) {
      return { ok: false, reason: 'missing_peer_auth_headers' };
    }
    if (recipientHubId !== params.localHubId) {
      return { ok: false, reason: 'wrong_peer_recipient' };
    }
    if (homeId !== params.localHomeId) {
      return { ok: false, reason: 'wrong_home' };
    }
    if (!/^\d{13}$/.test(time) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(digest)) {
      return { ok: false, reason: 'malformed_peer_auth_headers' };
    }
    const now = params.now ?? Date.now();
    const sentAt = Number(time);
    if (Math.abs(now - sentAt) > MAX_SKEW_MS) {
      return { ok: false, reason: 'peer_clock_skew' };
    }

    try {
      if (!timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(params.bodyDigestHex, 'hex'))) {
        return { ok: false, reason: 'peer_body_digest_mismatch' };
      }
    } catch {
      return { ok: false, reason: 'peer_body_digest_mismatch' };
    }

    const peer = params.lookupPeer(senderHubId);
    if (!peer || peer.revoked) {
      return { ok: false, reason: 'untrusted_or_revoked_peer' };
    }
    if (peer.homeId !== params.localHomeId) {
      return { ok: false, reason: 'wrong_home' };
    }

    const canonical = canonicalPeerRequestString({
      method: params.method,
      path: params.path,
      homeId,
      senderHubId,
      recipientHubId,
      time,
      nonce,
      digest,
    });
    if (
      !ClusterCryptoIdentity.verifySignature(
        peer.signingPublicKey,
        Buffer.from(canonical, 'utf8'),
        edSig,
      )
    ) {
      return { ok: false, reason: 'invalid_peer_ed25519_signature' };
    }

    if (peer.channelSecret && peer.channelSecret.length >= 32) {
      if (!hmacSig || !/^[a-f0-9]{64}$/.test(hmacSig)) {
        return { ok: false, reason: 'missing_peer_hmac_signature' };
      }
      const expectedHmac = createHmac('sha256', peer.channelSecret).update(canonical).digest('hex');
      if (!timingSafeEqual(Buffer.from(expectedHmac, 'utf8'), Buffer.from(hmacSig, 'utf8'))) {
        return { ok: false, reason: 'invalid_peer_hmac_signature' };
      }
    }

    if (!this.replayGuard.consume(senderHubId, nonce, sentAt + MAX_SKEW_MS, now)) {
      return { ok: false, reason: 'peer_replay_detected' };
    }

    return { ok: true, peer };
  }
}

/** Sends authenticated JSON or binary requests to a validated peer Hub URL with redirect-blocking SSRF defense. */
export async function sendSignedPeerRequest<T = unknown>(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly targetUrl: string;
  readonly allowHttp?: boolean;
  readonly channelSecret?: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}): Promise<T> {
  const origin = validateClusterPeerUrl(params.targetUrl, params.allowHttp ?? true);
  const path = params.path.startsWith('/') ? params.path : `/${params.path}`;
  const bodyBytes =
    params.body !== undefined ? Buffer.from(JSON.stringify(params.body), 'utf8') : undefined;
  const headers = buildSignedPeerHeaders({
    identity: params.identity,
    recipientHubId: params.targetHubId,
    homeId: params.homeId,
    channelSecret: params.channelSecret,
    method: params.method,
    path,
    bodyBytes,
  });

  const response = await fetch(`${origin}${path}`, {
    method: params.method,
    redirect: 'error',
    headers: {
      ...headers,
      ...(bodyBytes ? { 'content-type': 'application/json' } : {}),
    },
    ...(bodyBytes ? { body: new Uint8Array(bodyBytes) } : {}),
    signal: AbortSignal.timeout(params.timeoutMs ?? 8000),
  });

  const rawBuffer = Buffer.from(await response.arrayBuffer());
  if (rawBuffer.length > MAX_RESPONSE_BYTES) {
    throw Error('peer_response_too_large');
  }
  const text = rawBuffer.toString('utf8');
  if (!response.ok) {
    let reason = `peer_http_${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) reason = parsed.error;
      else if (typeof parsed.message === 'string' && parsed.message) reason = parsed.message;
    } catch {
      // Preserve HTTP status error.
    }
    throw Error(reason);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Downloads binary media/backup streams cleanly from a signed peer URL and returns verified bytes. */
export async function fetchSignedPeerBytes(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly targetUrl: string;
  readonly allowHttp?: boolean;
  readonly channelSecret?: string;
  readonly path: string;
  readonly expectedSha256?: string;
  readonly timeoutMs?: number;
}): Promise<Buffer> {
  const origin = validateClusterPeerUrl(params.targetUrl, params.allowHttp ?? true);
  const path = params.path.startsWith('/') ? params.path : `/${params.path}`;
  const signPath = path.split('?')[0] || '/';
  const headers = buildSignedPeerHeaders({
    identity: params.identity,
    recipientHubId: params.targetHubId,
    homeId: params.homeId,
    channelSecret: params.channelSecret,
    method: 'GET',
    path: signPath,
  });
  const response = await fetch(`${origin}${path}`, {
    method: 'GET',
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(params.timeoutMs ?? 20_000),
  });
  if (!response.ok) {
    throw Error(`peer_media_http_${response.status}`);
  }
  const declaredLen = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_MEDIA_TRANSFER_BYTES) {
    throw Error('peer_media_too_large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_MEDIA_TRANSFER_BYTES) {
    throw Error('peer_media_too_large');
  }
  if (params.expectedSha256) {
    const actual = sha256Hex(bytes);
    if (actual !== params.expectedSha256) {
      throw Error('peer_media_digest_mismatch');
    }
  }
  return bytes;
}
