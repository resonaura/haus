/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { SessionOwnership } from '@haus/core/session';
import type { IntegrationRef, SessionGrant } from '@haus/core/session';
import { Commands } from '@haus/core/command';
import type { CommandEntry, CommandProvider, CommandRequest } from '@haus/core/command';
import { openCatalog, Transactions, OrmSessions, OrmReceipts } from '../../src/storage/index.js';
import { ReceiptEntity } from '../../src/storage/entities/receipt.js';
import { LockEntity } from '../../src/storage/entities/lock.js';
import { Identity1793793227000 } from '../../src/storage/migrations/identity.js';
import { IdentityEntity } from '../../src/storage/entities/identity.js';

const roots: string[] = [],
  sources: DataSource[] = [];
afterEach(async () => {
  for (const source of sources.splice(0)) if (source.isInitialized) await source.destroy();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function file() {
  const root = await mkdtemp(join(tmpdir(), 'haus-control-'));
  roots.push(root);
  return join(root, 'catalog.sqlite');
}
async function open(path: string) {
  const source = await openCatalog(path);
  sources.push(source);
  const transactions = new Transactions(source),
    sessions = new OrmSessions(transactions);
  return {
    source,
    sessions,
    ownership: new SessionOwnership(sessions),
    receipts: new OrmReceipts(transactions),
  };
}
const resource: IntegrationRef = { homeId: 'house', kind: 'integration', id: 'provider' };
const owner = { hubId: 'hub', processId: 'first-boot' };
const entry: CommandEntry = {
  scope: { homeId: 'house', actorId: 'actor', idempotencyKey: 'intent' },
  fingerprint: 'keyed-fixture-digest',
  outcome: {
    schema: 'haus.receipt',
    version: 1,
    commandId: 'first-command',
    correlationId: 'first-command',
    ownerGeneration: 1,
    status: 'unknown',
    reason: 'dispatch-pending',
  },
};

it('retains ownership across restart and requires completed fencing before a new generation', async () => {
  const path = await file(),
    first = await open(path);
  const grant = await first.ownership.acquire(resource, owner);
  await first.ownership.connected(grant);
  await first.source.destroy();
  const next = await open(path);
  await expect(
    next.ownership.acquire(resource, { ...owner, processId: 'second-boot' }),
  ).rejects.toThrow('integration_already_owned');
  await expect(
    next.ownership.revoke(grant, async () => {
      throw Error('not_fenced');
    }),
  ).rejects.toThrow('not_fenced');
  await next.source.destroy();
  const recovered = await open(path);
  expect((await recovered.sessions.read(resource))?.state).toBe('revoking');
  await recovered.ownership.revoke(grant, async () => {});
  const replacement = await recovered.ownership.acquire(resource, {
    ...owner,
    processId: 'second-boot',
  });
  expect(replacement.generation).toBe(2);
  await recovered.ownership.connected(replacement);
  await expect(recovered.ownership.assert(grant)).rejects.toThrow('integration_owner_unavailable');
});

it('serializes competing owners and rolls back a failed transition', async () => {
  const path = await file(),
    first = await open(path),
    second = await open(path);
  const claims = await Promise.allSettled(
    Array.from({ length: 12 }, (_value, index) =>
      (index % 2 ? first : second).ownership.acquire(resource, {
        ...owner,
        processId: `boot-${index}`,
      }),
    ),
  );
  expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const previous = await first.sessions.read(resource);
  await expect(
    first.sessions.update(resource, (current) => {
      if (!current) throw Error('missing_fixture');
      throw Error('transition_failed');
    }),
  ).rejects.toThrow('transition_failed');
  expect(await second.sessions.read(resource)).toEqual(previous);
  await expect(
    first.sessions.update(resource, (current) => {
      if (!current) throw Error('missing_fixture');
      return { ...current, resource: { ...resource, homeId: 'foreign' } };
    }),
  ).rejects.toThrow('session_resource_mismatch');
  expect(await second.sessions.read(resource)).toEqual(previous);
});

it('holds an ownership guard until vault I/O finishes, then rejects stale or foreign grants', async () => {
  const path = await file(),
    first = await open(path),
    second = await open(path);
  const grant = await first.ownership.acquire(resource, owner);
  await first.ownership.connected(grant);
  let finish = () => {};
  const operation = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const guarded = first.sessions.guard(grant, ['connected'], operation);
  await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
  const fence = vi.fn(async () => {});
  const revoked = second.ownership.revoke(grant, fence);
  await Promise.resolve();
  expect(fence).not.toHaveBeenCalled();
  finish();
  await Promise.all([guarded, revoked]);
  await expect(first.sessions.guard(grant, ['connected'], operation)).rejects.toThrow(
    'integration_owner_unavailable',
  );
  const foreign = { ...grant, resource: { ...resource, homeId: 'foreign' } };
  await expect(first.sessions.guard(foreign, ['connected'], operation)).rejects.toThrow(
    'integration_owner_unavailable',
  );
  expect(operation).toHaveBeenCalledTimes(1);
});

it('upgrades the first platform migration without replacing existing identity data', async () => {
  const template = await open(await file()),
    path = await file();
  const options = template.source.options;
  if (options.type !== 'better-sqlite3') throw Error('invalid_fixture_source');
  const old = new DataSource({
    ...options,
    database: path,
    migrations: [Identity1793793227000],
  });
  sources.push(old);
  await old.initialize();
  await old.runMigrations({ transaction: 'all' });
  await old.manager.insert(IdentityEntity, {
    id: 'retained',
    home: 'house',
    kind: 'camera',
    source: 'old-source',
    external: 'old-camera',
  });
  await old.destroy();
  const upgraded = await open(path);
  expect(
    (await upgraded.source.manager.findOneBy(IdentityEntity, { id: 'retained' }))?.external,
  ).toBe('old-camera');
  expect((await upgraded.source.manager.findOneBy(LockEntity, { id: 1 }))?.version).toBe(2);
  await expect(upgraded.ownership.acquire(resource, owner)).resolves.toMatchObject({
    generation: 1,
  });
});

it('reserves one receipt across concurrent repositories and never overwrites its settled outcome', async () => {
  const path = await file(),
    first = await open(path),
    second = await open(path);
  const reservations = await Promise.all(
    Array.from({ length: 12 }, (_value, index) =>
      (index % 2 ? first : second).receipts.reserve(entry),
    ),
  );
  expect(reservations.filter((value) => value.created)).toHaveLength(1);
  const outcome = { ...entry.outcome, reason: 'timeout' as const };
  await first.receipts.settle({ ...entry, outcome });
  expect(
    await second.receipts.settle({
      ...entry,
      outcome: { ...entry.outcome, status: 'confirmed', reason: undefined },
    }),
  ).toEqual(outcome);
  await expect(
    second.receipts.settle({ ...entry, fingerprint: 'different-intent' }),
  ).rejects.toThrow('command_reservation_mismatch');
  await expect(
    second.receipts.settle({ ...entry, outcome: { ...entry.outcome, ownerGeneration: 2 } }),
  ).rejects.toThrow('command_reservation_mismatch');
  expect(await first.source.manager.count(ReceiptEntity)).toBe(1);
  expect(
    (await first.receipts.reserve({ ...entry, scope: { ...entry.scope, homeId: 'other-house' } }))
      .created,
  ).toBe(true);
});

function request(grant: SessionGrant): CommandRequest {
  return {
    actorId: 'actor',
    idempotencyKey: 'intent',
    grant,
    command: {
      id: 'first-command',
      endpointId: 'lock',
      capabilityId: 'lock',
      operation: 'unlock',
      arguments: { code: 'private-fixture-code' },
    },
  };
}
const policy = {
  authorize: async () => true,
  fingerprint: async (intent: Omit<CommandRequest['command'], 'id'>) =>
    createHmac('sha256', 'fixture-key').update(JSON.stringify(intent)).digest('hex'),
};

it.each(['pending', 'transport-lost'] as const)(
  'never redispatches an interrupted %s intent after a real database restart',
  async (failure) => {
    const path = await file(),
      first = await open(path);
    const grant = await first.ownership.acquire(resource, owner);
    await first.ownership.connected(grant);
    const intent = request(grant),
      provider: CommandProvider = {
        resource,
        execute: vi.fn(async () => {
          throw Error('private-transport-detail');
        }),
      };
    if (failure === 'pending') {
      const { id: _id, ...semantics } = intent.command;
      await first.receipts.reserve({ ...entry, fingerprint: await policy.fingerprint(semantics) });
    } else await new Commands(first.ownership, policy, first.receipts, provider).execute(intent);
    await first.source.destroy();
    const second = await open(path),
      execute = vi.fn<CommandProvider['execute']>(async () => ({ status: 'confirmed' }));
    const commands = new Commands(second.ownership, policy, second.receipts, { resource, execute });
    expect(
      await commands.execute({ ...intent, command: { ...intent.command, id: 'new-request' } }),
    ).toMatchObject({
      commandId: 'first-command',
      status: 'unknown',
      reason: failure === 'pending' ? 'dispatch-pending' : 'transport-lost',
    });
    await expect(
      commands.execute({ ...intent, command: { ...intent.command, operation: 'lock' } }),
    ).rejects.toThrow('command_idempotency_conflict');
    expect(execute).not.toHaveBeenCalled();
    const rows = JSON.stringify(await second.source.manager.find(ReceiptEntity));
    expect(rows).not.toContain('private-fixture-code');
    expect(rows).not.toContain('private-transport-detail');
  },
);

it('allows one owner when independent Node processes claim the same persistent resource', async () => {
  const path = await file(),
    initial = await open(path);
  await initial.source.destroy();
  const program = `
    import { randomUUID } from 'node:crypto';
    import { SessionOwnership } from '@haus/core/session';
    import { openCatalog, Transactions, OrmSessions } from '@haus/hub/storage';
    const source = await openCatalog(process.argv[1]);
    try {
      const ownership = new SessionOwnership(new OrmSessions(new Transactions(source)));
      try { await ownership.acquire(${JSON.stringify(resource)}, { hubId: 'hub', processId: randomUUID() }); process.stdout.write('owned'); }
      catch (error) { if (error.message !== 'integration_already_owned') throw error; process.stdout.write('blocked'); }
    } finally { await source.destroy(); }
  `;
  const run = promisify(execFile),
    options = {
      cwd: new URL('../../', import.meta.url).pathname,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    };
  const results = await Promise.all([
    run(process.execPath, ['--input-type=module', '-e', program, path], options),
    run(process.execPath, ['--input-type=module', '-e', program, path], options),
  ]);
  expect(results.map((result) => result.stdout).sort()).toEqual(['blocked', 'owned']);
});
