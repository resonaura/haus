/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface ClusterPublicIdentity {
  readonly hubId: string;
  readonly signingPublicKey: string;
  readonly exchangePublicKey: string;
  readonly keyFingerprint: string;
}

interface PersistedIdentityFile {
  readonly version: 1;
  readonly hubId: string;
  readonly signingPublicKey: string;
  readonly signingPrivateKey: string;
  readonly exchangePublicKey: string;
  readonly exchangePrivateKey: string;
}

const IDENTITY_FILENAME = 'cluster-identity.json';

function computeKeyFingerprint(signingPublicKey: string, exchangePublicKey: string): string {
  return createHash('sha256')
    .update(signingPublicKey)
    .update('\n')
    .update(exchangePublicKey)
    .digest('hex');
}

function generateKeyMaterial(hubId: string): PersistedIdentityFile {
  const ed = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const x25519 = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    version: 1,
    hubId,
    signingPublicKey: ed.publicKey,
    signingPrivateKey: ed.privateKey,
    exchangePublicKey: x25519.publicKey,
    exchangePrivateKey: x25519.privateKey,
  };
}

function isValidPersistedIdentity(
  value: unknown,
  expectedHubId: string,
): value is PersistedIdentityFile {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.version === 1 &&
    obj.hubId === expectedHubId &&
    typeof obj.signingPublicKey === 'string' &&
    typeof obj.signingPrivateKey === 'string' &&
    typeof obj.exchangePublicKey === 'string' &&
    typeof obj.exchangePrivateKey === 'string'
  );
}

/**
 * Per-Hub cryptographic identity combining Ed25519 authentication/fencing signatures
 * and X25519 key agreement for forward-secret E2EE credential/config/cache envelopes.
 */
export class ClusterCryptoIdentity {
  readonly hubId: string;
  readonly signingPublicKey: string;
  readonly exchangePublicKey: string;
  readonly keyFingerprint: string;
  private readonly signingPrivateKeyObj: KeyObject;
  private readonly exchangePrivateKeyObj: KeyObject;

  private constructor(material: PersistedIdentityFile) {
    this.hubId = material.hubId;
    this.signingPublicKey = material.signingPublicKey;
    this.exchangePublicKey = material.exchangePublicKey;
    this.keyFingerprint = computeKeyFingerprint(
      material.signingPublicKey,
      material.exchangePublicKey,
    );
    this.signingPrivateKeyObj = createPrivateKey(material.signingPrivateKey);
    this.exchangePrivateKeyObj = createPrivateKey(material.exchangePrivateKey);
  }

  static loadOrCreate(hubId: string, dataDir?: string): ClusterCryptoIdentity {
    if (dataDir?.trim()) {
      const normalized = resolve(dataDir.trim());
      const filePath = join(normalized, IDENTITY_FILENAME);
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
        if (isValidPersistedIdentity(parsed, hubId)) {
          return new ClusterCryptoIdentity(parsed);
        }
      } catch {
        // Not created yet or mismatched hubId; attempt fresh creation below.
      }

      const generated = generateKeyMaterial(hubId);
      try {
        mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
        const fd = openSync(
          filePath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o600,
        );
        try {
          writeFileSync(fd, JSON.stringify(generated), 'utf8');
        } finally {
          closeSync(fd);
        }
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'EEXIST') {
          try {
            const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
            if (isValidPersistedIdentity(parsed, hubId)) {
              return new ClusterCryptoIdentity(parsed);
            }
          } catch {
            // Fall through to generated instance.
          }
        }
      }
      return new ClusterCryptoIdentity(generated);
    }

    return new ClusterCryptoIdentity(generateKeyMaterial(hubId));
  }

  publicIdentity(): ClusterPublicIdentity {
    return {
      hubId: this.hubId,
      signingPublicKey: this.signingPublicKey,
      exchangePublicKey: this.exchangePublicKey,
      keyFingerprint: this.keyFingerprint,
    };
  }

  getExchangePrivateKey(): KeyObject {
    return this.exchangePrivateKeyObj;
  }

  signPayload(payload: Uint8Array): string {
    return edSign(null, payload, this.signingPrivateKeyObj).toString('base64url');
  }

  static verifySignature(
    publicKeyPem: string,
    payload: Uint8Array,
    signatureBase64Url: string,
  ): boolean {
    try {
      const publicKey = createPublicKey(publicKeyPem);
      const signature = Buffer.from(signatureBase64Url, 'base64url');
      if (signature.length !== 64) return false;
      return edVerify(null, payload, publicKey, signature);
    } catch {
      return false;
    }
  }

  static validatePeerPublicIdentity(candidate: unknown): candidate is ClusterPublicIdentity {
    if (!candidate || typeof candidate !== 'object') return false;
    const obj = candidate as Record<string, unknown>;
    if (
      typeof obj.hubId !== 'string' ||
      !obj.hubId ||
      typeof obj.signingPublicKey !== 'string' ||
      typeof obj.exchangePublicKey !== 'string'
    ) {
      return false;
    }
    try {
      const signKey = createPublicKey(obj.signingPublicKey);
      const exchKey = createPublicKey(obj.exchangePublicKey);
      return signKey.asymmetricKeyType === 'ed25519' && exchKey.asymmetricKeyType === 'x25519';
    } catch {
      return false;
    }
  }
}
