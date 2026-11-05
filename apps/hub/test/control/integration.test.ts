/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { EncryptedVault, openVault } from '../../src/storage/index.js';
import { VaultEntity } from '../../src/storage/vault/entities.js';
import { join } from 'node:path';
import type { RefreshResult } from '@haus/core/session';
import { attach, codec, command, directory, host, resource } from './fixtures.js';

it('checks management/control permission before credentials or provider calls and fails closed', async () => {
  const test = attach(await host());
  test.permissions.authorize.mockResolvedValue(false);
  await expect(test.integration.signIn('user', 'private-fixture-token')).rejects.toThrow(
    'control_permission_denied',
  );
  expect(test.definition.create).not.toHaveBeenCalled();
  expect(await test.host.sessions.read(resource)).toBeUndefined();
  test.permissions.authorize.mockResolvedValue(true);
  await test.integration.signIn('user', 'private-fixture-token');
  test.permissions.authorize.mockRejectedValue(Error('private-permission-details'));
  await expect(test.integration.execute('user', 'intent', command)).rejects.toThrow(
    'command_permission_denied',
  );
  await expect(test.integration.disconnect('user')).rejects.toThrow('control_permission_denied');
  expect(test.current().execute).not.toHaveBeenCalled();
  expect(test.current().close).not.toHaveBeenCalled();
});

it('does not let an unavailable permission lookup hold shutdown or open a delayed provider', async () => {
  const test = attach(await host());
  test.permissions.authorize.mockImplementationOnce(() => new Promise(() => {}));
  const starting = test.integration.signIn('user', 'private-fixture-token');
  const rejected = expect(starting).rejects.toThrow('control_permission_denied');
  await vi.waitFor(() => expect(test.permissions.authorize).toHaveBeenCalledTimes(1));
  await test.integration.close();
  await rejected;
  expect(test.definition.create).not.toHaveBeenCalled();
  expect(await test.host.sessions.read(resource)).toBeUndefined();
});

it('uses newly committed credentials and recreates the transport after explicit sign-in', async () => {
  const test = attach(await host());
  await test.integration.signIn('user', 'original-fixture-token');
  const first = test.current();
  expect(first.open).toHaveBeenCalledWith('original-fixture-token', expect.any(AbortSignal));
  await test.integration.refresh();
  await test.integration.execute('user', 'one', command);
  expect(first.execute).toHaveBeenCalledWith(
    command,
    'replacement-fixture-token',
    expect.any(AbortSignal),
  );
  await test.integration.signIn('user', 'new-sign-in-token');
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(test.current()).not.toBe(first);
  await test.integration.execute('user', 'two', { ...command, id: 'second' });
  expect(test.current().execute).toHaveBeenCalledWith(
    { ...command, id: 'second' },
    'new-sign-in-token',
    expect.any(AbortSignal),
  );
});

it('does not let a replaced provider context read or refresh the new connection credentials', async () => {
  const test = attach(await host());
  await test.integration.signIn('user', 'original-fixture-token');
  const context = test.definition.create.mock.calls[0]?.[0];
  if (!context) throw Error('fixture_context_missing');
  expect(await context.credential()).toBe('original-fixture-token');
  await test.integration.signIn('user', 'new-fixture-token');
  await expect(context.credential()).rejects.toThrow('provider_admission_closed');
  await expect(context.refresh()).rejects.toThrow('provider_admission_closed');
  expect(test.current().refresh).not.toHaveBeenCalled();
});

it('coalesces rotating-token refresh and holds new commands until replacement credentials commit', async () => {
  let finish = (_result: RefreshResult<string>) => {};
  const test = attach(await host(), (provider) =>
    provider.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await test.integration.signIn('user', 'original-fixture-token');
  const refresh = test.integration.refresh();
  expect(test.integration.refresh()).toBe(refresh);
  await vi.waitFor(() => expect(test.current().refresh).toHaveBeenCalledTimes(1));
  const pending = test.integration.execute('user', 'intent', command);
  await Promise.resolve();
  expect(test.current().execute).not.toHaveBeenCalled();
  finish({ status: 'renewed', credential: 'new-fixture-token' });
  await refresh;
  expect(await pending).toMatchObject({ status: 'accepted' });
  expect(test.current().execute).toHaveBeenCalledWith(
    command,
    'new-fixture-token',
    expect.any(AbortSignal),
  );
});

it('drains a refresh on close and leaves its uncertain credential blocked', async () => {
  const test = attach(await host(), (provider) =>
    provider.refresh.mockImplementationOnce(
      (_credential, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Error('private-transport-aborted')), {
            once: true,
          });
        }),
    ),
  );
  await test.integration.signIn('user', 'original-fixture-token');
  const refreshing = test.integration.refresh(),
    rejected = expect(refreshing).rejects.toThrow(/^refresh_/);
  await vi.waitFor(() => expect(test.current().refresh).toHaveBeenCalledTimes(1));
  await test.integration.close();
  await rejected;
  expect((await test.host.sessions.read(resource))?.state).toBe('revoked');
  expect(test.current().close).toHaveBeenCalledTimes(1);
  const inspection = await openVault(join(directory(test.host), 'local', 'vault.sqlite'));
  try {
    expect((await inspection.manager.findOneByOrFail(VaultEntity, { home: 'house' })).state).toBe(
      'blocked',
    );
  } finally {
    await inspection.destroy();
  }
});

it('closes admission while a command is waiting for secure storage, including same-generation reauthorization', async () => {
  const test = attach(await host());
  await test.integration.signIn('user', 'original-fixture-token');
  const first = test.current();
  let finish = (_value: string) => {};
  const read = vi.spyOn(EncryptedVault.prototype, 'read').mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = test.integration.execute('user', 'old-intent', command);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await test.integration.signIn('user', 'new-fixture-token');
  finish('old-delayed-token');
  expect(await pending).toMatchObject({ status: 'unknown' });
  expect(first.execute).not.toHaveBeenCalled();
  expect(test.current().execute).not.toHaveBeenCalled();
  await test.integration.execute('user', 'new-intent', { ...command, id: 'new-command' });
  expect(test.current().execute).toHaveBeenCalledWith(
    { ...command, id: 'new-command' },
    'new-fixture-token',
    expect.any(AbortSignal),
  );
});

it('does not submit a delayed command after the integration has fully closed', async () => {
  const test = attach(await host());
  await test.integration.signIn('user', 'original-fixture-token');
  let finish = (_value: string) => {};
  const read = vi.spyOn(EncryptedVault.prototype, 'read').mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = test.integration.execute('user', 'intent', command);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await test.integration.close();
  finish('old-delayed-token');
  expect(await pending).toMatchObject({ status: 'unknown' });
  expect(test.current().execute).not.toHaveBeenCalled();
  expect((await test.host.sessions.read(resource))?.state).toBe('revoked');
});

it('keeps the owner reserved when a provider cannot drain, then permits an explicit fencing retry', async () => {
  let finish = () => {};
  const test = attach(await host(), (provider) => {
    provider.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'confirmed' });
        }),
    );
  });
  await test.integration.signIn('user', 'fixture-token');
  const result = await test.integration.execute('user', 'intent', command);
  expect(result).toMatchObject({ status: 'unknown', reason: 'timeout' });
  await expect(test.integration.close()).rejects.toThrow('integration_fence_incomplete');
  expect((await test.host.sessions.read(resource))?.state).toBe('revoking');
  const contender = attach(test.host);
  await expect(contender.integration.signIn('user', 'different-token')).rejects.toThrow(
    'integration_already_owned',
  );
  expect(contender.definition.create).not.toHaveBeenCalled();
  finish();
  await test.integration.close();
  await contender.integration.signIn('user', 'different-token');
  expect((await test.host.sessions.read(resource))?.generation).toBe(2);
  expect(await contender.integration.execute('user', 'intent', command)).toEqual(result);
  expect(contender.current().execute).not.toHaveBeenCalled();
});

it('sanitizes a failed provider fence and keeps ownership until an explicit successful retry', async () => {
  const test = attach(await host(), (provider) =>
    provider.close.mockRejectedValueOnce(Error('private-close-details')),
  );
  await test.integration.signIn('user', 'fixture-token');
  await expect(test.integration.close()).rejects.toThrow('integration_fence_incomplete');
  expect((await test.host.sessions.read(resource))?.state).toBe('revoking');
  await test.integration.close();
  expect((await test.host.sessions.read(resource))?.state).toBe('revoked');
});

it('keeps a failed source isolated while a different provider continues working', async () => {
  const service = await host();
  const first = attach(service, (provider) =>
    provider.open.mockRejectedValueOnce(Error('private-open-details')),
  );
  const second = attach(service, undefined, { ...resource, id: 'other-provider' });
  await expect(first.integration.signIn('user', 'token-one')).rejects.toThrow(
    'integration_connection_failed',
  );
  await second.integration.signIn('user', 'token-two');
  expect(await second.integration.execute('user', 'intent', command)).toMatchObject({
    status: 'accepted',
  });
  expect((await service.sessions.read(resource))?.state).toBe('reauth-required');
  expect((await service.sessions.read(second.integration.resource))?.state).toBe('connected');
});

it('removes stored credentials on explicit disconnect and requires a fresh sign-in', async () => {
  const test = attach(await host());
  await test.integration.signIn('user', 'fixture-token');
  await test.integration.disconnect('user');
  expect((await test.host.sessions.read(resource))?.state).toBe('revoked');
  await expect(test.host.vault(codec).read(resource)).rejects.toThrow(
    'integration_owner_unavailable',
  );
  await test.integration.signIn('user', 'new-fixture-token');
  expect((await test.host.sessions.read(resource))?.generation).toBe(2);
  expect(await test.integration.execute('user', 'intent', command)).toMatchObject({
    status: 'accepted',
  });
});

it('serializes sign-in and close so a delayed startup cannot reconnect after shutdown', async () => {
  const test = attach(await host(), (provider) =>
    provider.open.mockImplementationOnce(
      (_credential, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Error('startup_aborted')), { once: true });
        }),
    ),
  );
  const starting = test.integration.signIn('user', 'fixture-token');
  const rejected = expect(starting).rejects.toThrow('integration_connection_failed');
  await vi.waitFor(() => expect(test.current().open).toHaveBeenCalledTimes(1));
  await test.integration.close();
  await rejected;
  expect((await test.host.sessions.read(resource))?.state).toBe('revoked');
  await expect(test.integration.signIn('user', 'new-token')).rejects.toThrow('integration_closed');
  expect(test.providers).toHaveLength(1);
});
