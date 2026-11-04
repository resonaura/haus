/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { EntityManager } from 'typeorm';
import { parseAddress } from '@haus/core/identity';
import type { AddressRepository, AddressTransaction } from '@haus/core/identity';
import type { Transactions } from './transactions.js';
import { AddressEntity, PrimaryEntity } from './entities/address.js';
import { IdentityEntity } from './entities/identity.js';

export class OrmAddresses implements AddressRepository {
  constructor(private readonly transactions: Transactions) {}

  transaction<T>(operation: (transaction: AddressTransaction) => Promise<T>): Promise<T> {
    return this.transactions.run((manager) =>
      operation({
        resolve: (home, address) => this.resolve(manager, home, address),
        current: async (home, identityId) =>
          (await manager.findOneBy(PrimaryEntity, { home, identityId }))?.address,
        reserve: (home, address, id) => this.reserve(manager, home, address, id),
        select: async (home, identityId, address) => {
          if ((await this.resolve(manager, home, address)) !== identityId)
            throw Error('identity_address_not_reserved');
          await manager.upsert(PrimaryEntity, { home, identityId, address }, [
            'home',
            'identityId',
          ]);
        },
      }),
    );
  }

  private async resolve(
    manager: EntityManager,
    home: string,
    address: string,
  ): Promise<string | undefined> {
    return (await manager.findOneBy(AddressEntity, { home, address }))?.identityId;
  }

  private async reserve(
    manager: EntityManager,
    home: string,
    address: string,
    identityId: string,
  ): Promise<void> {
    if (!parseAddress(address)) throw Error('invalid_identity_address');
    const owner = await manager.findOneBy(IdentityEntity, { id: identityId });
    if (owner?.home !== home) throw Error('identity_address_owner_mismatch');
    const previous = await this.resolve(manager, home, address);
    if (previous !== undefined && previous !== identityId) throw Error('identity_address_conflict');
    if (previous === undefined) await manager.insert(AddressEntity, { home, address, identityId });
  }
}
