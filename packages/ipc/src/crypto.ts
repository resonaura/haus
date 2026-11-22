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
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import {
  canonicalTerminalHandshakeTranscript,
  decodeTerminalClientPayload,
  decodeTerminalServerPayload,
  encodeTerminalClientPayload,
  encodeTerminalServerPayload,
  TERMINAL_DIR_CLIENT_TO_SERVER,
  TERMINAL_DIR_SERVER_TO_CLIENT,
  TERMINAL_FRAME_HEADER_BYTES,
  TERMINAL_MAX_FRAME_BYTES,
  TERMINAL_MAX_FRAME_SEQ,
  TERMINAL_PROTOCOL_VERSION,
  TERMINAL_TICKET_TTL_MS,
  TERMINAL_WIRE_LENGTH_BYTES,
  terminalKeyDerivationInfo,
  type TerminalClientFrame,
  type TerminalDirection,
  type TerminalKeyLabel,
  type TerminalServerFrame,
  type TerminalTicketRequest,
  type TerminalTicketResponse,
} from '@haus/core/protocol';

/** Minimal Ed25519 Hub signing identity port required by the server-side IPC handshake. */
export interface TerminalSigningIdentity {
  readonly hubId: string;
  readonly signingPublicKey: string;
  signPayload(payload: Buffer): string;
}

export interface ClientEphemeralKeypair {
  readonly publicKeyPem: string;
  readonly privateKey: KeyObject;
  readonly clientNonce: string;
}

export interface ServerTerminalHandshakeResult {
  readonly response: TerminalTicketResponse;
  readonly crypto: TerminalCryptoSession;
}

export interface ClientTerminalHandshakeResult {
  readonly session: TerminalCryptoSession;
  readonly displayFingerprint: string;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function signingKeyFingerprintHex(signingPublicKeyPem: string): string {
  return sha256Hex(signingPublicKeyPem.trim());
}

export function formatFingerprintDisplay(hexSha256: string): string {
  return `SHA256:${Buffer.from(hexSha256, 'hex').toString('base64').replace(/=+$/, '')}`;
}

export function generateClientTerminalKeypair(): ClientEphemeralKeypair {
  const pair = generateKeyPairSync('x25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
  return {
    publicKeyPem,
    privateKey: pair.privateKey,
    clientNonce: randomBytes(16).toString('hex'),
  };
}

function buildFrameIv(base: Buffer, seq: bigint): Buffer {
  const iv = Buffer.from(base);
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64BE(seq, 0);
  for (let i = 0; i < 8; i += 1) {
    iv[4 + i] ^= seqBuf[i] ?? 0;
  }
  return iv;
}

function buildFrameAad(direction: TerminalDirection, seq: bigint, ticketId: string): Buffer {
  const ticketBytes = Buffer.from(ticketId, 'utf8');
  const aad = Buffer.alloc(10 + ticketBytes.length);
  aad.writeUInt8(TERMINAL_PROTOCOL_VERSION, 0);
  aad.writeUInt8(direction, 1);
  aad.writeBigUInt64BE(seq, 2);
  ticketBytes.copy(aad, 10);
  return aad;
}

function deriveSessionKey(params: {
  readonly sharedSecret: Buffer;
  readonly saltBytes: Buffer;
  readonly homeId: string;
  readonly targetHubId: string;
  readonly ticketId: string;
  readonly transcriptHash: string;
  readonly label: TerminalKeyLabel;
  readonly length: number;
}): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      params.sharedSecret,
      params.saltBytes,
      Buffer.from(
        terminalKeyDerivationInfo({
          homeId: params.homeId,
          targetHubId: params.targetHubId,
          ticketId: params.ticketId,
          transcriptHash: params.transcriptHash,
          label: params.label,
        }),
        'utf8',
      ),
      params.length,
    ),
  );
}

/**
 * Unified forward-secret directional AES-256-GCM frame channel (`haus.terminal.v1`).
 * Used identically on both Hub (server) and Desktop/CLI (client) with monotonic 64-bit
 * sequence numbers, AAD binding, proof-of-possession, and explicit key zeroization on close.
 */
export class TerminalCryptoSession {
  private sendSeq = 0n;
  private recvSeq = 1n;
  private destroyed = false;

  constructor(
    readonly ticketId: string,
    private readonly sendDir: TerminalDirection,
    private readonly recvDir: TerminalDirection,
    private readonly sendKey: Buffer,
    private readonly recvKey: Buffer,
    private readonly sendIvBase: Buffer,
    private readonly recvIvBase: Buffer,
    private readonly authKey?: Buffer,
    private readonly transcriptHash?: string,
    readonly proof = '',
  ) {}

  verifyClientProof(proofBase64Url: string): boolean {
    if (
      this.destroyed ||
      !this.authKey ||
      !this.transcriptHash ||
      !proofBase64Url ||
      proofBase64Url.length > 128
    ) {
      return false;
    }
    const expected = createHmac('sha256', this.authKey)
      .update(this.transcriptHash, 'utf8')
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(proofBase64Url, 'base64url');
    } catch {
      return false;
    }
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(expected, supplied);
  }

  sealServer(frame: TerminalServerFrame): Buffer {
    if (this.sendDir !== TERMINAL_DIR_SERVER_TO_CLIENT) {
      throw Error('invalid_terminal_frame_direction');
    }
    return this.sealWireBytes(encodeTerminalServerPayload(frame));
  }

  sealClient(frame: TerminalClientFrame): Buffer {
    if (this.sendDir !== TERMINAL_DIR_CLIENT_TO_SERVER) {
      throw Error('invalid_terminal_frame_direction');
    }
    return this.sealWireBytes(encodeTerminalClientPayload(frame));
  }

  openClient(envelope: Buffer): TerminalClientFrame {
    if (this.recvDir !== TERMINAL_DIR_CLIENT_TO_SERVER) {
      throw Error('invalid_terminal_frame_direction');
    }
    const plaintext = this.openEnvelope(envelope);
    try {
      return decodeTerminalClientPayload(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  openServer(envelope: Buffer): TerminalServerFrame {
    if (this.recvDir !== TERMINAL_DIR_SERVER_TO_CLIENT) {
      throw Error('invalid_terminal_frame_direction');
    }
    const plaintext = this.openEnvelope(envelope);
    try {
      return decodeTerminalServerPayload(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  /** Seals raw binary payload into `[len:4][ver:1][dir:1][seq:8][tag:16][ct:N]`. */
  private sealWireBytes(plaintext: Uint8Array): Buffer {
    if (this.destroyed) throw Error('terminal_crypto_destroyed');
    const seq = this.sendSeq + 1n;
    if (seq > TERMINAL_MAX_FRAME_SEQ) throw Error('terminal_sequence_exhausted');
    const envelopeLen = TERMINAL_FRAME_HEADER_BYTES + plaintext.byteLength;
    if (plaintext.byteLength === 0 || envelopeLen > TERMINAL_MAX_FRAME_BYTES) {
      throw Error('terminal_frame_too_large');
    }
    const iv = buildFrameIv(this.sendIvBase, seq);
    const aad = buildFrameAad(this.sendDir, seq, this.ticketId);
    const cipher = createCipheriv('aes-256-gcm', this.sendKey, iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ct1 = cipher.update(plaintext);
    const ct2 = cipher.final();
    const tag = cipher.getAuthTag();
    this.sendSeq = seq;

    const wire = Buffer.allocUnsafe(TERMINAL_WIRE_LENGTH_BYTES + envelopeLen);
    wire.writeUInt32BE(envelopeLen, 0);
    wire.writeUInt8(TERMINAL_PROTOCOL_VERSION, 4);
    wire.writeUInt8(this.sendDir, 5);
    wire.writeBigUInt64BE(seq, 6);
    tag.copy(wire, 14);
    ct1.copy(wire, 30);
    if (ct2.length > 0) ct2.copy(wire, 30 + ct1.length);
    plaintext.fill(0);
    return wire;
  }

  private openEnvelope(envelope: Buffer): Buffer {
    if (this.destroyed) throw Error('terminal_crypto_destroyed');
    if (
      !Buffer.isBuffer(envelope) ||
      envelope.length <= TERMINAL_FRAME_HEADER_BYTES ||
      envelope.length > TERMINAL_MAX_FRAME_BYTES
    ) {
      throw Error('invalid_terminal_frame_length');
    }
    const version = envelope.readUInt8(0);
    const direction = envelope.readUInt8(1);
    const seq = envelope.readBigUInt64BE(2);
    if (version !== TERMINAL_PROTOCOL_VERSION || direction !== this.recvDir) {
      throw Error('invalid_terminal_frame_header');
    }
    if (seq !== this.recvSeq) {
      throw Error('terminal_frame_replay_or_order_violation');
    }
    const tag = envelope.subarray(10, 26);
    const ciphertext = envelope.subarray(26);
    const iv = buildFrameIv(this.recvIvBase, seq);
    const aad = buildFrameAad(this.recvDir, seq, this.ticketId);
    const decipher = createDecipheriv('aes-256-gcm', this.recvKey, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    try {
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      this.recvSeq = seq + 1n;
      return plaintext;
    } catch {
      throw Error('terminal_frame_auth_failed');
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sendKey.fill(0);
    this.recvKey.fill(0);
    this.sendIvBase.fill(0);
    this.recvIvBase.fill(0);
    this.authKey?.fill(0);
  }
}

export function createServerTerminalHandshake(params: {
  readonly identity: TerminalSigningIdentity;
  readonly homeId: string;
  readonly request: TerminalTicketRequest;
  readonly relayed?: boolean;
  readonly now?: number;
  readonly ttlMs?: number;
}): ServerTerminalHandshakeResult {
  const clientPub: KeyObject = createPublicKey(params.request.clientEphemeralPublicKey);
  if (clientPub.asymmetricKeyType !== 'x25519') {
    throw Error('invalid_client_ephemeral_key');
  }

  const serverEph = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const issuedAt = params.now ?? Date.now();
  const expiresAt = issuedAt + (params.ttlMs ?? TERMINAL_TICKET_TTL_MS);
  const ticketId = randomBytes(32).toString('hex');
  const serverNonce = randomBytes(16).toString('hex');
  const saltBytes = randomBytes(32);
  const salt = saltBytes.toString('base64url');
  const serverEphPub = serverEph.publicKey.trim();

  const transcript = canonicalTerminalHandshakeTranscript({
    homeId: params.homeId,
    targetHubId: params.identity.hubId,
    ticketId,
    clientEphemeralKeyHash: sha256Hex(params.request.clientEphemeralPublicKey),
    serverEphemeralKeyHash: sha256Hex(serverEphPub),
    clientNonce: params.request.clientNonce,
    serverNonce,
    salt,
    issuedAt,
    expiresAt,
  });
  const transcriptHash = sha256Hex(transcript);
  const signature = params.identity.signPayload(Buffer.from(transcript, 'utf8'));
  const hubSigningPublicKey = params.identity.signingPublicKey.trim();
  const hubKeyFingerprint = signingKeyFingerprintHex(hubSigningPublicKey);

  let sharedSecret: Buffer | undefined;
  try {
    sharedSecret = diffieHellman({
      privateKey: serverEph.privateKey,
      publicKey: clientPub,
    });
    if (sharedSecret.every((byte) => byte === 0)) {
      throw Error('invalid_x25519_shared_secret');
    }
    const base = {
      sharedSecret,
      saltBytes,
      homeId: params.homeId,
      targetHubId: params.identity.hubId,
      ticketId,
      transcriptHash,
    };
    const authKey = deriveSessionKey({ ...base, label: 'auth', length: 32 });
    const c2sKey = deriveSessionKey({ ...base, label: 'c2s-key', length: 32 });
    const s2cKey = deriveSessionKey({ ...base, label: 's2c-key', length: 32 });
    const c2sIv = deriveSessionKey({ ...base, label: 'c2s-iv', length: 12 });
    const s2cIv = deriveSessionKey({ ...base, label: 's2c-iv', length: 12 });

    const crypto = new TerminalCryptoSession(
      ticketId,
      TERMINAL_DIR_SERVER_TO_CLIENT,
      TERMINAL_DIR_CLIENT_TO_SERVER,
      s2cKey,
      c2sKey,
      s2cIv,
      c2sIv,
      authKey,
      transcriptHash,
    );

    return {
      response: {
        protocol: TERMINAL_PROTOCOL_VERSION,
        ticketId,
        targetHubId: params.identity.hubId,
        homeId: params.homeId,
        serverEphemeralPublicKey: serverEphPub,
        serverNonce,
        salt,
        issuedAt,
        expiresAt,
        hubSigningPublicKey,
        hubKeyFingerprint,
        signature,
        relayed: params.relayed === true,
      },
      crypto,
    };
  } finally {
    sharedSecret?.fill(0);
  }
}

/**
 * Verifies the Hub's Ed25519 handshake signature and self-authenticating key fingerprint,
 * performs ephemeral X25519 key agreement, and derives directional AES-256-GCM session keys.
 */
export function completeClientTerminalHandshake(params: {
  readonly keypair: ClientEphemeralKeypair;
  readonly response: TerminalTicketResponse;
  readonly now?: number;
}): ClientTerminalHandshakeResult {
  const { keypair, response } = params;
  const now = params.now ?? Date.now();
  if (response.expiresAt <= now - 5_000) {
    throw Error('terminal_ticket_expired');
  }
  const actualFingerprint = signingKeyFingerprintHex(response.hubSigningPublicKey);
  if (actualFingerprint !== response.hubKeyFingerprint) {
    throw Error('terminal_hub_fingerprint_mismatch');
  }
  const signingKey = createPublicKey(response.hubSigningPublicKey);
  if (signingKey.asymmetricKeyType !== 'ed25519') {
    throw Error('terminal_hub_invalid_signing_key');
  }

  const transcript = canonicalTerminalHandshakeTranscript({
    homeId: response.homeId,
    targetHubId: response.targetHubId,
    ticketId: response.ticketId,
    clientEphemeralKeyHash: sha256Hex(keypair.publicKeyPem),
    serverEphemeralKeyHash: sha256Hex(response.serverEphemeralPublicKey.trim()),
    clientNonce: keypair.clientNonce,
    serverNonce: response.serverNonce,
    salt: response.salt,
    issuedAt: response.issuedAt,
    expiresAt: response.expiresAt,
  });
  const sigBytes = Buffer.from(response.signature, 'base64url');
  if (
    sigBytes.length !== 64 ||
    !edVerify(null, Buffer.from(transcript, 'utf8'), signingKey, sigBytes)
  ) {
    throw Error('terminal_hub_signature_invalid');
  }

  const serverEphPub = createPublicKey(response.serverEphemeralPublicKey);
  if (serverEphPub.asymmetricKeyType !== 'x25519') {
    throw Error('terminal_server_invalid_ephemeral_key');
  }
  const saltBytes = Buffer.from(response.salt, 'base64url');
  if (saltBytes.length !== 32) {
    throw Error('terminal_invalid_salt');
  }
  const transcriptHash = sha256Hex(transcript);

  let sharedSecret: Buffer | undefined;
  let authKey: Buffer | undefined;
  try {
    sharedSecret = diffieHellman({
      privateKey: keypair.privateKey,
      publicKey: serverEphPub,
    });
    if (sharedSecret.every((byte) => byte === 0)) {
      throw Error('invalid_x25519_shared_secret');
    }
    const base = {
      sharedSecret,
      saltBytes,
      homeId: response.homeId,
      targetHubId: response.targetHubId,
      ticketId: response.ticketId,
      transcriptHash,
    };
    authKey = deriveSessionKey({ ...base, label: 'auth', length: 32 });
    const proof = createHmac('sha256', authKey).update(transcriptHash, 'utf8').digest('base64url');
    const c2sKey = deriveSessionKey({ ...base, label: 'c2s-key', length: 32 });
    const s2cKey = deriveSessionKey({ ...base, label: 's2c-key', length: 32 });
    const c2sIv = deriveSessionKey({ ...base, label: 'c2s-iv', length: 12 });
    const s2cIv = deriveSessionKey({ ...base, label: 's2c-iv', length: 12 });

    return {
      session: new TerminalCryptoSession(
        response.ticketId,
        TERMINAL_DIR_CLIENT_TO_SERVER,
        TERMINAL_DIR_SERVER_TO_CLIENT,
        c2sKey,
        s2cKey,
        c2sIv,
        s2cIv,
        undefined,
        undefined,
        proof,
      ),
      displayFingerprint: formatFingerprintDisplay(actualFingerprint),
    };
  } finally {
    sharedSecret?.fill(0);
    authKey?.fill(0);
  }
}
