/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import net from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  fastSrp,
  hapCrypto,
  hapTlv,
  HapTlvTag,
  type HapEncryptionState,
} from './crypto.js';
import type { HapCharacteristicValue } from '../types.js';
import type {
  RawHapAccessoriesResponse,
  RawHapAccessory,
  RawHapCharacteristic,
  RawHapService,
} from '../passthrough.js';

export interface HapPairingRecord {
  readonly accessoryId: string;
  readonly address: string;
  readonly port: number;
  readonly controllerId: string;
  readonly controllerLtsk: string; // hex (64 bytes)
  readonly controllerLtpk: string; // hex (32 bytes)
  readonly accessoryLtpk: string; // hex (32 bytes)
}

export type {
  RawHapAccessoriesResponse,
  RawHapAccessory,
  RawHapCharacteristic,
  RawHapService,
};

interface HttpMessage {
  readonly protocol: 'HTTP/1.1' | 'EVENT/1.0';
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

function parseHttpMessages(buffer: Buffer): { messages: HttpMessage[]; remainder: Buffer } {
  const messages: HttpMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n', offset, 'ascii');
    if (headerEnd === -1) break;

    const headerStr = buffer.subarray(offset, headerEnd).toString('ascii');
    const lines = headerStr.split('\r\n');
    const firstLine = lines[0] ?? '';
    const parts = firstLine.split(' ');
    const protocol = parts[0] === 'EVENT/1.0' ? 'EVENT/1.0' : 'HTTP/1.1';
    const statusCode = parseInt(parts[1] ?? '200', 10);

    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx > 0) {
        headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
      }
    }

    const bodyStart = headerEnd + 4;
    if (headers['transfer-encoding']?.toLowerCase() === 'chunked') {
      let chunkPos = bodyStart;
      const chunks: Buffer[] = [];
      let complete = false;
      while (chunkPos < buffer.length) {
        const lineEnd = buffer.indexOf('\r\n', chunkPos, 'ascii');
        if (lineEnd === -1) break;
        const sizeHex = buffer.subarray(chunkPos, lineEnd).toString('ascii').split(';')[0].trim();
        const chunkSize = parseInt(sizeHex, 16);
        if (Number.isNaN(chunkSize)) break;
        if (chunkSize === 0) {
          if (lineEnd + 4 <= buffer.length) {
            offset = lineEnd + 4;
            complete = true;
          }
          break;
        }
        const chunkDataStart = lineEnd + 2;
        const chunkDataEnd = chunkDataStart + chunkSize;
        if (chunkDataEnd + 2 > buffer.length) break;
        chunks.push(buffer.subarray(chunkDataStart, chunkDataEnd));
        chunkPos = chunkDataEnd + 2;
      }
      if (!complete) break;
      messages.push({ protocol, statusCode, headers, body: Buffer.concat(chunks) });
    } else {
      const contentLength = parseInt(headers['content-length'] ?? '0', 10);
      if (bodyStart + contentLength > buffer.length) break;
      const body = buffer.subarray(bodyStart, bodyStart + contentLength);
      offset = bodyStart + contentLength;
      messages.push({ protocol, statusCode, headers, body });
    }
  }

  return { messages, remainder: Buffer.from(buffer.subarray(offset)) };
}

async function rawHttpPostTlv(
  socket: net.Socket,
  host: string,
  port: number,
  path: string,
  tlvBody: Buffer,
): Promise<Record<number, Buffer>> {
  const req = Buffer.concat([
    Buffer.from(
      `POST ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Content-Type: application/pairing+tlv8\r\n` +
        `Content-Length: ${tlvBody.length}\r\n\r\n`,
      'ascii',
    ),
    tlvBody,
  ]);

  return new Promise<Record<number, Buffer>>((resolve, reject) => {
    let acc = Buffer.alloc(0);
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('hap_socket_closed_during_pairing'));
    };
    const onData = (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      const { messages } = parseHttpMessages(acc);
      if (messages.length > 0) {
        cleanup();
        const decoded = hapTlv.decode(messages[0].body);
        const errBuf = decoded[HapTlvTag.Error];
        if (errBuf && errBuf.length > 0) {
          reject(new Error(`hap_tlv_error_${errBuf[0]}`));
          return;
        }
        resolve(decoded);
      }
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.write(req);
  });
}

/**
 * Performs HAP Pair-Setup (M1 -> M6) using @homebridge/hap-nodejs's fast-srp-hap + hapCrypto.
 */
export async function performHapPairSetup(options: {
  accessoryId: string;
  address: string;
  port: number;
  pin: string;
  controllerId?: string;
}): Promise<HapPairingRecord> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.createConnection({ host: options.address, port: options.port }, () => resolve(s));
    s.once('error', reject);
  });

  try {
    // M1: SRP Start Request (Method 0 = Pair Setup, or fallback to Method 1 = Pair Setup with Auth)
    let m2: Record<number, Buffer>;
    try {
      const m1 = hapTlv.encode(HapTlvTag.State, 1, HapTlvTag.Method, 0);
      m2 = await rawHttpPostTlv(socket, options.address, options.port, '/pair-setup', m1);
    } catch {
      const m1Alt = hapTlv.encode(HapTlvTag.State, 1, HapTlvTag.Method, 1);
      m2 = await rawHttpPostTlv(socket, options.address, options.port, '/pair-setup', m1Alt);
    }

    const salt = m2[HapTlvTag.Salt];
    const serverB = m2[HapTlvTag.PublicKey];
    if (!salt || !serverB) {
      throw new Error('hap_pair_setup_missing_salt_or_public_key');
    }

    // M3: SRP Verify Request
    const secret1 = await fastSrp.SRP.genKey(32);
    const srp = new fastSrp.SrpClient(
      fastSrp.SRP.params.hap,
      salt,
      Buffer.from('Pair-Setup', 'utf8'),
      Buffer.from(options.pin, 'utf8'),
      secret1,
      true,
    );
    srp.setB(serverB);
    const clientA = srp.computeA();
    const clientM1 = srp.computeM1();

    const m3 = hapTlv.encode(
      HapTlvTag.State,
      3,
      HapTlvTag.PublicKey,
      clientA,
      HapTlvTag.Proof,
      clientM1,
    );
    const m4 = await rawHttpPostTlv(socket, options.address, options.port, '/pair-setup', m3);
    const serverM2 = m4[HapTlvTag.Proof];
    if (!serverM2) {
      throw new Error('hap_pair_setup_missing_server_proof');
    }
    srp.checkM2(serverM2);
    const sessionKey = srp.computeK();

    // M5: Exchange Request
    const controllerId = options.controllerId ?? randomUUID();
    const controllerIdBuf = Buffer.from(controllerId, 'utf8');
    const edKeys = hapCrypto.generateEd25519KeyPair();
    const controllerLtpk = Buffer.from(edKeys.publicKey);
    const controllerLtsk = Buffer.from(edKeys.secretKey);

    const iOSDeviceX = hapCrypto.HKDF(
      'sha512',
      Buffer.from('Pair-Setup-Controller-Sign-Salt', 'utf8'),
      sessionKey,
      Buffer.from('Pair-Setup-Controller-Sign-Info', 'utf8'),
      32,
    );
    const iOSDeviceInfo = Buffer.concat([iOSDeviceX, controllerIdBuf, controllerLtpk]);
    const signature = hapCrypto.ed25519Sign(iOSDeviceInfo, controllerLtsk);

    const subTlvM5 = hapTlv.encode(
      HapTlvTag.Identifier,
      controllerIdBuf,
      HapTlvTag.PublicKey,
      controllerLtpk,
      HapTlvTag.Signature,
      signature,
    );
    const encKey = hapCrypto.HKDF(
      'sha512',
      Buffer.from('Pair-Setup-Encrypt-Salt', 'utf8'),
      sessionKey,
      Buffer.from('Pair-Setup-Encrypt-Info', 'utf8'),
      32,
    );
    const sealedM5 = hapCrypto.chacha20_poly1305_encryptAndSeal(
      encKey,
      Buffer.from('PS-Msg05', 'utf8'),
      null,
      subTlvM5,
    );

    const m5 = hapTlv.encode(
      HapTlvTag.State,
      5,
      HapTlvTag.EncryptedData,
      Buffer.concat([sealedM5.ciphertext, sealedM5.authTag]),
    );
    const m6 = await rawHttpPostTlv(socket, options.address, options.port, '/pair-setup', m5);
    const encM6 = m6[HapTlvTag.EncryptedData];
    if (!encM6 || encM6.length < 16) {
      throw new Error('hap_pair_setup_missing_m6_encrypted_data');
    }

    const plainM6 = hapCrypto.chacha20_poly1305_decryptAndVerify(
      encKey,
      Buffer.from('PS-Msg06', 'utf8'),
      null,
      encM6.subarray(0, encM6.length - 16),
      encM6.subarray(encM6.length - 16),
    );
    const subM6 = hapTlv.decode(plainM6);
    const accIdBuf = subM6[HapTlvTag.Identifier];
    const accLtpk = subM6[HapTlvTag.PublicKey];
    const accSig = subM6[HapTlvTag.Signature];
    if (!accIdBuf || !accLtpk || !accSig) {
      throw new Error('hap_pair_setup_invalid_m6_subtlv');
    }

    const accessoryX = hapCrypto.HKDF(
      'sha512',
      Buffer.from('Pair-Setup-Accessory-Sign-Salt', 'utf8'),
      sessionKey,
      Buffer.from('Pair-Setup-Accessory-Sign-Info', 'utf8'),
      32,
    );
    const accessoryInfo = Buffer.concat([accessoryX, accIdBuf, accLtpk]);
    if (!hapCrypto.ed25519Verify(accessoryInfo, accSig, accLtpk)) {
      throw new Error('hap_pair_setup_accessory_signature_invalid');
    }

    return {
      accessoryId: options.accessoryId,
      address: options.address,
      port: options.port,
      controllerId,
      controllerLtsk: controllerLtsk.toString('hex'),
      controllerLtpk: controllerLtpk.toString('hex'),
      accessoryLtpk: accLtpk.toString('hex'),
    };
  } finally {
    socket.destroy();
  }
}

/**
 * Persistent encrypted HAP-IP session supporting Pair-Verify (M1 -> M4),
 * GET /accessories, GET /characteristics, PUT /characteristics, and live EVENT/1.0 notifications.
 */
export class HapEncryptedSession {
  private socket?: net.Socket;
  private encryption?: HapEncryptionState;
  private rxPlainBuffer: Buffer = Buffer.alloc(0);
  private pendingWaiters: Array<{
    resolve: (msg: HttpMessage) => void;
    reject: (err: Error) => void;
  }> = [];
  private readonly eventListeners = new Set<(events: readonly HapCharacteristicValue[]) => void>();

  constructor(private readonly pairing: HapPairingRecord) {}

  public onEvent(listener: (events: readonly HapCharacteristicValue[]) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed && this.encryption) return;

    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection(
        { host: this.pairing.address, port: this.pairing.port },
        () => resolve(s),
      );
      s.once('error', reject);
    });

    try {
      const curveKeys = hapCrypto.generateCurve25519KeyPair();
      const clientPublic = Buffer.from(curveKeys.publicKey);
      const clientPrivate = Buffer.from(curveKeys.secretKey);

      // Pair-Verify M1
      const m1 = hapTlv.encode(HapTlvTag.State, 1, HapTlvTag.PublicKey, clientPublic);
      const m2 = await rawHttpPostTlv(
        socket,
        this.pairing.address,
        this.pairing.port,
        '/pair-verify',
        m1,
      );
      const serverPublic = m2[HapTlvTag.PublicKey];
      const encM2 = m2[HapTlvTag.EncryptedData];
      if (!serverPublic || !encM2 || encM2.length < 16) {
        throw new Error('hap_pair_verify_invalid_m2');
      }

      const sharedSecret = Buffer.from(
        hapCrypto.generateCurve25519SharedSecKey(clientPrivate, serverPublic),
      );
      const sessionKey = hapCrypto.HKDF(
        'sha512',
        Buffer.from('Pair-Verify-Encrypt-Salt', 'utf8'),
        sharedSecret,
        Buffer.from('Pair-Verify-Encrypt-Info', 'utf8'),
        32,
      );

      const plainM2 = hapCrypto.chacha20_poly1305_decryptAndVerify(
        sessionKey,
        Buffer.from('PV-Msg02', 'utf8'),
        null,
        encM2.subarray(0, encM2.length - 16),
        encM2.subarray(encM2.length - 16),
      );
      const subM2 = hapTlv.decode(plainM2);
      const accIdBuf = subM2[HapTlvTag.Identifier];
      const accSig = subM2[HapTlvTag.Signature];
      if (!accIdBuf || !accSig) {
        throw new Error('hap_pair_verify_invalid_m2_subtlv');
      }

      const accessoryInfo = Buffer.concat([serverPublic, accIdBuf, clientPublic]);
      const accLtpk = Buffer.from(this.pairing.accessoryLtpk, 'hex');
      if (!hapCrypto.ed25519Verify(accessoryInfo, accSig, accLtpk)) {
        throw new Error('hap_pair_verify_accessory_signature_invalid');
      }

      // Pair-Verify M3
      const controllerIdBuf = Buffer.from(this.pairing.controllerId, 'utf8');
      const controllerLtsk = Buffer.from(this.pairing.controllerLtsk, 'hex');
      const iOSDeviceInfo = Buffer.concat([clientPublic, controllerIdBuf, serverPublic]);
      const clientSig = hapCrypto.ed25519Sign(iOSDeviceInfo, controllerLtsk);

      const subTlvM3 = hapTlv.encode(
        HapTlvTag.Identifier,
        controllerIdBuf,
        HapTlvTag.Signature,
        clientSig,
      );
      const sealedM3 = hapCrypto.chacha20_poly1305_encryptAndSeal(
        sessionKey,
        Buffer.from('PV-Msg03', 'utf8'),
        null,
        subTlvM3,
      );
      const m3 = hapTlv.encode(
        HapTlvTag.State,
        3,
        HapTlvTag.EncryptedData,
        Buffer.concat([sealedM3.ciphertext, sealedM3.authTag]),
      );
      await rawHttpPostTlv(socket, this.pairing.address, this.pairing.port, '/pair-verify', m3);

      // Derive transport encryption keys
      const accessoryToControllerKey = hapCrypto.HKDF(
        'sha512',
        Buffer.from('Control-Salt', 'utf8'),
        sharedSecret,
        Buffer.from('Control-Read-Encryption-Key', 'utf8'),
        32,
      );
      const controllerToAccessoryKey = hapCrypto.HKDF(
        'sha512',
        Buffer.from('Control-Salt', 'utf8'),
        sharedSecret,
        Buffer.from('Control-Write-Encryption-Key', 'utf8'),
        32,
      );

      // Note: hapCrypto.layerEncrypt uses `accessoryToControllerKey` and `layerDecrypt` uses `controllerToAccessoryKey`
      this.encryption = {
        accessoryToControllerKey: controllerToAccessoryKey,
        controllerToAccessoryKey: accessoryToControllerKey,
        accessoryToControllerCount: 0,
        controllerToAccessoryCount: 0,
      };
      this.socket = socket;

      socket.on('data', (chunk: Buffer) => this.handleEncryptedData(chunk));
      socket.on('close', () => this.handleDisconnect(new Error('hap_session_closed')));
      socket.on('error', (err) => this.handleDisconnect(err));
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  public close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
    this.encryption = undefined;
    this.rxPlainBuffer = Buffer.alloc(0);
  }

  private handleEncryptedData(chunk: Buffer): void {
    if (!this.encryption) return;
    try {
      const decrypted = hapCrypto.layerDecrypt(chunk, this.encryption);
      if (decrypted.length === 0) return;
      this.rxPlainBuffer = Buffer.concat([this.rxPlainBuffer, decrypted]);

      const { messages, remainder } = parseHttpMessages(this.rxPlainBuffer);
      this.rxPlainBuffer = remainder;

      for (const msg of messages) {
        if (msg.protocol === 'EVENT/1.0') {
          try {
            const parsed = JSON.parse(msg.body.toString('utf8')) as {
              characteristics?: readonly HapCharacteristicValue[];
            };
            if (Array.isArray(parsed.characteristics)) {
              for (const listener of this.eventListeners) {
                listener(parsed.characteristics);
              }
            }
          } catch {
            // ignore malformed event JSON
          }
        } else {
          const waiter = this.pendingWaiters.shift();
          if (waiter) waiter.resolve(msg);
        }
      }
    } catch (err) {
      this.handleDisconnect(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleDisconnect(err: Error): void {
    this.close();
    while (this.pendingWaiters.length > 0) {
      this.pendingWaiters.shift()?.reject(err);
    }
  }

  private async request(method: string, path: string, bodyObj?: unknown): Promise<HttpMessage> {
    await this.connect();
    if (!this.socket || !this.encryption) {
      throw new Error('hap_session_not_connected');
    }

    const bodyBuf = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : Buffer.alloc(0);
    const headers =
      `${method} ${path} HTTP/1.1\r\n` +
      `Host: ${this.pairing.address}:${this.pairing.port}\r\n` +
      (bodyBuf.length > 0
        ? `Content-Type: application/hap+json\r\nContent-Length: ${bodyBuf.length}\r\n`
        : '') +
      `\r\n`;
    const plainReq = Buffer.concat([Buffer.from(headers, 'ascii'), bodyBuf]);
    const encryptedReq = hapCrypto.layerEncrypt(plainReq, this.encryption);

    return new Promise<HttpMessage>((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject });
      this.socket!.write(encryptedReq);
    });
  }

  public async getAccessories(): Promise<RawHapAccessoriesResponse> {
    const res = await this.request('GET', '/accessories');
    return JSON.parse(res.body.toString('utf8')) as RawHapAccessoriesResponse;
  }

  public async getCharacteristics(ids: readonly string[]): Promise<{
    characteristics: readonly HapCharacteristicValue[];
  }> {
    const res = await this.request('GET', `/characteristics?id=${ids.join(',')}`);
    if (res.body.length === 0) return { characteristics: [] };
    return JSON.parse(res.body.toString('utf8')) as {
      characteristics: readonly HapCharacteristicValue[];
    };
  }

  public async putCharacteristics(
    characteristics: ReadonlyArray<{
      readonly aid: number;
      readonly iid: number;
      readonly value?: unknown;
      readonly ev?: boolean;
    }>,
  ): Promise<{ characteristics: readonly HapCharacteristicValue[] }> {
    const res = await this.request('PUT', '/characteristics', { characteristics });
    if (res.statusCode === 204 || res.body.length === 0) {
      return {
        characteristics: characteristics.map((c) => ({ aid: c.aid, iid: c.iid, status: 0 })),
      };
    }
    return JSON.parse(res.body.toString('utf8')) as {
      characteristics: readonly HapCharacteristicValue[];
    };
  }
}
