/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomInt } from 'node:crypto';

const NONCE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
const SIGN_HEADERS = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token'] as const;

/** Generates an alphanumeric nonce matching tuya-device-sharing-sdk expectations. */
export function randomTuyaNonce(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += NONCE_ALPHABET[randomInt(0, NONCE_ALPHABET.length)];
  }
  return out;
}

/** Computes `md5(rid + refreshToken)` hex digest used to derive request signing and AES keys. */
export function computeTuyaHashKey(rid: string, refreshToken: string): string {
  return createHash('md5').update(`${rid}${refreshToken}`, 'utf8').digest('hex');
}

/** Derives the 16-byte ASCII AES-128-GCM secret from requestId, sessionId, and hashKey. */
export function generateTuyaAesSecret(rid: string, sid: string, hashKey: string): string {
  let message = hashKey;
  if (sid.length > 0) {
    const mod = 16;
    const len = Math.min(sid.length, mod);
    let ecode = '';
    for (let i = 0; i < len; i += 1) {
      ecode += sid[sid.charCodeAt(i) % mod] ?? '';
    }
    message += `_${ecode}`;
  }
  return createHmac('sha256', Buffer.from(rid, 'utf8'))
    .update(message, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/** Encrypts JSON payloads with AES-128-GCM in `base64(nonce12) + base64(ciphertext + tag)` format. */
export function tuyaAesGcmEncrypt(plaintext: string, secret: string, fixedNonce?: string): string {
  const nonceStr = fixedNonce ?? randomTuyaNonce(12);
  if (Buffer.byteLength(nonceStr, 'utf8') !== 12) {
    throw new Error('tuya_invalid_nonce_length');
  }
  const nonce = Buffer.from(nonceStr, 'utf8');
  const key = Buffer.from(secret, 'utf8');
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return nonce.toString('base64') + payload.toString('base64');
}

/** Decrypts a Tuya AES-128-GCM `result` payload using the 16-char ASCII secret. */
export function tuyaAesGcmDecrypt(cipherData: string, secret: string): string {
  const raw = Buffer.from(cipherData, 'base64');
  if (raw.length < 28) {
    throw new Error('tuya_invalid_ciphertext');
  }
  const nonce = raw.subarray(0, 12);
  const authTag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(secret, 'utf8'), nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Signs canonical Tuya headers plus encrypted query/body strings with HMAC-SHA256. */
export function signTuyaRequest(
  hashKey: string,
  queryEncdata: string,
  bodyEncdata: string,
  headers: Readonly<Record<string, string>>,
): string {
  const parts: string[] = [];
  for (const key of SIGN_HEADERS) {
    const val = headers[key];
    if (val) parts.push(`${key}=${val}`);
  }
  let signStr = parts.join('||');
  if (queryEncdata) signStr += queryEncdata;
  if (bodyEncdata) signStr += bodyEncdata;
  return createHmac('sha256', Buffer.from(hashKey, 'utf8')).update(signStr, 'utf8').digest('hex');
}
