/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IdentityKind, IdentityRef, IdentityRepository } from './types.js';

const kinds: ReadonlySet<string> = new Set<IdentityKind>([
  'home',
  'room',
  'device',
  'endpoint',
  'camera',
  'recording',
  'app',
]);

function validate(reference: IdentityRef): void {
  if (
    !reference ||
    !kinds.has(reference.kind) ||
    !reference.source ||
    [reference.homeId, reference.source.instanceId, reference.source.externalId].some(
      (value) => typeof value !== 'string' || !value.trim() || value.length > 4096,
    )
  )
    throw Error('invalid_identity_reference');
}

export function identityKey(reference: IdentityRef): string {
  validate(reference);
  return JSON.stringify([
    reference.homeId,
    reference.kind,
    reference.source.instanceId,
    reference.source.externalId,
  ]);
}

/** Persists canonical mappings and explicit imports without guessing physical equivalence. */
export class IdentityRegistry {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly allocate: () => string,
  ) {}

  async resolve(reference: IdentityRef): Promise<string> {
    validate(reference);
    return this.repository.transaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (existing !== undefined) return existing;
      const id = this.allocate();
      this.validateId(id);
      if (await transaction.owner(id)) throw Error('identity_allocation_collision');
      await transaction.bind(reference, id);
      return id;
    });
  }

  /** An explicit import preserves an installed ID, including archive and camera aliases. */
  async adopt(
    reference: IdentityRef,
    id: string,
    aliases: readonly IdentityRef[] = [],
  ): Promise<string> {
    this.validateId(id);
    const references = [reference, ...aliases];
    for (const item of references) {
      validate(item);
      if (item.homeId !== reference.homeId || item.kind !== reference.kind)
        throw Error('identity_alias_scope_mismatch');
    }
    return this.repository.transaction(async (transaction) => {
      const owner = await transaction.owner(id);
      if (owner && (owner.homeId !== reference.homeId || owner.kind !== reference.kind))
        throw Error('identity_owner_scope_mismatch');
      for (const item of references) {
        const existing = await transaction.get(item);
        if (existing !== undefined && existing !== id) throw Error('identity_import_conflict');
      }
      for (const item of references) await transaction.bind(item, id);
      return id;
    });
  }

  private validateId(id: string): void {
    if (typeof id !== 'string' || !id.trim() || id.length > 4096)
      throw Error('invalid_canonical_identity');
  }
}
