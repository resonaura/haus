/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { StandaloneHomePersistence } from '../../home/home.persistence.js';
import type { AesGcmCredentialCipher } from '../credentials.service.js';
import type { TuyaStoredCredentials } from './types.js';

export interface EncryptedCredentialsEnvelope {
  readonly encrypted: string;
}

export async function saveTuyaCredentials(
  persistence: StandaloneHomePersistence,
  cipher: AesGcmCredentialCipher,
  entryId: string,
  credentials: TuyaStoredCredentials,
): Promise<void> {
  const encrypted = await cipher.encrypt(Buffer.from(JSON.stringify(credentials), 'utf8'));
  await persistence.save('tuya_credentials', entryId, { encrypted });
}

export async function loadTuyaCredentials(
  persistence: StandaloneHomePersistence,
  cipher: AesGcmCredentialCipher,
  entryId: string,
): Promise<TuyaStoredCredentials | undefined> {
  const rows = await persistence.listByKind<EncryptedCredentialsEnvelope>('tuya_credentials');
  const row = rows.find((item) => item.entryId === entryId);
  if (!row?.value?.encrypted) return undefined;
  return decryptTuyaCredentials(cipher, row.value.encrypted);
}

export async function decryptTuyaCredentials(
  cipher: AesGcmCredentialCipher,
  encrypted: string,
): Promise<TuyaStoredCredentials> {
  const raw = await cipher.decrypt(encrypted);
  return JSON.parse(Buffer.from(raw).toString('utf8')) as TuyaStoredCredentials;
}
