/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { IdentityRegistry, identityKey } from '../src/identity/index.js';
import type { IdentityRef } from '../src/identity/types.js';
import { IdentityDatabase } from './fixtures/identity.js';

const camera: IdentityRef = {
  homeId: 'house',
  kind: 'camera',
  source: { instanceId: 'bridge', externalId: 'serial' },
};

it('separates homes, record kinds and providers while surviving registry recreation', async () => {
  const database = new IdentityDatabase();
  let sequence = 0;
  const allocate = () => `haus-${++sequence}`;
  const registry = new IdentityRegistry(database, allocate);
  const id = await registry.resolve(camera);
  expect(await new IdentityRegistry(database, allocate).resolve(camera)).toBe(id);
  const variants: IdentityRef[] = [
    { ...camera, homeId: 'other' },
    { ...camera, kind: 'endpoint' },
    { ...camera, source: { ...camera.source, instanceId: 'other' } },
    { ...camera, source: { ...camera.source, externalId: 'another-serial' } },
  ];
  expect(
    new Set([id, ...(await Promise.all(variants.map((reference) => registry.resolve(reference))))])
      .size,
  ).toBe(5);
});

it('retains installed camera and archive IDs through explicit provider aliases', async () => {
  const database = new IdentityDatabase();
  const registry = new IdentityRegistry(database, () => 'new-id');
  const oldCamera = { ...camera, source: { instanceId: 'legacy', externalId: 'camera.outdoor' } };
  const original = 'installed-camera-id';
  expect(await registry.adopt(camera, original, [oldCamera])).toBe(original);
  expect(await registry.resolve(oldCamera)).toBe(original);
  expect(await registry.resolve(camera)).toBe(original);
  const recording: IdentityRef = {
    ...camera,
    kind: 'recording',
    source: {
      instanceId: 'archive',
      externalId: 'original-digest',
    },
  };
  expect(await registry.adopt(recording, 'installed-recording-id')).toBe('installed-recording-id');
  expect(await new IdentityRegistry(database, () => 'replacement').resolve(recording)).toBe(
    'installed-recording-id',
  );
});

it('rejects conflicting imports atomically instead of silently merging or remapping records', async () => {
  const database = new IdentityDatabase();
  const registry = new IdentityRegistry(database, () => 'allocated');
  const alias = { ...camera, source: { instanceId: 'other', externalId: 'camera' } };
  await registry.adopt(alias, 'other-id');
  await expect(registry.adopt(camera, 'preserved', [alias])).rejects.toThrow(
    'identity_import_conflict',
  );
  expect(await database.transaction((transaction) => transaction.get(camera))).toBeUndefined();
  expect(await registry.resolve(alias)).toBe('other-id');
  await expect(
    registry.adopt(camera, 'other-id', [{ ...camera, homeId: 'foreign' }]),
  ).rejects.toThrow('identity_alias_scope_mismatch');
  await expect(registry.adopt({ ...camera, kind: 'endpoint' }, 'other-id')).rejects.toThrow(
    'identity_owner_scope_mismatch',
  );
});

it('rejects allocator collisions and uses unambiguous keys for punctuation in provider IDs', async () => {
  const registry = new IdentityRegistry(new IdentityDatabase(), () => 'same-id');
  await registry.resolve(camera);
  await expect(registry.resolve({ ...camera, homeId: 'other' })).rejects.toThrow(
    'identity_allocation_collision',
  );
  expect(identityKey({ ...camera, source: { instanceId: 'a:b', externalId: 'c' } })).not.toBe(
    identityKey({ ...camera, source: { instanceId: 'a', externalId: 'b:c' } }),
  );
  await expect(registry.resolve({ ...camera, homeId: '' })).rejects.toThrow(
    'invalid_identity_reference',
  );
});
