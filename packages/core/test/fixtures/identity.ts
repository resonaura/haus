/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { identityKey } from '../../src/identity/registry.js';
import type {
  IdentityRef,
  IdentityRepository,
  IdentityTransaction,
} from '../../src/identity/types.js';

/** Copy-on-write fixture for the host's atomic persistence contract. */
export class IdentityDatabase implements IdentityRepository {
  private bindings = new Map<string, string>();
  private owners = new Map<string, IdentityRef>();

  transaction<T>(operation: (transaction: IdentityTransaction) => T): T {
    const bindings = new Map(this.bindings),
      owners = new Map(this.owners);
    const result = operation({
      get: (reference) => bindings.get(identityKey(reference)),
      owner: (id) => owners.get(id),
      bind(reference, id) {
        bindings.set(identityKey(reference), id);
        if (!owners.has(id)) owners.set(id, structuredClone(reference));
      },
    });
    this.bindings = bindings;
    this.owners = owners;
    return result;
  }
}
