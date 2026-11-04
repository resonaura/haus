/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface Address {
  readonly type: string;
  readonly area: string;
  readonly device: string;
  readonly entity?: string;
}

const segment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function valid(value: string): boolean {
  return typeof value === 'string' && value.length <= 256 && segment.test(value);
}

export function formatAddress(address: Address): string {
  if (
    ![address.type, address.area, address.device].every(valid) ||
    (address.entity !== undefined && !valid(address.entity))
  )
    throw Error('invalid_identity_address');
  const entity =
    address.entity === address.device
      ? undefined
      : address.entity?.startsWith(`${address.device}-`)
        ? address.entity.slice(address.device.length + 1)
        : address.entity;
  return `${address.type}::${address.area}:${address.device}${entity ? `:${entity}` : ''}`;
}

export function parseAddress(value: unknown): Address | undefined {
  if (typeof value !== 'string' || value.length > 1030) return;
  const [type, rest, extra] = value.split('::');
  if (extra !== undefined || rest === undefined) return;
  const fields = rest.split(':');
  if (fields.length < 2 || fields.length > 3) return;
  const [area, device, entity] = fields;
  if (![type, area, device].every(valid) || (entity !== undefined && !valid(entity))) return;
  return { type, area, device, ...(entity === undefined ? {} : { entity }) };
}

export interface AddressTransaction {
  resolve(homeId: string, address: string): string | undefined;
  current(homeId: string, id: string): string | undefined;
  reserve(homeId: string, address: string, id: string): void;
  select(homeId: string, id: string, address: string): void;
}

/** Both primary addresses and retained aliases are committed atomically and persisted by the host. */
export interface AddressRepository {
  transaction<T>(operation: (transaction: AddressTransaction) => T): T;
}

/** Readable public IDs point to durable records; provider re-enrollment changes the binding only. */
export class Addresses {
  constructor(private readonly repository: AddressRepository) {}

  assign(homeId: string, id: string, address: string): string {
    return this.save(homeId, id, address, false);
  }

  /** Explicit renames reserve previous addresses forever until an explicit release/migration. */
  rename(homeId: string, id: string, address: string): string {
    return this.save(homeId, id, address, true);
  }

  resolve(homeId: string, address: string): string | undefined {
    this.validateScope(homeId);
    const parsed = parseAddress(address);
    if (!parsed) throw Error('invalid_identity_address');
    return this.repository.transaction(
      (transaction) =>
        transaction.resolve(homeId, address) ?? transaction.resolve(homeId, formatAddress(parsed)),
    );
  }

  private save(homeId: string, id: string, address: string, rename: boolean): string {
    this.validateScope(homeId);
    this.validateScope(id);
    const parsed = parseAddress(address);
    if (!parsed) throw Error('invalid_identity_address');
    const primary = formatAddress(parsed);
    return this.repository.transaction((transaction) => {
      const current = transaction.current(homeId, id);
      if (current && !rename) return current;
      for (const candidate of new Set([primary, address])) {
        const existing = transaction.resolve(homeId, candidate);
        if (existing !== undefined && existing !== id) throw Error('identity_address_conflict');
      }
      for (const candidate of new Set([primary, address]))
        transaction.reserve(homeId, candidate, id);
      transaction.select(homeId, id, primary);
      return primary;
    });
  }

  private validateScope(value: string): void {
    if (typeof value !== 'string' || !value.trim()) throw Error('invalid_identity_scope');
  }
}
