/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const hapPkgDir = dirname(require.resolve('@homebridge/hap-nodejs/package.json'));

export interface HapTlvModule {
  encode(
    type: number,
    data: Buffer | number | string,
    ...rest: Array<number | Buffer | string>
  ): Buffer;
  decode(buffer: Buffer): Record<number, Buffer>;
}

export interface HapEncryptionState {
  accessoryToControllerKey: Buffer;
  controllerToAccessoryKey: Buffer;
  accessoryToControllerCount: number;
  controllerToAccessoryCount: number;
  incompleteFrame?: Buffer;
}

export interface HapCryptoModule {
  generateCurve25519KeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  generateCurve25519SharedSecKey(priKey: Uint8Array, pubKey: Uint8Array): Uint8Array;
  generateEd25519KeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  ed25519Sign(message: Uint8Array, secretKey: Uint8Array): Buffer;
  ed25519Verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  HKDF(hashAlg: string, salt: Buffer, ikm: Buffer, info: Buffer, size: number): Buffer;
  chacha20_poly1305_encryptAndSeal(
    key: Buffer,
    nonce: Buffer,
    aad: Buffer | null,
    plaintext: Buffer,
  ): { ciphertext: Buffer; authTag: Buffer };
  chacha20_poly1305_decryptAndVerify(
    key: Buffer,
    nonce: Buffer,
    aad: Buffer | null,
    ciphertext: Buffer,
    authTag: Buffer,
  ): Buffer;
  layerEncrypt(data: Buffer, encryption: HapEncryptionState): Buffer;
  layerDecrypt(packet: Buffer, encryption: HapEncryptionState): Buffer;
}

export interface FastSrpClient {
  computeA(): Buffer;
  setB(B: Buffer): void;
  computeM1(): Buffer;
  checkM2(M2: Buffer): void;
  computeK(): Buffer;
}

export interface FastSrpModule {
  SRP: {
    params: { hap: object };
    genKey(bytes?: number): Promise<Buffer>;
  };
  SrpClient: new (
    params: object,
    salt: Buffer,
    identity: Buffer,
    password: Buffer,
    secret1: Buffer,
    hap?: boolean,
  ) => FastSrpClient;
}

export interface BonjourService {
  name: string;
  host: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, string>;
}

export interface BonjourBrowser {
  on(event: 'up' | 'down', listener: (service: BonjourService) => void): this;
  start(): void;
  stop(): void;
}

export interface BonjourInstance {
  find(options: { type: string }, onUp?: (service: BonjourService) => void): BonjourBrowser;
  destroy(): void;
}

export const hapTlv = require(join(hapPkgDir, 'dist/lib/util/tlv.js')) as HapTlvModule;
export const hapCrypto = require(join(hapPkgDir, 'dist/lib/util/hapCrypto.js')) as HapCryptoModule;
export const fastSrp = require(
  require.resolve('fast-srp-hap', { paths: [hapPkgDir] }),
) as FastSrpModule;
export const createBonjour = require(
  require.resolve('bonjour-hap', { paths: [hapPkgDir] }),
) as () => BonjourInstance;

export const enum HapTlvTag {
  Method = 0x00,
  Identifier = 0x01,
  Salt = 0x02,
  PublicKey = 0x03,
  Proof = 0x04,
  EncryptedData = 0x05,
  State = 0x06,
  Error = 0x07,
  Permissions = 0x0b,
  Signature = 0x0a,
  Flags = 0x13,
}
