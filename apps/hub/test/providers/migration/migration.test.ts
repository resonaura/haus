/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import { OrmIdentities } from '../../../src/storage/identity.js';
import { StandaloneHomeEntryEntity } from '../../../src/storage/standalone/entities.js';
import { CameraIdentityEntity, CameraSourceEntity } from '../../../src/storage/cameras/entities.js';
import { AddressEntity } from '../../../src/storage/entities/address.js';
import { AliasEntity, IdentityEntity } from '../../../src/storage/entities/identity.js';
import {
  migrationFixture,
  canonical,
  shadow,
  switchId,
  videoId,
  cameraId,
  shadowSwitch,
  rawId,
} from './fixture.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function boot() {
  const f = await migrationFixture();
  cleanups.push(() => f.close());
  return f;
}

it('preserves canonical IDs, room, metadata, readings, scene references and archive identity with exact source aliases', async () => {
  const f = await boot();
  const scene = await f.source.manager.findOneByOrFail(StandaloneHomeEntryEntity, {
    kind: 'scene',
    entryId: 'scene',
  });
  const plan = await f.migration.plan(f.evidence, 10);
  expect(await f.migration.apply(plan)).toBe('applied');
  expect(await f.migration.apply(plan)).toBe('already-applied');
  expect(await f.source.query('PRAGMA foreign_key_check')).toEqual([]);
  const home = await f.source.manager.find(StandaloneHomeEntryEntity);
  const devices = home
    .filter((row) => row.kind === 'device')
    .map((row) => JSON.parse(row.value) as HausDevice);
  expect(devices).toHaveLength(1);
  expect(devices[0]).toMatchObject({
    id: canonical,
    name: 'Original custom name',
    roomId: 'workshop',
    metadata: { custom: 'preserved' },
  });
  expect(devices[0]?.endpoints.find((endpoint) => endpoint.id === videoId)?.mediaId).toBe(cameraId);
  expect(devices[0]?.endpoints.find((endpoint) => endpoint.id === switchId)).toBeDefined();
  expect(JSON.parse(home.find((row) => row.entryId === switchId)?.value ?? 'null')).toEqual({
    on_off: true,
    custom: 'preserved',
  });
  expect(JSON.parse(home.find((row) => row.entryId === videoId)?.value ?? 'null')).toMatchObject({
    fill: false,
    muted: true,
  });
  expect(home.find((row) => row.kind === 'scene')).toEqual(scene);
  const identities = new OrmIdentities(f.transactions);
  expect(
    await identities.transaction((tx) =>
      tx.get({
        homeId: f.evidence.homeId,
        kind: 'device',
        source: { instanceId: 'haus-mqtt', externalId: rawId },
      }),
    ),
  ).toBe(canonical);
  expect(await f.source.manager.find(CameraIdentityEntity)).toEqual([
    { bridgeId: f.evidence.inventory.bridgeId, physicalId: 'camera-one', cameraId },
  ]);
  expect(await f.migration.rollback(plan)).toBe('applied');
  expect(await f.migration.rollback(plan)).toBe('already-applied');
  expect(await f.source.query('PRAGMA foreign_key_check')).toEqual([]);
  expect((await f.migration.plan(f.evidence, 10)).beforeHash).toBe(plan.beforeHash);
});

it('refuses an already-imported media source instead of silently changing its identity', async () => {
  const f = await boot();
  await f.source.manager.insert(CameraSourceEntity, {
    bridgeId: f.evidence.inventory.bridgeId,
    physicalId: 'camera-one',
    value: JSON.stringify({ cameraId }),
  });
  await expect(f.migration.plan(f.evidence)).rejects.toThrow(
    'camera_migration_source_already_imported',
  );
});

it('refuses a legacy canonical ID allocated to a different MQTT device', async () => {
  const f = await boot();
  await f.source.manager.insert(IdentityEntity, {
    id: canonical,
    home: f.evidence.homeId,
    source: 'haus-mqtt',
    kind: 'device',
    external: 'another-physical-camera',
  });
  await expect(f.migration.plan(f.evidence)).rejects.toThrow('camera_migration_foreign_owner');
});

it('requires every authenticated entity alias and refuses matching devices by label', async () => {
  const f = await boot();
  const input = structuredClone(f.evidence);
  const missingAlias = {
    ...input,
    inventory: {
      ...input.inventory,
      cameras: input.inventory.cameras.map((camera) => ({
        ...camera,
        entities: camera.entities.map((entity) => ({ ...entity, mqtt: undefined })),
      })),
    },
  };
  await expect(f.migration.plan(missingAlias)).rejects.toThrow('camera_migration_alias_missing');
  const row = await f.source.manager.findOneByOrFail(StandaloneHomeEntryEntity, {
    kind: 'device',
    entryId: canonical,
  });
  const value: HausDevice = JSON.parse(row.value);
  await f.source.manager.update(
    StandaloneHomeEntryEntity,
    { kind: row.kind, entryId: row.entryId },
    {
      value: JSON.stringify({
        ...value,
        name: 'Provider label',
        source: { ...value.source, externalId: 'unrelated' },
      }),
    },
  );
  await expect(f.migration.plan(f.evidence)).rejects.toThrow('camera_migration_device_ambiguous');
});

it.each(['host', 'path', 'duplicate'] as const)(
  'refuses %s archive evidence without changing the catalog',
  async (kind) => {
    const f = await boot();
    const evidence = structuredClone(f.evidence);
    const assignment = evidence.assignments[0];
    if (!assignment) throw Error('fixture_assignment_missing');
    const altered =
      kind === 'host'
        ? { ...evidence, move: { ...evidence.move, fromHost: '192.168.1.99' } }
        : kind === 'path'
          ? {
              ...evidence,
              assignments: [
                {
                  ...assignment,
                  source: { ...assignment.source, url: 'rtsp://192.168.1.10:8555/not-one' },
                },
              ],
            }
          : { ...evidence, assignments: [assignment, { ...assignment, cameraId: 'camera.other' }] };
    const before = (await f.migration.plan(f.evidence, 10)).beforeHash;
    await expect(f.migration.plan(altered)).rejects.toThrow('camera_migration_archive_ambiguous');
    expect((await f.migration.plan(f.evidence, 10)).beforeHash).toBe(before);
  },
);

it('rejects stale plans and rolls the transaction back after a persistence failure', async () => {
  const f = await boot();
  const plan = await f.migration.plan(f.evidence, 10);
  await f.source.manager.insert(StandaloneHomeEntryEntity, {
    kind: 'script',
    entryId: 'new',
    value: '{}',
    updatedAt: 2,
  });
  await expect(f.migration.apply(plan)).rejects.toThrow('camera_migration_catalog_changed');
  await f.source.manager.delete(StandaloneHomeEntryEntity, { kind: 'script', entryId: 'new' });
  await f.source.query(
    "CREATE TRIGGER fail_camera_migration BEFORE INSERT ON native_camera_identities BEGIN SELECT RAISE(ABORT, 'fixture_write_failure'); END",
  );
  await expect(f.migration.apply(plan)).rejects.toThrow('fixture_write_failure');
  expect((await f.migration.plan(f.evidence, 10)).beforeHash).toBe(plan.beforeHash);
});

it.each(['scene', 'address', 'owner'] as const)(
  'refuses retiring an identity protected by %s',
  async (kind) => {
    const f = await boot();
    if (kind === 'scene')
      await f.source.manager.insert(StandaloneHomeEntryEntity, {
        kind: 'scene',
        entryId: 'new',
        value: JSON.stringify({ members: [{ endpointId: shadowSwitch }] }),
        updatedAt: 2,
      });
    if (kind === 'address')
      await f.source.manager.insert(AddressEntity, {
        home: f.evidence.homeId,
        address: 'camera::workshop:one',
        identityId: shadow,
      });
    if (kind === 'owner')
      await f.source.manager.insert(AliasEntity, {
        home: f.evidence.homeId,
        kind: 'device',
        source: 'another-adapter',
        external: 'foreign',
        identityId: shadow,
      });
    await expect(f.migration.plan(f.evidence)).rejects.toThrow(
      kind === 'owner' ? 'camera_migration_foreign_owner' : 'camera_migration_referenced_identity',
    );
  },
);
