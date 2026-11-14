/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { ClusterCryptoIdentity } from './identity.js';

export type ClusterSyncArtifactKind = 'credential' | 'config' | 'cache' | 'transfer_bundle';

export interface ClusterSecretEnvelope {
  readonly version: 1;
  readonly homeId: string;
  readonly senderHubId: string;
  readonly recipientHubId: string;
  readonly kind: ClusterSyncArtifactKind;
  readonly resourceId: string;
  readonly revision: number;
  readonly generation: number;
  readonly epoch: number;
  readonly keyId: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly ephemeralPublicKey: string;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
  readonly signature: string;
}

const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 60_000;
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_REPLAY_ENTRIES = 20_000;

export class BoundedReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = DEFAULT_MAX_REPLAY_ENTRIES) {}

  consume(senderHubId: string, nonce: string, expiresAt: number, now = Date.now()): boolean {
    if (!senderHubId || !/^[a-f0-9]{32}$/.test(nonce)) return false;
    for (const [key, exp] of this.seen) {
      if (exp < now) this.seen.delete(key);
    }
    const composite = `${senderHubId}\0${nonce}`;
    if (this.seen.has(composite) || this.seen.size >= this.maxEntries) {
      return false;
    }
    this.seen.set(composite, Math.max(expiresAt, now + MAX_CLOCK_SKEW_MS));
    return true;
  }
}

function envelopeAad(meta: {
  homeId: string;
  senderHubId: string;
  recipientHubId: string;
  kind: ClusterSyncArtifactKind;
  resourceId: string;
  revision: number;
  generation: number;
  epoch: number;
  keyId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): Buffer {
  return Buffer.from(
    JSON.stringify([
      'haus.cluster.envelope',
      1,
      meta.homeId,
      meta.senderHubId,
      meta.recipientHubId,
      meta.kind,
      meta.resourceId,
      meta.revision,
      meta.generation,
      meta.epoch,
      meta.keyId,
      meta.nonce,
      meta.issuedAt,
      meta.expiresAt,
    ]),
    'utf8',
  );
}

function envelopeSigningDigest(
  aad: Buffer,
  ephemeralPublicKey: string,
  salt: string,
  iv: string,
  ciphertext: string,
  tag: string,
): Buffer {
  return createHash('sha256')
    .update(aad)
    .update('\0')
    .update(ephemeralPublicKey)
    .update('\0')
    .update(salt)
    .update('\0')
    .update(iv)
    .update('\0')
    .update(ciphertext)
    .update('\0')
    .update(tag)
    .digest();
}

function deriveEnvelopeAesKey(
  sharedSecret: Buffer,
  salt: Buffer,
  meta: {
    homeId: string;
    senderHubId: string;
    recipientHubId: string;
    kind: ClusterSyncArtifactKind;
    keyId: string;
  },
): Buffer {
  const info = Buffer.from(
    `haus.cluster.envelope.v1|${meta.homeId}|${meta.senderHubId}|${meta.recipientHubId}|${meta.kind}|${meta.keyId}`,
    'utf8',
  );
  return Buffer.from(hkdfSync('sha256', sharedSecret, salt, info, 32));
}

/**
 * Seals credentials, configs, or cache deltas inside a forward-secret ECDH + HKDF + AES-256-GCM
 * authenticated envelope bound to home, sender, recipient, epoch, revision, and generation.
 */
export function sealClusterEnvelope(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly homeId: string;
  readonly recipientHubId: string;
  readonly recipientExchangePublicKey: string;
  readonly kind: ClusterSyncArtifactKind;
  readonly resourceId: string;
  readonly revision: number;
  readonly generation: number;
  readonly epoch: number;
  readonly keyId?: string;
  readonly payload: unknown;
  readonly now?: number;
  readonly ttlMs?: number;
}): ClusterSecretEnvelope {
  const issuedAt = params.now ?? Date.now();
  const expiresAt = issuedAt + (params.ttlMs ?? DEFAULT_TTL_MS);
  const nonce = randomBytes(16).toString('hex');
  const keyId = params.keyId ?? `k-${issuedAt}-${nonce.slice(0, 8)}`;
  const eph = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const salt = randomBytes(32);
  const iv = randomBytes(12);

  let plaintext: Buffer | undefined;
  let sharedSecret: Buffer | undefined;
  let aesKey: Buffer | undefined;
  try {
    plaintext = Buffer.from(JSON.stringify(params.payload), 'utf8');
    if (plaintext.length === 0 || plaintext.length > MAX_ENVELOPE_BYTES) {
      throw Error('invalid_envelope_payload_size');
    }
    const aad = envelopeAad({
      homeId: params.homeId,
      senderHubId: params.identity.hubId,
      recipientHubId: params.recipientHubId,
      kind: params.kind,
      resourceId: params.resourceId,
      revision: params.revision,
      generation: params.generation,
      epoch: params.epoch,
      keyId,
      nonce,
      issuedAt,
      expiresAt,
    });
    const recipientPub = createPublicKey(params.recipientExchangePublicKey);
    sharedSecret = diffieHellman({
      privateKey: eph.privateKey,
      publicKey: recipientPub,
    });
    aesKey = deriveEnvelopeAesKey(sharedSecret, salt, {
      homeId: params.homeId,
      senderHubId: params.identity.hubId,
      recipientHubId: params.recipientHubId,
      kind: params.kind,
      keyId,
    });

    const cipher = createCipheriv('aes-256-gcm', aesKey, iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString(
      'base64url',
    );
    const tag = cipher.getAuthTag().toString('base64url');
    const saltB64 = salt.toString('base64url');
    const ivB64 = iv.toString('base64url');
    const signingDigest = envelopeSigningDigest(
      aad,
      eph.publicKey,
      saltB64,
      ivB64,
      ciphertext,
      tag,
    );
    const signature = params.identity.signPayload(signingDigest);

    return {
      version: 1,
      homeId: params.homeId,
      senderHubId: params.identity.hubId,
      recipientHubId: params.recipientHubId,
      kind: params.kind,
      resourceId: params.resourceId,
      revision: params.revision,
      generation: params.generation,
      epoch: params.epoch,
      keyId,
      nonce,
      issuedAt,
      expiresAt,
      ephemeralPublicKey: eph.publicKey,
      salt: saltB64,
      iv: ivB64,
      ciphertext,
      tag,
      signature,
    };
  } finally {
    plaintext?.fill(0);
    sharedSecret?.fill(0);
    aesKey?.fill(0);
  }
}

export interface EnvelopeWatermark {
  readonly epoch: number;
  readonly revision: number;
  readonly generation: number;
}

export function isNewerWatermark(
  candidate: EnvelopeWatermark,
  baseline?: EnvelopeWatermark,
): boolean {
  if (!baseline) return true;
  if (candidate.epoch !== baseline.epoch) return candidate.epoch > baseline.epoch;
  if (candidate.revision !== baseline.revision) return candidate.revision > baseline.revision;
  return candidate.generation > baseline.generation;
}

/**
 * Verifies Ed25519 signature, replay nonce, expiry, home/recipient/AAD binding, and optional monotonic
 * watermark before decrypting the AES-256-GCM envelope.
 */
export function openClusterEnvelope<T = unknown>(params: {
  readonly identity: ClusterCryptoIdentity;
  readonly expectedHomeId: string;
  readonly senderSigningPublicKey: string;
  readonly envelope: ClusterSecretEnvelope;
  readonly replayGuard?: BoundedReplayGuard;
  readonly minExpectedEpoch?: number;
  readonly lastAcceptedWatermark?: EnvelopeWatermark;
  readonly now?: number;
}): { readonly meta: ClusterSecretEnvelope; readonly payload: T } {
  const env = params.envelope;
  const now = params.now ?? Date.now();
  if (!env || env.version !== 1) throw Error('invalid_envelope_version');
  if (env.homeId !== params.expectedHomeId) throw Error('envelope_wrong_home');
  if (env.recipientHubId !== params.identity.hubId) throw Error('envelope_wrong_recipient');
  if (!Number.isSafeInteger(env.issuedAt) || !Number.isSafeInteger(env.expiresAt)) {
    throw Error('invalid_envelope_timestamps');
  }
  if (env.issuedAt - now > MAX_CLOCK_SKEW_MS) throw Error('envelope_clock_skew');
  if (now > env.expiresAt) throw Error('envelope_expired');
  if (params.minExpectedEpoch !== undefined && env.epoch < params.minExpectedEpoch) {
    throw Error('stale_cluster_epoch');
  }
  if (
    params.lastAcceptedWatermark &&
    !isNewerWatermark(
      { epoch: env.epoch, revision: env.revision, generation: env.generation },
      params.lastAcceptedWatermark,
    )
  ) {
    throw Error('stale_secret_revision');
  }

  const aad = envelopeAad(env);
  const digest = envelopeSigningDigest(
    aad,
    env.ephemeralPublicKey,
    env.salt,
    env.iv,
    env.ciphertext,
    env.tag,
  );
  if (
    !ClusterCryptoIdentity.verifySignature(params.senderSigningPublicKey, digest, env.signature)
  ) {
    throw Error('invalid_envelope_signature');
  }

  if (
    params.replayGuard &&
    !params.replayGuard.consume(env.senderHubId, env.nonce, env.expiresAt, now)
  ) {
    throw Error('envelope_replay_detected');
  }

  let sharedSecret: Buffer | undefined;
  let aesKey: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    const salt = Buffer.from(env.salt, 'base64url');
    const iv = Buffer.from(env.iv, 'base64url');
    const tag = Buffer.from(env.tag, 'base64url');
    const ciphertext = Buffer.from(env.ciphertext, 'base64url');
    if (
      salt.length !== 32 ||
      iv.length !== 12 ||
      tag.length !== 16 ||
      ciphertext.length === 0 ||
      ciphertext.length > MAX_ENVELOPE_BYTES
    ) {
      throw Error('invalid_envelope_ciphertext');
    }

    const ephPub = createPublicKey(env.ephemeralPublicKey);
    if (ephPub.asymmetricKeyType !== 'x25519') {
      throw Error('invalid_ephemeral_key_type');
    }
    sharedSecret = diffieHellman({
      privateKey: params.identity.getExchangePrivateKey(),
      publicKey: ephPub,
    });
    aesKey = deriveEnvelopeAesKey(sharedSecret, salt, {
      homeId: env.homeId,
      senderHubId: env.senderHubId,
      recipientHubId: env.recipientHubId,
      kind: env.kind,
      keyId: env.keyId,
    });

    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plaintext.toString('utf8')) as T;
    return { meta: env, payload };
  } finally {
    sharedSecret?.fill(0);
    aesKey?.fill(0);
    plaintext?.fill(0);
  }
}
