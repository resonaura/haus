/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Driver from 'better-sqlite3';
import { DataSource } from 'typeorm';
import { Addresses, IdentityRegistry } from '@haus/core/identity';
import type { IdentityRef } from '@haus/core/identity';
import { openCatalog, OrmAddresses, OrmIdentities, Transactions } from '../../src/storage/index.js';
import { IdentityEntity, AliasEntity } from '../../src/storage/entities/identity.js';
import { AddressEntity } from '../../src/storage/entities/address.js';
import { LockEntity } from '../../src/storage/entities/lock.js';
import { ReceiptEntity } from '../../src/storage/entities/receipt.js';
import { Identity1793793227000 } from '../../src/storage/migrations/identity.js';
import { Control1793798000000 } from '../../src/storage/migrations/control.js';

const roots: string[] = [],
  sources: DataSource[] = [];
afterEach(async () => {
  for (const source of sources.splice(0)) if (source.isInitialized) await source.destroy();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function file() {
  const root = await mkdtemp(join(tmpdir(), 'haus-orm-'));
  roots.push(root);
  return join(root, 'catalog.sqlite');
}
async function open(path: string) {
  const source = await openCatalog(path);
  sources.push(source);
  const transactions = new Transactions(source),
    repository = new OrmIdentities(transactions);
  return {
    source,
    repository,
    transactions,
    identities: new IdentityRegistry(repository, randomUUID),
    addresses: new Addresses(new OrmAddresses(transactions)),
  };
}
const camera: IdentityRef = {
  homeId: 'house',
  kind: 'camera',
  source: { instanceId: 'new-provider', externalId: 'hardware-serial' },
};

it('persists installed IDs, readable addresses and aliases through a real database reopen', async () => {
  const path = await file(),
    first = await open(path);
  const old = {
    ...camera,
    source: { instanceId: 'previous-provider', externalId: 'camera.outdoor' },
  };
  await first.identities.adopt(camera, 'installed-camera-id', [old]);
  const address = await first.addresses.assign(
    'house',
    'installed-camera-id',
    'camera::outdoor:front-camera:front-camera',
  );
  expect(address).toBe('camera::outdoor:front-camera');
  const next = await first.addresses.rename(
    'house',
    'installed-camera-id',
    'camera::garden:front-camera',
  );
  await first.source.destroy();
  const reopened = await open(path);
  expect(await reopened.identities.resolve(camera)).toBe('installed-camera-id');
  expect(await reopened.identities.resolve(old)).toBe('installed-camera-id');
  expect(await reopened.addresses.resolve('house', address)).toBe('installed-camera-id');
  expect(await reopened.addresses.resolve('house', next)).toBe('installed-camera-id');
  expect(reopened.source.options.synchronize).toBe(false);
});

it('rolls back every identity write when an async transaction fails and continues using the queue', async () => {
  const test = await open(await file());
  await expect(
    test.repository.transaction(async (transaction) => {
      await transaction.bind(camera, 'rolled-back');
      throw Error('injected_failure');
    }),
  ).rejects.toThrow('injected_failure');
  expect(await test.source.manager.count(IdentityEntity)).toBe(0);
  expect(await test.source.manager.count(AliasEntity)).toBe(0);
  expect(await test.identities.resolve(camera)).toBeTruthy();
});

it('serializes concurrent DataSources and allocates one canonical ID for the same source', async () => {
  const path = await file(),
    first = await open(path),
    second = await open(path);
  const ids = await Promise.all(
    Array.from({ length: 24 }, (_value, index) =>
      (index % 2 ? first : second).identities.resolve(camera),
    ),
  );
  expect(new Set(ids).size).toBe(1);
  expect(await first.source.manager.count(IdentityEntity)).toBe(1);
  expect(await second.source.manager.count(AliasEntity)).toBe(1);
});

it('rejects competing readable addresses and rolls back partially reserved aliases', async () => {
  const path = await file(),
    first = await open(path),
    second = await open(path);
  const one = await first.identities.resolve(camera);
  const two = await first.identities.resolve({
    ...camera,
    source: { ...camera.source, externalId: 'other-serial' },
  });
  const address = 'camera::outdoor:front-camera';
  const results = await Promise.allSettled([
    first.addresses.assign('house', one, address),
    second.addresses.assign('house', two, address),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const repository = new OrmAddresses(first.transactions);
  await expect(
    repository.transaction(async (transaction) => {
      await transaction.reserve('house', 'camera::outdoor:rollback', one);
      await transaction.select('house', one, 'camera::outdoor:not-reserved');
    }),
  ).rejects.toThrow('identity_address_not_reserved');
  expect(await first.addresses.resolve('house', 'camera::outdoor:rollback')).toBeUndefined();
  expect(await first.source.manager.count(AddressEntity)).toBe(1);
});

it('enforces home/kind ownership even when a repository is used directly', async () => {
  const test = await open(await file());
  await test.identities.adopt(camera, 'preserved');
  await expect(
    test.repository.transaction((transaction) =>
      transaction.bind({ ...camera, homeId: 'foreign' }, 'preserved'),
    ),
  ).rejects.toThrow('identity_owner_scope_mismatch');
  await expect(
    test.addresses.assign('foreign', 'preserved', 'camera::outdoor:front-camera'),
  ).rejects.toThrow('identity_address_owner_mismatch');
  expect(await test.source.manager.count(IdentityEntity)).toBe(1);
});

it('applies only additive migrations and preserves existing recordings and schema version', async () => {
  const path = await file(),
    legacy = new Driver(path);
  legacy.exec(
    "PRAGMA user_version=6; CREATE TABLE events(id TEXT PRIMARY KEY,camera_id TEXT,digest TEXT,start_at INTEGER,end_at INTEGER,status TEXT,kinds TEXT,detections TEXT,duration REAL DEFAULT 0,bytes INTEGER DEFAULT 0,error TEXT); INSERT INTO events(id,camera_id,digest,start_at,end_at,status,kinds,detections) VALUES('original','camera.outdoor','retained-digest',1000,2000,'ready','[]','[]')",
  );
  legacy.close();
  const test = await open(path);
  await test.identities.adopt(camera, 'installed-camera-id');
  await test.source.destroy();
  const inspection = new Driver(path, { readonly: true });
  try {
    expect(inspection.pragma('user_version', { simple: true })).toBe(6);
    expect(inspection.prepare('SELECT id,camera_id,digest FROM events').get()).toEqual({
      id: 'original',
      camera_id: 'camera.outdoor',
      digest: 'retained-digest',
    });
    expect(inspection.pragma('foreign_key_check')).toEqual([]);
    expect(
      inspection
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'haus_%'")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { name: 'haus_identity_ids' },
        { name: 'haus_identity_refs' },
        { name: 'haus_addresses' },
        { name: 'haus_platform_migrations' },
      ]),
    );
  } finally {
    inspection.close();
  }
});

it('rejects a newer schema without rewriting its version marker', async () => {
  const path = await file(),
    first = await open(path);
  await first.source.manager.update(LockEntity, { id: 1 }, { version: 999 });
  await expect(first.identities.resolve(camera)).rejects.toThrow(
    'invalid_platform_storage_version',
  );
  expect((await first.source.manager.findOneBy(LockEntity, { id: 1 }))?.version).toBe(999);
  await first.source.destroy();
  await expect(openCatalog(path)).rejects.toThrow('unsupported_platform_storage_version');
});

it('rolls back the whole additive migration if an existing table conflicts', async () => {
  const path = await file(),
    legacy = new Driver(path);
  legacy.exec(
    'CREATE TABLE "haus-addresses" (value TEXT); INSERT INTO "haus-addresses" VALUES(\'retained\')',
  );
  legacy.close();
  await expect(openCatalog(path)).rejects.toThrow();
  const inspection = new Driver(path, { readonly: true });
  try {
    expect(inspection.prepare('SELECT value FROM "haus-addresses"').get()).toEqual({
      value: 'retained',
    });
    expect(
      inspection.prepare("SELECT name FROM sqlite_master WHERE name='haus-identity-ids'").get(),
    ).toBeUndefined();
  } finally {
    inspection.close();
  }
});

it('loads the built ESM export in independent processes and preserves cross-process identity', async () => {
  const path = await file(),
    initial = await open(path);
  await initial.source.destroy();
  const run = promisify(execFile);
  const program = `
    import { randomUUID } from 'node:crypto';
    import { IdentityRegistry } from '@haus/core/identity';
    import { openCatalog, Transactions, OrmIdentities } from '@haus/hub/storage';
    const source = await openCatalog(process.argv[1]);
    try {
      const registry = new IdentityRegistry(new OrmIdentities(new Transactions(source)), randomUUID);
      const id = await registry.resolve(${JSON.stringify(camera)});
      process.stdout.write(id);
    } finally { await source.destroy(); }
  `;
  const options = {
    cwd: new URL('../../', import.meta.url).pathname,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  };
  const [one, two] = await Promise.all([
    run(process.execPath, ['--input-type=module', '-e', program, path], options),
    run(process.execPath, ['--input-type=module', '-e', program, path], options),
  ]);
  expect(one.stdout).toBe(two.stdout);
  expect(one.stdout).toMatch(/^[a-f0-9-]{36}$/);
});

it('renames the installed hyphen schema and preserves identities, addresses, receipts, and foreign keys', async () => {
  const path = await file();
  const legacy = new DataSource({
    type: 'better-sqlite3',
    database: path,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'haus-platform-migrations',
    entities: [],
    migrations: [Identity1793793227000, Control1793798000000],
  });
  await legacy.initialize();
  await legacy.runMigrations({ transaction: 'all' });
  await legacy.query(
    'INSERT INTO "haus-identity-ids" (id,home,kind,source,external) VALUES(?,?,?,?,?)',
    ['installed-camera-id', 'house', 'camera', 'old-provider', 'hardware-serial'],
  );
  await legacy.query(
    'INSERT INTO "haus-identity-refs" (home,kind,source,external,"identity-id") VALUES(?,?,?,?,?)',
    ['house', 'camera', 'old-provider', 'hardware-serial', 'installed-camera-id'],
  );
  await legacy.query('INSERT INTO "haus-addresses" (home,address,"identity-id") VALUES(?,?,?)', [
    'house',
    'camera::outdoor:front-camera',
    'installed-camera-id',
  ]);
  await legacy.query(
    'INSERT INTO "haus-primary-addresses" (home,"identity-id",address) VALUES(?,?,?)',
    ['house', 'installed-camera-id', 'camera::outdoor:front-camera'],
  );
  await legacy.query(
    'INSERT INTO "haus-receipts" (home,actor,"idempotency-key",fingerprint,"command-id","correlation-id","owner-generation",status,reason) VALUES(?,?,?,?,?,?,?,?,?)',
    [
      'house',
      'hub',
      'request-one',
      'fingerprint',
      'command-one',
      'correlation-one',
      7,
      'accepted',
      null,
    ],
  );
  await legacy.destroy();

  const migrated = await open(path);
  const previous: IdentityRef = {
    ...camera,
    source: { instanceId: 'old-provider', externalId: 'hardware-serial' },
  };
  expect(await migrated.identities.resolve(previous)).toBe('installed-camera-id');
  expect(await migrated.addresses.resolve('house', 'camera::outdoor:front-camera')).toBe(
    'installed-camera-id',
  );
  expect(
    await migrated.source.manager.findOneByOrFail(ReceiptEntity, {
      home: 'house',
      actor: 'hub',
      key: 'request-one',
    }),
  ).toMatchObject({
    command: 'command-one',
    correlation: 'correlation-one',
    generation: 7,
  });
  const runner = migrated.source.createQueryRunner();
  try {
    expect(await runner.hasTable('haus-identity-ids')).toBe(false);
    expect(await runner.hasTable('haus_identity_ids')).toBe(true);
    expect(await runner.hasColumn('haus_receipts', 'idempotency_key')).toBe(true);
    expect(await runner.hasColumn('haus_receipts', 'idempotency-key')).toBe(false);
    expect(await runner.query('PRAGMA foreign_key_check')).toEqual([]);
  } finally {
    await runner.release();
  }
});
