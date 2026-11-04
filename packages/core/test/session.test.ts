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
  await expect(b.acquire(resource, { ...first, processId: 'restarted-process' })).rejects.toThrow(
    'integration_already_owned',
  );
  expect((await database.read(resource))?.generation).toBe(1);
});

it('keeps an unreachable owner reserved until fencing succeeds and invalidates old grants', async () => {
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = await ownership.acquire(resource, first);
  await ownership.connected(grant);
  let finish = () => {};
  const fence = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const revocation = ownership.revoke(grant, fence);
  expect((await database.read(resource))?.state).toBe('revoking');
  await expect(ownership.assert(grant)).rejects.toThrow('integration_owner_unavailable');
  await expect(ownership.acquire(resource, second)).rejects.toThrow('integration_already_owned');
  expect(ownership.revoke(grant, fence)).toBe(revocation);
  await vi.waitFor(() => expect(fence).toHaveBeenCalledTimes(1));
  finish();
  await revocation;
  const replacement = await ownership.acquire(resource, second);
  expect(replacement.generation).toBe(2);
  await ownership.connected(replacement);
  await expect(ownership.connected(grant)).rejects.toThrow('integration_owner_unavailable');
  await expect(ownership.assert(grant)).rejects.toThrow('integration_owner_unavailable');
  expect(fence).toHaveBeenCalledTimes(1);
});

it('keeps failed fencing blocked and requires an explicit retry of verified cleanup', async () => {
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = await ownership.acquire(resource, first);
  await expect(
    ownership.revoke(grant, async () => {
      throw Error('fence_failed');
    }),
  ).rejects.toThrow('fence_failed');
  expect((await database.read(resource))?.state).toBe('revoking');
  await expect(ownership.acquire(resource, second)).rejects.toThrow('integration_already_owned');
  await ownership.revoke(grant, async () => {});
  expect((await ownership.acquire(resource, second)).generation).toBe(2);
});

it('allows credentials only on the owning Hub/process and redacts secure-store errors', async () => {
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = await ownership.acquire(resource, first);
  const read = vi.fn(async () => 'private-token');
  const local = new OwnedCredentials(first, ownership, { read });
  const foreign = new OwnedCredentials(second, ownership, { read });
  await expect(foreign.use(grant, async () => 'unreachable')).rejects.toThrow(
    'integration_credentials_wrong_owner',
  );
  expect(read).not.toHaveBeenCalled();
  await expect(local.use(grant, async (secret) => secret.length)).resolves.toBe(13);
  expect(JSON.stringify(await database.read(resource))).not.toContain('private-token');
  read.mockRejectedValueOnce(Error('private-token'));
  await expect(local.use(grant, async () => 1)).rejects.toThrow(
    'integration_credentials_unavailable',
  );
});

it('does not dispatch a provider operation if ownership is revoked during secure-store access', async () => {
  const ownership = new SessionOwnership(new SessionDatabase());
  const grant = await ownership.acquire(resource, first);
  let unlock = (_secret: string) => {};
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        unlock = resolve;
      }),
  );
  const local = new OwnedCredentials(first, ownership, { read });
  const operation = vi.fn(async (_secret: string) => 'done');
  const pending = local.use(grant, operation);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await ownership.revoke(grant, async () => {});
  unlock('secret');
  await expect(pending).rejects.toThrow('integration_owner_unavailable');
  expect(operation).not.toHaveBeenCalled();
});

it('retains the same owner through explicit reauthorization and never treats it as takeover permission', async () => {
  const ownership = new SessionOwnership(new SessionDatabase());
  const grant = await ownership.acquire(resource, first);
  await ownership.requireReauthorization(grant);
  await expect(ownership.assert(grant)).rejects.toThrow('integration_owner_unavailable');
  await expect(ownership.acquire(resource, second)).rejects.toThrow('integration_already_owned');
  await ownership.reconnect(grant);
  await ownership.connected(grant);
  await expect(ownership.assert(grant)).resolves.toBeUndefined();
});
