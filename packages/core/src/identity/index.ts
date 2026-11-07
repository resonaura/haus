/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export { IdentityRegistry, identityKey } from './registry.js';
export { Addresses, parseAddress, formatAddress } from './address.js';
export type { Address, AddressRepository, AddressTransaction } from './address.js';
export * from './domains.js';
export * from './rewrites.js';
export * from './room-move.js';
export type {
  IdentityKind,
  IdentityRef,
  IdentityRepository,
  IdentityTransaction,
  ResourceRef,
} from './types.js';
