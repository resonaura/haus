/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { IdentityRow, AliasRow } from './types.js';

export const IdentityEntity = new EntitySchema<IdentityRow>({
  name: 'HausIdentity',
  tableName: 'haus-identity-ids',
  columns: {
    id: { type: 'text', primary: true },
    home: { type: 'text' },
    kind: { type: 'text' },
    source: { type: 'text' },
    external: { type: 'text' },
  },
});

export const AliasEntity = new EntitySchema<AliasRow>({
  name: 'HausIdentityAlias',
  tableName: 'haus-identity-refs',
  columns: {
    home: { type: 'text', primary: true },
    kind: { type: 'text', primary: true },
    source: { type: 'text', primary: true },
    external: { type: 'text', primary: true },
    identityId: { type: 'text', name: 'identity-id' },
  },
});
