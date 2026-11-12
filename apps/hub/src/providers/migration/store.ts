/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { EntityManager } from 'typeorm';
import type { Transactions } from '../../storage/transactions.js';
import { StandaloneHomeEntryEntity } from '../../storage/standalone/entities.js';
import { IdentityEntity, AliasEntity } from '../../storage/entities/identity.js';
import { AddressEntity, PrimaryEntity } from '../../storage/entities/address.js';
import { CameraIdentityEntity, CameraSourceEntity } from '../../storage/cameras/entities.js';
import { planCameraMigration, snapshotHash } from './plan.js';
import type {
  CameraMigrationEvidence,
  CameraMigrationPlan,
  CameraMigrationSnapshot,
  Mutation,
} from './types.js';

async function snapshot(manager: EntityManager): Promise<CameraMigrationSnapshot> {
  return {
    home: await manager.find(StandaloneHomeEntryEntity),
    identities: await manager.find(IdentityEntity),
    aliases: await manager.find(AliasEntity),
    native: await manager.find(CameraIdentityEntity),
    sources: await manager.find(CameraSourceEntity),
    addresses: await manager.find(AddressEntity),
    primary: await manager.find(PrimaryEntity),
  };
}

/** The composition/operator must hold the Hub stopped; no second in-memory registry may keep writing. */
export class CameraIdentityMigration {
  constructor(private readonly transactions: Transactions) {}

  plan(evidence: CameraMigrationEvidence, now = Date.now()): Promise<CameraMigrationPlan> {
    return this.transactions.read(async (manager) =>
      planCameraMigration(await snapshot(manager), evidence, now),
    );
  }

  apply(plan: CameraMigrationPlan): Promise<'applied' | 'already-applied'> {
    return this.change(plan, false);
  }

  rollback(plan: CameraMigrationPlan): Promise<'applied' | 'already-applied'> {
    return this.change(plan, true);
  }

  private change(
    plan: CameraMigrationPlan,
    reverse: boolean,
  ): Promise<'applied' | 'already-applied'> {
    return this.transactions.run(async (manager) => {
      const expected = reverse ? plan.afterHash : plan.beforeHash;
      const result = reverse ? plan.beforeHash : plan.afterHash;
      const current = snapshotHash(await snapshot(manager));
      if (current === result) return 'already-applied';
      if (current !== expected) throw Error('camera_migration_catalog_changed');
      const rows = <T>(values: readonly Mutation<T>[]) =>
        values.map((value) => (reverse ? { before: value.after, after: value.before } : value));
      for (const { after } of rows(plan.changes.identities)) {
        if (after) await manager.save(IdentityEntity, after);
      }
      for (const { before, after } of rows(plan.changes.aliases)) {
        if (after) await manager.save(AliasEntity, after);
        else if (before)
          await manager.delete(AliasEntity, {
            home: before.home,
            kind: before.kind,
            source: before.source,
            external: before.external,
          });
      }
      for (const { before, after } of rows(plan.changes.native)) {
        if (after) await manager.save(CameraIdentityEntity, after);
        else if (before)
          await manager.delete(CameraIdentityEntity, {
            bridgeId: before.bridgeId,
            physicalId: before.physicalId,
          });
      }
      for (const { before, after } of rows(plan.changes.home)) {
        if (after) await manager.save(StandaloneHomeEntryEntity, after);
        else if (before)
          await manager.delete(StandaloneHomeEntryEntity, {
            kind: before.kind,
            entryId: before.entryId,
          });
      }
      // Alias foreign keys must be redirected before an inserted owner can be removed on rollback.
      for (const { before, after } of rows(plan.changes.identities))
        if (!after && before) await manager.delete(IdentityEntity, { id: before.id });
      if (snapshotHash(await snapshot(manager)) !== result)
        throw Error('camera_migration_result_mismatch');
      return 'applied';
    });
  }
}
