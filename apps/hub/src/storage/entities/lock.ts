/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { LockRow } from './types.js';

export const LockEntity = new EntitySchema<LockRow>({
  name: 'HausPlatformLock',
  tableName: 'haus-platform-lock',
  columns: { id: { type: 'integer', primary: true }, version: { type: 'integer' } },
});
