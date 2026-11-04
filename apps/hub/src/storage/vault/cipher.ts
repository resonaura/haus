/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { CredentialCodec, VaultMetadata, VaultPayload, VaultRow } from './types.js';

/** Authenticate the fencing and refresh state as well as the encrypted credential. */
function associated(metadata: VaultMetadata): Buffer {
  return Buffer.from(
    JSON.stringify([
      'haus.vault',
      1,
      metadata.home,
      metadata.integration,
      metadata.hub,
      metadata.process,
      metadata.generation,
      metadata.state,
      metadata.attempt,
    ]),
  );
}

export class VaultCipher<Credential> {
  private readonly key: KeyObject;
  constructor(
    key: Uint8Array,
    private readonly codec: CredentialCodec<Credential>,
  ) {
    if (key.byteLength !== 32) throw Error('invalid_vault_key');
    this.key = createSecretKey(key);
  }

  seal(metadata: VaultMetadata, credential: Credential): VaultPayload {
    let plaintext: Buffer | undefined;
    try {
      plaintext = Buffer.from(this.codec.encode(credential));
      if (!plaintext.length || plaintext.length > 1024 * 1024)
        throw Error('invalid_credential_size');
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
      cipher.setAAD(associated(metadata));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { iv, ciphertext, tag: cipher.getAuthTag() };
    } catch {
      throw Error('vault_credentials_unavailable');
    } finally {
      plaintext?.fill(0);
    }
  }

  open(row: VaultRow): Credential {
    let plaintext: Buffer | undefined;
    try {
      if (
        !Buffer.isBuffer(row.iv) ||
        row.iv.length !== 12 ||
        !Buffer.isBuffer(row.tag) ||
        row.tag.length !== 16 ||
        !Buffer.isBuffer(row.ciphertext) ||
        !row.ciphertext.length ||
        row.ciphertext.length > 1024 * 1024
      )
        throw Error('invalid_ciphertext');
      const decipher = createDecipheriv('aes-256-gcm', this.key, row.iv, { authTagLength: 16 });
      decipher.setAAD(associated(row));
      decipher.setAuthTag(row.tag);
      plaintext = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
      return this.codec.decode(plaintext);
    } catch {
      throw Error('vault_credentials_unavailable');
    } finally {
      plaintext?.fill(0);
    }
  }
}
