/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { OwnedCredentials, SessionOwnership } from '../src/session/index.js';
import type { IntegrationRef, SessionOwner } from '../src/session/types.js';
import { SessionDatabase } from './fixtures/session.js';

const resource: IntegrationRef = { homeId: 'house', kind: 'integration', id: 'provider-account' };
const first: SessionOwner = { hubId: 'hub-one', processId: 'boot-one' };
const second: SessionOwner = { hubId: 'hub-two', processId: 'boot-two' };

it('allows only one process to own an integration even across authority instances', async () => {
  const database = new SessionDatabase();
  const a = new SessionOwnership(database),
    b = new SessionOwnership(database);
  const claims = await Promise.allSettled([
    Promise.resolve().then(() => a.acquire(resource, first)),
    Promise.resolve().then(() => b.acquire(resource, second)),
  ]);
  expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(claims.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(() => b.acquire(resource, { ...first, processId: 'restarted-process' })).toThrow(
    'integration_already_owned',
  );
  expect(database.read(resource)?.generation).toBe(1);
});

it('keeps an unreachable owner reserved until fencing succeeds and invalidates old grants', async () => {
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = ownership.acquire(resource, first);
  ownership.connected(grant);
  let finish = () => {};
  const fence = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const revocation = ownership.revoke(grant, fence);
  expect(database.read(resource)?.state).toBe('revoking');
  expect(() => ownership.assert(grant)).toThrow('integration_owner_unavailable');
  expect(() => ownership.acquire(resource, second)).toThrow('integration_already_owned');
  expect(ownership.revoke(grant, fence)).toBe(revocation);
  await Promise.resolve();
  finish();
  await revocation;
  const replacement = ownership.acquire(resource, second);
  expect(replacement.generation).toBe(2);
  ownership.connected(replacement);
  expect(() => ownership.connected(grant)).toThrow('integration_owner_unavailable');
  expect(() => ownership.assert(grant)).toThrow('integration_owner_unavailable');
  expect(fence).toHaveBeenCalledTimes(1);
});

it('keeps failed fencing blocked and requires an explicit retry of verified cleanup', async () => {
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = ownership.acquire(resource, first);
  await expect(
    ownership.revoke(grant, async () => {
      throw Error('fence_failed');
    }),
  ).rejects.toThrow('fence_failed');
  expect(database.read(resource)?.state).toBe('revoking');
  expect(() => ownership.acquire(resource, second)).toThrow('integration_already_owned');
  await ownership.revoke(grant, async () => {});
  expect(ownership.acquire(resource, second).generation).toBe(2);
});

it('allows credentials only on the owning Hub/process and redacts secure-store errors', async () => {
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = ownership.acquire(resource, first);
  const read = vi.fn(async () => 'private-token');
  const local = new OwnedCredentials(first, ownership, { read });
  const foreign = new OwnedCredentials(second, ownership, { read });
  await expect(foreign.use(grant, async () => 'unreachable')).rejects.toThrow(
    'integration_credentials_wrong_owner',
  );
  expect(read).not.toHaveBeenCalled();
  await expect(local.use(grant, async (secret) => secret.length)).resolves.toBe(13);
  expect(JSON.stringify(database.read(resource))).not.toContain('private-token');
  read.mockRejectedValueOnce(Error('private-token'));
  await expect(local.use(grant, async () => 1)).rejects.toThrow(
    'integration_credentials_unavailable',
  );
});

it('does not dispatch a provider operation if ownership is revoked during secure-store access', async () => {
  const ownership = new SessionOwnership(new SessionDatabase());
  const grant = ownership.acquire(resource, first);
  let unlock = (_secret: string) => {};
  const local = new OwnedCredentials(first, ownership, {
    read: () =>
      new Promise<string>((resolve) => {
        unlock = resolve;
      }),
  });
  const operation = vi.fn(async (_secret: string) => 'done');
  const pending = local.use(grant, operation);
  await ownership.revoke(grant, async () => {});
  unlock('secret');
  await expect(pending).rejects.toThrow('integration_owner_unavailable');
  expect(operation).not.toHaveBeenCalled();
});

it('retains the same owner through explicit reauthorization and never treats it as takeover permission', () => {
  const ownership = new SessionOwnership(new SessionDatabase());
  const grant = ownership.acquire(resource, first);
  ownership.requireReauthorization(grant);
  expect(() => ownership.assert(grant)).toThrow('integration_owner_unavailable');
  expect(() => ownership.acquire(resource, second)).toThrow('integration_already_owned');
  ownership.reconnect(grant);
  ownership.connected(grant);
  expect(() => ownership.assert(grant)).not.toThrow();
});
