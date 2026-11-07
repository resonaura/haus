/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { LockRow } from '../entities/types.js';
import type { VaultRow } from './types.js';

export const VaultLock = new EntitySchema<LockRow>({
  name: 'HausVaultLock',
  tableName: 'haus_vault_lock',
  columns: {
    id: { type: 'integer', primary: true },
    version: { type: 'integer' },
  },
});

export const VaultEntity = new EntitySchema<VaultRow>({
  name: 'HausVaultCredential',
  tableName: 'haus_vault_credentials',
  columns: {
    home: { type: 'text', primary: true },
    integration: { type: 'text', primary: true },
    hub: { type: 'text' },
    process: { type: 'text' },
    generation: { type: 'integer' },
    state: { type: 'text' },
    attempt: { type: 'text', nullable: true, name: 'attempt_id' },
    iv: { type: 'blob' },
    ciphertext: { type: 'blob' },
    tag: { type: 'blob' },
  },
});
