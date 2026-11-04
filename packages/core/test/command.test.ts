/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Commands } from '../src/command/index.js';
import type { CommandPolicy, CommandProvider, CommandRequest } from '../src/command/types.js';
import type { IntegrationRef } from '../src/session/types.js';
import { SessionOwnership } from '../src/session/index.js';
import { SessionDatabase } from './fixtures/session.js';
import { ReceiptDatabase } from './fixtures/command.js';

function setup(operation = 'on') {
  const resource: IntegrationRef = { homeId: 'house', kind: 'integration', id: 'devices' };
  const ownership = new SessionOwnership(new SessionDatabase());
  const grant = ownership.acquire(resource, { hubId: 'hub', processId: 'boot' });
  ownership.connected(grant);
  const journal = new ReceiptDatabase();
  const provider: CommandProvider = {
    resource,
    execute: vi.fn<CommandProvider['execute']>(async () => ({ status: 'accepted' })),
  };
  const policy: CommandPolicy = {
    authorize: vi.fn(async () => true),
    fingerprint: async (intent) =>
      createHmac('sha256', 'fixture-key').update(JSON.stringify(intent)).digest('hex'),
  };
  const request: CommandRequest = {
    actorId: 'user',
    idempotencyKey: 'intent-one',
    grant,
    command: {
      id: 'command-one',
      endpointId: 'device',
      capabilityId: 'power',
      operation,
      arguments: {},
    },
  };
  const create = () => new Commands(ownership, policy, journal, provider, 1000);
  return { ownership, grant, journal, provider, policy, request, create };
}

it.each(['heat', 'unlock', 'toggle', 'move', 'talkback'])(
  'never repeats %s after a lost acknowledgement, even after dispatcher recreation',
  async (operation) => {
    const test = setup(operation);
    vi.mocked(test.provider.execute).mockRejectedValueOnce(Error('private-provider-details'));
    const first = await test.create().execute(test.request);
    expect(first).toMatchObject({ status: 'unknown', reason: 'transport-lost' });
    const replay = await test.create().execute({
      ...test.request,
      command: { ...test.request.command, id: 'new-transport-request' },
    });
    expect(replay).toEqual(first);
    expect(test.provider.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(replay)).not.toContain('private-provider-details');
  },
);

it('coalesces same-dispatcher calls while other instances observe the pending receipt without sending', async () => {
  const test = setup();
  let finish = () => {};
  vi.mocked(test.provider.execute).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ status: 'confirmed', correlationId: 'observed' });
      }),
  );
  const commands = test.create();
  const a = commands.execute(test.request),
    b = commands.execute(test.request);
  await vi.waitFor(() => expect(test.provider.execute).toHaveBeenCalledTimes(1));
  expect(await test.create().execute(test.request)).toMatchObject({
    status: 'unknown',
    reason: 'dispatch-pending',
  });
  finish();
  expect(await a).toEqual(await b);
  expect(await a).toMatchObject({
    status: 'confirmed',
    correlationId: 'observed',
    ownerGeneration: 1,
  });
  expect(test.provider.execute).toHaveBeenCalledTimes(1);
});

it('rejects changed semantics under the same idempotency key and checks actor permissions before replay', async () => {
  const test = setup();
  await test.create().execute(test.request);
  await expect(
    test
      .create()
      .execute({ ...test.request, command: { ...test.request.command, operation: 'off' } }),
  ).rejects.toThrow('command_idempotency_conflict');
  vi.mocked(test.policy.authorize).mockResolvedValueOnce(false);
  await expect(test.create().execute(test.request)).rejects.toThrow('command_permission_denied');
  expect(test.provider.execute).toHaveBeenCalledTimes(1);
});

it('never dispatches if the owner is revoked while persisting the reservation', async () => {
  const test = setup();
  const reserve = test.journal.reserve.bind(test.journal);
  vi.spyOn(test.journal, 'reserve').mockImplementationOnce(async (entry) => {
    const result = await reserve(entry);
    await test.ownership.revoke(test.grant, async () => {});
    return result;
  });
  expect(await test.create().execute(test.request)).toMatchObject({
    status: 'failed',
    reason: 'owner-changed',
  });
  expect(test.provider.execute).not.toHaveBeenCalled();
});

it('binds the grant to the actual provider rather than accepting an unrelated live owner', async () => {
  const test = setup();
  const other = test.ownership.acquire(
    { ...test.provider.resource, id: 'other-source' },
    test.grant.owner,
  );
  test.ownership.connected(other);
  await expect(test.create().execute({ ...test.request, grant: other })).rejects.toThrow(
    'command_provider_owner_mismatch',
  );
  expect(test.provider.execute).not.toHaveBeenCalled();
});

it('rechecks permission after journal I/O and fails without sending when access was revoked', async () => {
  const test = setup();
  vi.mocked(test.policy.authorize).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await test.create().execute(test.request)).toMatchObject({
    status: 'failed',
    reason: 'permission-denied',
  });
  expect(test.provider.execute).not.toHaveBeenCalled();
});

it('returns unknown after timeout, ignores a late confirmation and keeps the receipt replayable', async () => {
  vi.useFakeTimers();
  try {
    const test = setup();
    let finish = () => {};
    vi.mocked(test.provider.execute).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'confirmed' });
        }),
    );
    const pending = test.create().execute(test.request);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ status: 'unknown', reason: 'timeout' });
    finish();
    await Promise.resolve();
    expect(await test.create().execute(test.request)).toMatchObject({
      status: 'unknown',
      reason: 'timeout',
    });
    expect(test.provider.execute).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('retains an unknown reservation if storing the provider result fails', async () => {
  const test = setup();
  vi.spyOn(test.journal, 'settle').mockRejectedValueOnce(Error('private-journal-detail'));
  expect(await test.create().execute(test.request)).toMatchObject({
    status: 'unknown',
    reason: 'journal-unavailable',
  });
  expect(await test.create().execute(test.request)).toMatchObject({
    status: 'unknown',
    reason: 'dispatch-pending',
  });
  expect(test.provider.execute).toHaveBeenCalledTimes(1);
});
