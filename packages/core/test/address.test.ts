/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { Addresses, parseAddress, formatAddress } from '../src/identity/address.js';
import type { AddressRepository, AddressTransaction } from '../src/identity/address.js';
import { IdentityRegistry } from '../src/identity/registry.js';
import { IdentityDatabase } from './fixtures/identity.js';

class AddressDatabase implements AddressRepository {
  private aliases = new Map<string, string>();
  private primaries = new Map<string, string>();
  private pending: Promise<void> = Promise.resolve();
  transaction<T>(operation: (transaction: AddressTransaction) => Promise<T>): Promise<T> {
    const run = this.pending.then(() => this.commit(operation));
    this.pending = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  private async commit<T>(operation: (transaction: AddressTransaction) => Promise<T>): Promise<T> {
    const aliases = new Map(this.aliases),
      primaries = new Map(this.primaries);
    const key = (home: string, value: string) => JSON.stringify([home, value]);
    const result = await operation({
      resolve: async (home, address) => aliases.get(key(home, address)),
      current: async (home, id) => primaries.get(key(home, id)),
      reserve: async (home, address, id) => {
        aliases.set(key(home, address), id);
      },
      select: async (home, id, address) => {
        primaries.set(key(home, id), address);
      },
    });
    this.aliases = aliases;
    this.primaries = primaries;
    return result;
  }
}

const address = 'switch::bedroom:surge-protector:socket-1';

it('round-trips the chosen kebab-case format and rejects alternate syntax', () => {
  expect(parseAddress(address)).toEqual({
    type: 'switch',
    area: 'bedroom',
    device: 'surge-protector',
    entity: 'socket-1',
  });
  const parsed = parseAddress(address);
  if (!parsed) throw Error('fixture_invalid');
  expect(formatAddress(parsed)).toBe(address);
  for (const invalid of [
    'switch::bed_room:protector:socket-1',
    'Switch::bedroom:protector:socket-1',
    'switch::bedroom:surgeProtector:socket-1',
    'switch:bedroom:protector:socket-1',
    'switch::bedroom::protector:socket-1',
    'switch::bedroom:protector:socket-1:extra',
    'switch::bedroom:protector:',
    'switch::bedroom:surge--protector',
    'switch::bedroom: protector',
    'switch::bedroom:protector/socket-1',
  ])
    expect(parseAddress(invalid)).toBeUndefined();
});

it('omits a repeated entity name and strips only the exact device-name prefix', () => {
  const base = { type: 'light', area: 'bedroom', device: 'ceiling-lamp' };
  expect(formatAddress(base)).toBe('light::bedroom:ceiling-lamp');
  expect(formatAddress({ ...base, entity: 'ceiling-lamp' })).toBe('light::bedroom:ceiling-lamp');
  expect(formatAddress({ ...base, entity: 'ceiling-lamp-brightness' })).toBe(
    'light::bedroom:ceiling-lamp:brightness',
  );
  expect(formatAddress({ ...base, device: 'ac', entity: 'action' })).toBe(
    'light::bedroom:ac:action',
  );
});

it('retains readable IDs after room/name changes, explicit renames and store recreation', async () => {
  const database = new AddressDatabase(),
    addresses = new Addresses(database);
  expect(await addresses.assign('house', 'stable-id', address)).toBe(address);
  expect(
    await addresses.assign('house', 'stable-id', 'switch::office:new-protector:socket-1'),
  ).toBe(address);
  const next = 'switch::office:surge-protector:socket-1';
  expect(await addresses.rename('house', 'stable-id', next)).toBe(next);
  expect(await new Addresses(database).resolve('house', address)).toBe('stable-id');
  expect(await addresses.resolve('house', next)).toBe('stable-id');
  expect(await addresses.resolve('other-house', address)).toBeUndefined();
  expect(await addresses.assign('other-house', 'other-id', address)).toBe(address);
});

it('keeps expanded names as aliases and rejects collisions without a numeric suffix', async () => {
  const addresses = new Addresses(new AddressDatabase());
  const repeated = 'light::bedroom:ceiling-lamp:ceiling-lamp';
  expect(await addresses.assign('house', 'lamp', repeated)).toBe('light::bedroom:ceiling-lamp');
  expect(await addresses.resolve('house', repeated)).toBe('lamp');
  await expect(addresses.assign('house', 'other', repeated)).rejects.toThrow(
    'identity_address_conflict',
  );
  await addresses.assign('house', 'outlet', address);
  await expect(addresses.rename('house', 'lamp', address)).rejects.toThrow(
    'identity_address_conflict',
  );
  expect(await addresses.resolve('house', 'light::bedroom:ceiling-lamp')).toBe('lamp');
  expect(await addresses.resolve('house', address)).toBe('outlet');
});

it('restores a scene target when an integration is explicitly re-enrolled with a new source key', async () => {
  const identities = new IdentityRegistry(new IdentityDatabase(), () => 'preserved-target');
  const addresses = new Addresses(new AddressDatabase());
  const previous = {
    homeId: 'house',
    kind: 'endpoint' as const,
    source: { instanceId: 'old-integration', externalId: 'hardware-serial/socket-1' },
  };
  const id = await identities.resolve(previous);
  const sceneTarget = await addresses.assign('house', id, address);
  const replacement = {
    ...previous,
    source: { ...previous.source, instanceId: 'new-integration' },
  };
  await identities.adopt(replacement, id, [previous]);
  expect(await identities.resolve(replacement)).toBe(await addresses.resolve('house', sceneTarget));
});
