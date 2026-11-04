/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IdentityKind } from '@haus/core/identity';

export interface IdentityRow {
  id: string;
  home: string;
  kind: IdentityKind;
  source: string;
  external: string;
}
export interface AliasRow extends Omit<IdentityRow, 'id'> {
  identityId: string;
}
export interface AddressRow {
  home: string;
  address: string;
  identityId: string;
}
export interface LockRow {
  id: number;
  version: number;
}
