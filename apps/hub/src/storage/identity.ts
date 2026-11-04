/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { EntityManager } from 'typeorm';
import { identityKey } from '@haus/core/identity';
import type { IdentityRef, IdentityRepository, IdentityTransaction } from '@haus/core/identity';
import type { Transactions } from './transactions.js';
import { IdentityEntity, AliasEntity } from './entities/identity.js';

const fields = (reference: IdentityRef) => ({
  home: reference.homeId,
  kind: reference.kind,
  source: reference.source.instanceId,
  external: reference.source.externalId,
});

export class OrmIdentities implements IdentityRepository {
  constructor(private readonly transactions: Transactions) {}

  transaction<T>(operation: (transaction: IdentityTransaction) => Promise<T>): Promise<T> {
    return this.transactions.run((manager) =>
      operation({
        get: (reference) => this.get(manager, reference),
        owner: async (id) => {
          const row = await manager.findOneBy(IdentityEntity, { id });
          return row
            ? {
                homeId: row.home,
                kind: row.kind,
                source: { instanceId: row.source, externalId: row.external },
              }
            : undefined;
        },
        bind: (reference, id) => this.bind(manager, reference, id),
      }),
    );
  }

  private async get(manager: EntityManager, reference: IdentityRef): Promise<string | undefined> {
    identityKey(reference);
    return (await manager.findOneBy(AliasEntity, fields(reference)))?.identityId;
  }

  private async bind(manager: EntityManager, reference: IdentityRef, id: string): Promise<void> {
    identityKey(reference);
    if (!id.trim()) throw Error('invalid_canonical_identity');
    const previous = await this.get(manager, reference),
      owner = await manager.findOneBy(IdentityEntity, { id });
    if (previous !== undefined && previous !== id) throw Error('identity_import_conflict');
    if (owner && (owner.home !== reference.homeId || owner.kind !== reference.kind))
      throw Error('identity_owner_scope_mismatch');
    if (!owner) await manager.insert(IdentityEntity, { id, ...fields(reference) });
    if (previous === undefined)
      await manager.insert(AliasEntity, { ...fields(reference), identityId: id });
  }
}
