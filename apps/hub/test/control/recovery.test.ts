/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { join } from 'node:path';
import { Integration } from '../../src/control/index.js';
import { openVault } from '../../src/storage/index.js';
import { VaultEntity } from '../../src/storage/vault/entities.js';
import { attach, codec, command, crash, directory, host, resource } from './fixtures.js';

it('resumes a verified closed local session and preserves command digests across process restart', async () => {
  const first = attach(await host());
  await first.integration.signIn('user', 'private-fixture-token');
  first.current().execute.mockRejectedValueOnce(Error('private-lost-ack'));
  const request = { ...command, arguments: { second: 2, first: 1 } };
  const outcome = await first.integration.execute('user', 'intent', request);
  expect(outcome).toMatchObject({ status: 'unknown', reason: 'transport-lost' });
  await first.integration.close();
  await first.host.close();
  const next = attach(await host(directory(first.host)));
  expect(await next.integration.resume('user')).toBe('connected');
  expect(next.recovery.fence).not.toHaveBeenCalled();
  expect(next.current().open).toHaveBeenCalledWith(
    'private-fixture-token',
    expect.any(AbortSignal),
  );
  expect((await next.host.sessions.read(resource))?.generation).toBe(2);
  expect(
    await next.integration.execute('user', 'intent', {
      ...request,
      id: 'new-request',
      arguments: { first: 1, second: 2 },
    }),
  ).toEqual(outcome);
  expect(next.current().execute).not.toHaveBeenCalled();
  await expect(
    next.integration.execute('user', 'intent', { ...request, operation: 'off' }),
  ).rejects.toThrow('command_idempotency_conflict');
  expect(await next.integration.execute('user', 'fresh-intent', request)).toMatchObject({
    status: 'accepted',
  });
});

it('requires trusted local fencing after an interrupted process before rebinding a ready credential', async () => {
  const first = attach(await host());
  await first.integration.signIn('user', 'private-fixture-token');
  const previous = await first.host.sessions.read(resource);
  await crash(first);
  const next = attach(await host(directory(first.host)));
  next.recovery.fence.mockImplementation(async (record, owner) => {
    expect(record).toEqual(previous);
    expect(owner.processId).not.toBe(record.owner.processId);
    expect(first.current().close).toHaveBeenCalledTimes(1);
  });
  expect(await next.integration.resume('user')).toBe('connected');
  expect(next.recovery.fence).toHaveBeenCalledTimes(1);
  expect(next.current().open).toHaveBeenCalledWith(
    'private-fixture-token',
    expect.any(AbortSignal),
  );
});

it('does not reuse an interrupted rotating token even after the old process is verifiably fenced', async () => {
  const first = attach(await host());
  await first.integration.signIn('user', 'private-fixture-token');
  const grant = await first.host.sessions.read(resource);
  if (!grant) throw Error('fixture_grant_missing');
  await first.host.vault(codec).begin(grant, 'interrupted-attempt');
  await crash(first);
  const next = attach(await host(directory(first.host)));
  next.recovery.fence.mockResolvedValue(undefined);
  expect(await next.integration.resume('user')).toBe('reauth-required');
  expect(next.definition.create).not.toHaveBeenCalled();
  expect((await next.host.sessions.read(resource))?.state).toBe('reauth-required');
  await next.integration.disconnect('user');
  const inspection = await openVault(join(directory(next.host), 'local', 'vault.sqlite'));
  try {
    expect(await inspection.manager.count(VaultEntity)).toBe(0);
  } finally {
    await inspection.destroy();
  }
  await next.integration.signIn('user', 'fresh-fixture-token');
  expect(next.current().open).toHaveBeenCalledWith('fresh-fixture-token', expect.any(AbortSignal));
});

it('keeps an unverifiable old process reserved and never opens a replacement transport', async () => {
  const first = attach(await host());
  await first.integration.signIn('user', 'private-fixture-token');
  const owner = first.host.owner;
  await crash(first);
  const next = attach(await host(directory(first.host)));
  await expect(next.integration.resume('user')).rejects.toThrow('integration_recovery_unverified');
  expect(next.definition.create).not.toHaveBeenCalled();
  expect(await next.host.sessions.read(resource)).toMatchObject({
    owner,
    generation: 1,
    state: 'revoking',
  });
  next.recovery.fence.mockResolvedValue(undefined);
  // An interrupted fencing path requires fresh authorization even if its old ciphertext was ready.
  expect(await next.integration.resume('user')).toBe('reauth-required');
  await next.integration.signIn('user', 'fresh-fixture-token');
  expect(next.current().open).toHaveBeenCalledTimes(1);
});

it('does not treat another process on the same live host or a remote Hub as local restart permission', async () => {
  const service = await host(),
    first = attach(service),
    duplicate = attach(service);
  await first.integration.signIn('user', 'fixture-token');
  await expect(duplicate.integration.resume('user')).rejects.toThrow(
    'integration_local_recovery_unavailable',
  );
  expect(duplicate.recovery.fence).not.toHaveBeenCalled();
  const foreign = { ...resource, id: 'remote-provider' };
  await service.ownership.acquire(foreign, { hubId: 'remote-hub', processId: 'remote-process' });
  const remote = attach(service, undefined, foreign);
  await expect(remote.integration.resume('user')).rejects.toThrow(
    'integration_local_recovery_unavailable',
  );
  expect(remote.recovery.fence).not.toHaveBeenCalled();
});

it('rejects a provider from another home before creating its credential store or transport', async () => {
  const test = attach(await host());
  expect(
    () =>
      new Integration(
        test.host,
        { ...test.definition, resource: { ...resource, homeId: 'foreign' } },
        test.permissions,
        test.recovery,
      ),
  ).toThrow('integration_home_mismatch');
  expect(test.definition.create).not.toHaveBeenCalled();
});
