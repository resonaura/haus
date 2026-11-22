/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  isReadOnlyTerminalTarget,
  validateTerminalTarget,
  type TerminalServiceManager,
  type TerminalTarget,
} from './terminal-target.js';

export {
  isReadOnlyTerminalTarget,
  validateTerminalTarget,
  type TerminalServiceManager,
  type TerminalTarget,
};

export const TERMINAL_PROTOCOL_VERSION = 1 as const;
export const TERMINAL_IPC_UPGRADE = 'haus-terminal-ipc' as const;
export const TERMINAL_MIN_COLS = 2;
export const TERMINAL_MAX_COLS = 500;
export const TERMINAL_MIN_ROWS = 1;
export const TERMINAL_MAX_ROWS = 300;
export const TERMINAL_MAX_INPUT_BYTES = 65_536;
export const TERMINAL_MAX_FRAME_BYTES = 131_072;
export const TERMINAL_WIRE_LENGTH_BYTES = 4; // uint32 BE envelope length prefix
export const TERMINAL_FRAME_HEADER_BYTES = 26; // version(1) + direction(1) + seq(8) + tag(16)
export const TERMINAL_TICKET_TTL_MS = 15_000;
export const TERMINAL_IDLE_TIMEOUT_MS = 30 * 60_000;
export const TERMINAL_DIR_CLIENT_TO_SERVER = 1 as const;
export const TERMINAL_DIR_SERVER_TO_CLIENT = 2 as const;
export const TERMINAL_MAX_FRAME_SEQ = 0xffffffffffffn;

export const TERMINAL_TICKET_HEADER = 'x-haus-terminal-ticket';
export const TERMINAL_PROOF_HEADER = 'x-haus-terminal-proof';

export const TERMINAL_OP_DATA = 0x01 as const;
export const TERMINAL_OP_RESIZE = 0x02 as const;
export const TERMINAL_OP_ACK = 0x03 as const;
export const TERMINAL_OP_PING = 0x04 as const;
export const TERMINAL_OP_PONG = 0x05 as const;
export const TERMINAL_OP_CLOSE = 0x06 as const;
export const TERMINAL_OP_READY = 0x07 as const;
export const TERMINAL_OP_EXIT = 0x08 as const;
export const TERMINAL_OP_ERROR = 0x09 as const;

export type TerminalDirection =
  typeof TERMINAL_DIR_CLIENT_TO_SERVER | typeof TERMINAL_DIR_SERVER_TO_CLIENT;

export type TerminalRuntimeScope = 'container' | 'host';

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalTicketRequest {
  readonly targetServerId: string;
  readonly cols: number;
  readonly rows: number;
  readonly clientEphemeralPublicKey: string;
  readonly clientNonce: string;
  readonly target?: TerminalTarget;
}

export interface TerminalTicketResponse {
  readonly protocol: typeof TERMINAL_PROTOCOL_VERSION;
  readonly ticketId: string;
  readonly targetHubId: string;
  readonly homeId: string;
  readonly serverEphemeralPublicKey: string;
  readonly serverNonce: string;
  readonly salt: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly hubSigningPublicKey: string;
  readonly hubKeyFingerprint: string;
  readonly signature: string;
  readonly relayed: boolean;
}

export type TerminalClientFrame =
  | { readonly t: 'data'; readonly d: Uint8Array }
  | { readonly t: 'resize'; readonly cols: number; readonly rows: number }
  | { readonly t: 'ack'; readonly bytes: number }
  | { readonly t: 'ping'; readonly n: number }
  | { readonly t: 'pong'; readonly n: number }
  | { readonly t: 'close' };

export type TerminalServerFrame =
  | {
      readonly t: 'ready';
      readonly cols: number;
      readonly rows: number;
      readonly shell: string;
      readonly scope: TerminalRuntimeScope;
      readonly hostname: string;
      readonly readOnly?: boolean;
    }
  | { readonly t: 'data'; readonly d: Uint8Array }
  | { readonly t: 'exit'; readonly code: number | null; readonly signal: string | null }
  | { readonly t: 'ping'; readonly n: number }
  | { readonly t: 'pong'; readonly n: number }
  | { readonly t: 'error'; readonly code: string };

const SAFE_SERVER_ID_RE = /^[\w:.-]{1,160}$/;
const HEX_32_RE = /^[a-f0-9]{32}$/;
const HEX_64_RE = /^[a-f0-9]{64}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]{16,512}$/;
const PEM_PUBLIC_KEY_RE =
  /^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]{16,1024}\r?\n-----END PUBLIC KEY-----\r?\n?$/;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTerminalDimensions(cols: unknown, rows: unknown): TerminalDimensions {
  if (
    typeof cols !== 'number' ||
    typeof rows !== 'number' ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < TERMINAL_MIN_COLS ||
    cols > TERMINAL_MAX_COLS ||
    rows < TERMINAL_MIN_ROWS ||
    rows > TERMINAL_MAX_ROWS
  ) {
    throw Error('invalid_terminal_dimensions');
  }
  return { cols, rows };
}

export function validateTerminalServerId(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_SERVER_ID_RE.test(value)) {
    throw Error('invalid_terminal_server_id');
  }
  return value;
}

export function validateTerminalPublicKeyPem(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !PEM_PUBLIC_KEY_RE.test(value.trim())) {
    throw Error('invalid_terminal_public_key');
  }
  return value.trim();
}

export function validateTerminalTicketRequest(raw: unknown): TerminalTicketRequest {
  if (!isRecord(raw)) throw Error('invalid_terminal_ticket_request');
  const targetServerId = validateTerminalServerId(raw.targetServerId);
  const { cols, rows } = validateTerminalDimensions(raw.cols, raw.rows);
  const clientEphemeralPublicKey = validateTerminalPublicKeyPem(raw.clientEphemeralPublicKey);
  if (typeof raw.clientNonce !== 'string' || !HEX_32_RE.test(raw.clientNonce)) {
    throw Error('invalid_terminal_nonce');
  }
  const target = validateTerminalTarget(raw.target);
  return {
    targetServerId,
    cols,
    rows,
    clientEphemeralPublicKey,
    clientNonce: raw.clientNonce,
    target,
  };
}

export function validateTerminalTicketResponse(raw: unknown): TerminalTicketResponse {
  if (!isRecord(raw)) throw Error('invalid_terminal_ticket_response');
  if (raw.protocol !== TERMINAL_PROTOCOL_VERSION) {
    throw Error('unsupported_terminal_protocol');
  }
  if (typeof raw.ticketId !== 'string' || !HEX_64_RE.test(raw.ticketId)) {
    throw Error('invalid_terminal_ticket_id');
  }
  const targetHubId = validateTerminalServerId(raw.targetHubId);
  if (typeof raw.homeId !== 'string' || raw.homeId.length < 1 || raw.homeId.length > 160) {
    throw Error('invalid_terminal_home_id');
  }
  const serverEphemeralPublicKey = validateTerminalPublicKeyPem(raw.serverEphemeralPublicKey);
  const hubSigningPublicKey = validateTerminalPublicKeyPem(raw.hubSigningPublicKey);
  if (typeof raw.serverNonce !== 'string' || !HEX_32_RE.test(raw.serverNonce)) {
    throw Error('invalid_terminal_server_nonce');
  }
  if (typeof raw.salt !== 'string' || !BASE64URL_RE.test(raw.salt)) {
    throw Error('invalid_terminal_salt');
  }
  if (typeof raw.hubKeyFingerprint !== 'string' || !HEX_64_RE.test(raw.hubKeyFingerprint)) {
    throw Error('invalid_terminal_hub_fingerprint');
  }
  if (typeof raw.signature !== 'string' || !BASE64URL_RE.test(raw.signature)) {
    throw Error('invalid_terminal_signature');
  }
  if (
    typeof raw.issuedAt !== 'number' ||
    typeof raw.expiresAt !== 'number' ||
    !Number.isSafeInteger(raw.issuedAt) ||
    !Number.isSafeInteger(raw.expiresAt) ||
    raw.expiresAt <= raw.issuedAt ||
    raw.expiresAt - raw.issuedAt > 60_000
  ) {
    throw Error('invalid_terminal_timestamps');
  }
  return {
    protocol: TERMINAL_PROTOCOL_VERSION,
    ticketId: raw.ticketId,
    targetHubId,
    homeId: raw.homeId,
    serverEphemeralPublicKey,
    serverNonce: raw.serverNonce,
    salt: raw.salt,
    issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt,
    hubSigningPublicKey,
    hubKeyFingerprint: raw.hubKeyFingerprint,
    signature: raw.signature,
    relayed: raw.relayed === true,
  };
}

function encodeU32Frame(op: number, value: number): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = op;
  new DataView(out.buffer).setUint32(1, value >>> 0, false);
  return out;
}

function encodeJsonControl(op: number, payload: unknown): Uint8Array {
  const json = textEncoder.encode(JSON.stringify(payload));
  const out = new Uint8Array(1 + json.byteLength);
  out[0] = op;
  out.set(json, 1);
  return out;
}

/** Encodes a client-to-server terminal payload as compact binary (zero JSON on data hot path). */
export function encodeTerminalClientPayload(frame: TerminalClientFrame): Uint8Array {
  switch (frame.t) {
    case 'data': {
      if (frame.d.byteLength === 0 || frame.d.byteLength > TERMINAL_MAX_INPUT_BYTES) {
        throw Error('invalid_terminal_data');
      }
      const out = new Uint8Array(1 + frame.d.byteLength);
      out[0] = TERMINAL_OP_DATA;
      out.set(frame.d, 1);
      return out;
    }
    case 'resize': {
      const { cols, rows } = validateTerminalDimensions(frame.cols, frame.rows);
      const out = new Uint8Array(5);
      out[0] = TERMINAL_OP_RESIZE;
      const view = new DataView(out.buffer);
      view.setUint16(1, cols, false);
      view.setUint16(3, rows, false);
      return out;
    }
    case 'ack':
      return encodeU32Frame(TERMINAL_OP_ACK, frame.bytes);
    case 'ping':
      return encodeU32Frame(TERMINAL_OP_PING, frame.n);
    case 'pong':
      return encodeU32Frame(TERMINAL_OP_PONG, frame.n);
    case 'close':
      return new Uint8Array([TERMINAL_OP_CLOSE]);
  }
}

/** Decodes and validates a decrypted client-to-server binary payload. */
export function decodeTerminalClientPayload(bytes: Uint8Array): TerminalClientFrame {
  if (bytes.byteLength === 0) throw Error('invalid_terminal_frame');
  const op = bytes[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (op) {
    case TERMINAL_OP_DATA: {
      const dataLen = bytes.byteLength - 1;
      if (dataLen === 0 || dataLen > TERMINAL_MAX_INPUT_BYTES) {
        throw Error('invalid_terminal_data');
      }
      // Copy into a standalone Uint8Array (Buffer.prototype.slice shares memory with the caller's scratch buffer).
      return { t: 'data', d: new Uint8Array(bytes.subarray(1)) };
    }
    case TERMINAL_OP_RESIZE: {
      if (bytes.byteLength !== 5) throw Error('invalid_terminal_dimensions');
      const { cols, rows } = validateTerminalDimensions(
        view.getUint16(1, false),
        view.getUint16(3, false),
      );
      return { t: 'resize', cols, rows };
    }
    case TERMINAL_OP_ACK: {
      if (bytes.byteLength !== 5) throw Error('invalid_terminal_ack');
      const ackBytes = view.getUint32(1, false);
      if (ackBytes > 2 * 1024 * 1024) throw Error('invalid_terminal_ack');
      return { t: 'ack', bytes: ackBytes };
    }
    case TERMINAL_OP_PING:
      if (bytes.byteLength !== 5) throw Error('invalid_terminal_ping');
      return { t: 'ping', n: view.getUint32(1, false) };
    case TERMINAL_OP_PONG:
      if (bytes.byteLength !== 5) throw Error('invalid_terminal_pong');
      return { t: 'pong', n: view.getUint32(1, false) };
    case TERMINAL_OP_CLOSE:
      if (bytes.byteLength !== 1) throw Error('invalid_terminal_close');
      return { t: 'close' };
    default:
      throw Error('unknown_terminal_frame_type');
  }
}

/** Encodes a server-to-client terminal payload as compact binary (zero JSON on data hot path). */
export function encodeTerminalServerPayload(frame: TerminalServerFrame): Uint8Array {
  switch (frame.t) {
    case 'data': {
      if (
        frame.d.byteLength === 0 ||
        frame.d.byteLength + TERMINAL_FRAME_HEADER_BYTES + 1 > TERMINAL_MAX_FRAME_BYTES
      ) {
        throw Error('invalid_terminal_data_frame');
      }
      const out = new Uint8Array(1 + frame.d.byteLength);
      out[0] = TERMINAL_OP_DATA;
      out.set(frame.d, 1);
      return out;
    }
    case 'ping':
      return encodeU32Frame(TERMINAL_OP_PING, frame.n);
    case 'pong':
      return encodeU32Frame(TERMINAL_OP_PONG, frame.n);
    case 'ready':
      return encodeJsonControl(TERMINAL_OP_READY, {
        cols: frame.cols,
        rows: frame.rows,
        shell: frame.shell,
        scope: frame.scope,
        hostname: frame.hostname,
        ...(frame.readOnly ? { readOnly: true } : {}),
      });
    case 'exit':
      return encodeJsonControl(TERMINAL_OP_EXIT, { code: frame.code, signal: frame.signal });
    case 'error':
      return encodeJsonControl(TERMINAL_OP_ERROR, { code: frame.code });
  }
}

/** Decodes and validates a decrypted server-to-client binary payload. */
export function decodeTerminalServerPayload(bytes: Uint8Array): TerminalServerFrame {
  if (bytes.byteLength === 0) throw Error('invalid_terminal_frame');
  const op = bytes[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (op) {
    case TERMINAL_OP_DATA: {
      if (bytes.byteLength < 2 || bytes.byteLength > TERMINAL_MAX_FRAME_BYTES) {
        throw Error('invalid_terminal_data_frame');
      }
      // Copy into a standalone Uint8Array (Buffer.prototype.slice shares memory with the caller's scratch buffer).
      return { t: 'data', d: new Uint8Array(bytes.subarray(1)) };
    }
    case TERMINAL_OP_PING:
      if (bytes.byteLength !== 5) throw Error('invalid_terminal_ping_frame');
      return { t: 'ping', n: view.getUint32(1, false) };
    case TERMINAL_OP_PONG:
      if (bytes.byteLength !== 5) throw Error('invalid_terminal_pong_frame');
      return { t: 'pong', n: view.getUint32(1, false) };
    case TERMINAL_OP_READY: {
      const raw = JSON.parse(textDecoder.decode(bytes.subarray(1))) as unknown;
      if (!isRecord(raw)) throw Error('invalid_terminal_ready_frame');
      const { cols, rows } = validateTerminalDimensions(raw.cols, raw.rows);
      if (
        typeof raw.shell !== 'string' ||
        raw.shell.length > 64 ||
        (raw.scope !== 'container' && raw.scope !== 'host') ||
        typeof raw.hostname !== 'string' ||
        raw.hostname.length > 253
      ) {
        throw Error('invalid_terminal_ready_frame');
      }
      return {
        t: 'ready',
        cols,
        rows,
        shell: raw.shell,
        scope: raw.scope,
        hostname: raw.hostname,
        ...(raw.readOnly === true ? { readOnly: true } : {}),
      };
    }
    case TERMINAL_OP_EXIT: {
      const raw = JSON.parse(textDecoder.decode(bytes.subarray(1))) as unknown;
      if (
        !isRecord(raw) ||
        (raw.code !== null && (typeof raw.code !== 'number' || !Number.isInteger(raw.code))) ||
        (raw.signal !== null && (typeof raw.signal !== 'string' || raw.signal.length > 32))
      ) {
        throw Error('invalid_terminal_exit_frame');
      }
      return { t: 'exit', code: raw.code, signal: raw.signal };
    }
    case TERMINAL_OP_ERROR: {
      const raw = JSON.parse(textDecoder.decode(bytes.subarray(1))) as unknown;
      if (!isRecord(raw) || typeof raw.code !== 'string' || raw.code.length > 128) {
        throw Error('invalid_terminal_error_frame');
      }
      return { t: 'error', code: raw.code };
    }
    default:
      throw Error('unknown_terminal_frame_type');
  }
}

export interface TerminalHandshakeTranscriptInput {
  readonly homeId: string;
  readonly targetHubId: string;
  readonly ticketId: string;
  readonly clientEphemeralKeyHash: string;
  readonly serverEphemeralKeyHash: string;
  readonly clientNonce: string;
  readonly serverNonce: string;
  readonly salt: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function canonicalTerminalHandshakeTranscript(
  input: TerminalHandshakeTranscriptInput,
): string {
  return JSON.stringify([
    'haus.terminal.v1.handshake',
    TERMINAL_PROTOCOL_VERSION,
    input.homeId,
    input.targetHubId,
    input.ticketId,
    input.clientEphemeralKeyHash,
    input.serverEphemeralKeyHash,
    input.clientNonce,
    input.serverNonce,
    input.salt,
    input.issuedAt,
    input.expiresAt,
  ]);
}

export type TerminalKeyLabel = 'auth' | 'c2s-key' | 's2c-key' | 'c2s-iv' | 's2c-iv';

export function terminalKeyDerivationInfo(params: {
  readonly homeId: string;
  readonly targetHubId: string;
  readonly ticketId: string;
  readonly transcriptHash: string;
  readonly label: TerminalKeyLabel;
}): string {
  return `haus.terminal.v1|${params.label}|${params.homeId}|${params.targetHubId}|${params.ticketId}|${params.transcriptHash}`;
}
