/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { AddressRow } from './types.js';

export const AddressEntity = new EntitySchema<AddressRow>({
  name: 'HausAddress',
  tableName: 'haus_addresses',
  columns: {
    home: { type: 'text', primary: true },
    address: { type: 'text', primary: true },
    identityId: { type: 'text', name: 'identity_id' },
  },
});

export const PrimaryEntity = new EntitySchema<AddressRow>({
  name: 'HausPrimaryAddress',
  tableName: 'haus_primary_addresses',
  columns: {
    home: { type: 'text', primary: true },
    identityId: { type: 'text', primary: true, name: 'identity_id' },
    address: { type: 'text' },
  },
});
