/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const HUB_DATA_DIRECTORY = 'HUB_DATA_DIRECTORY';

const KEY_LENGTH_BYTES = 32;
const KEY_FILENAME = 'secrets.key';
const cachedDirectoryKeys = new Map<string, Buffer>();
let cachedProcessEphemeralKey: Buffer | undefined;

function parseKeyFile(raw: Buffer): Buffer | undefined {
  if (raw.length === KEY_LENGTH_BYTES) return Buffer.from(raw);
  const text = raw.toString('utf8').trim();
  if (/^[a-f0-9]{64}$/i.test(text)) {
    return Buffer.from(text, 'hex');
  }
  return undefined;
}

function readOrCreateDirectoryKey(dataDir: string): Buffer | undefined {
  const normalized = resolve(dataDir);
  const cached = cachedDirectoryKeys.get(normalized);
  if (cached) return Buffer.from(cached);

  const keyPath = join(normalized, KEY_FILENAME);
  try {
    const existing = parseKeyFile(readFileSync(keyPath));
    if (existing) {
      cachedDirectoryKeys.set(normalized, existing);
      return Buffer.from(existing);
    }
  } catch {
    // Key file not created yet; provision below.
  }

  try {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    const generated = randomBytes(KEY_LENGTH_BYTES);
    const fd = openSync(keyPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeFileSync(fd, generated);
    } finally {
      closeSync(fd);
    }
    cachedDirectoryKeys.set(normalized, generated);
    return Buffer.from(generated);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST') {
      try {
        const existing = parseKeyFile(readFileSync(keyPath));
        if (existing) {
          cachedDirectoryKeys.set(normalized, existing);
          return Buffer.from(existing);
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * Resolves a 32-byte AES-256 master key for local secret encryption.
 * Priority: explicit test/config secret -> HAUS_CREDENTIAL_KEY env -> 0o600 CSPRNG secrets.key in dataDir -> ephemeral CSPRNG key.
 * Never falls back to a hardcoded static key.
 */
export function resolveOrProvisionMasterKey(options?: {
  readonly dataDir?: string;
  readonly secret?: string;
}): Buffer {
  const explicitSecret = options?.secret?.trim() || process.env.HAUS_CREDENTIAL_KEY?.trim();
  if (explicitSecret) {
    return scryptSync(explicitSecret, 'haus-network-credential-v1', KEY_LENGTH_BYTES);
  }

  const candidateDir =
    options?.dataDir?.trim() || process.env.HAUS_DATA_DIR?.trim() || process.env.HAUS_DATA?.trim();
  if (candidateDir) {
    const dirKey = readOrCreateDirectoryKey(candidateDir);
    if (dirKey) return dirKey;
    const ephemeralForDir = randomBytes(KEY_LENGTH_BYTES);
    cachedDirectoryKeys.set(resolve(candidateDir), ephemeralForDir);
    return Buffer.from(ephemeralForDir);
  }

  cachedProcessEphemeralKey ??= randomBytes(KEY_LENGTH_BYTES);
  return Buffer.from(cachedProcessEphemeralKey);
}

/** Seals sensitive secret material (e.g. per-peer channel secret) under the local Hub master key with AAD. */
export function sealLocalSecret(masterKey: Uint8Array, aad: string, plaintext: Uint8Array): string {
  if (masterKey.byteLength !== KEY_LENGTH_BYTES) throw Error('invalid_master_key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/** Opens secret material sealed by sealLocalSecret, rejecting any AAD mismatch or tag tampering. */
export function openLocalSecret(masterKey: Uint8Array, aad: string, token: string): Buffer {
  if (masterKey.byteLength !== KEY_LENGTH_BYTES) throw Error('invalid_master_key');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v2') throw Error('invalid_local_secret_envelope');
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const ciphertext = Buffer.from(parts[3]!, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw Error('invalid_local_secret_envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
