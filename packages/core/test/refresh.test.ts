/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { SessionOwnership, TokenRefresh } from '../src/session/index.js';
import type { IntegrationRef, RefreshProvider, RefreshResult } from '../src/session/types.js';
import { SessionDatabase } from './fixtures/session.js';
import { RefreshDatabase } from './fixtures/refresh.js';

async function setup() {
  const resource: IntegrationRef = { homeId: 'house', kind: 'integration', id: 'account' };
  const database = new SessionDatabase(),
    ownership = new SessionOwnership(database);
  const grant = await ownership.acquire(resource, { hubId: 'hub', processId: 'boot' });
  await ownership.connected(grant);
  const vault = new RefreshDatabase(ownership);
  let finish = (_result: RefreshResult<string>) => {};
  const provider: RefreshProvider<string> = {
    refresh: vi.fn(
      () =>
        new Promise<RefreshResult<string>>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  let sequence = 0;
  const allocate = () => `attempt-${++sequence}`;
  const refresh = new TokenRefresh(ownership, vault, provider, allocate, 1000);
  return {
    resource,
    database,
    ownership,
    grant,
    vault,
    provider,
    allocate,
    refresh,
    finish: (result: RefreshResult<string>) => finish(result),
  };
}

it('coalesces concurrent refreshes and commits one replacement before making it usable', async () => {
  const test = await setup();
  const a = test.refresh.refresh(test.grant),
    b = test.refresh.refresh(test.grant);
  expect(a).toBe(b);
  await vi.waitFor(() => expect(test.provider.refresh).toHaveBeenCalledTimes(1));
  expect(test.vault.state).toBe('pending');
  test.finish({ status: 'renewed', credential: 'replacement-private-token' });
  await a;
  expect(test.vault.state).toBe('ready');
  expect(test.vault.credential).toBe('replacement-private-token');
  expect((await test.database.read(test.resource))?.state).toBe('connected');
});

it('uses the durable marker to deny a second service or restarted refresher', async () => {
  const test = await setup();
  const a = test.refresh.refresh(test.grant);
  await vi.waitFor(() => expect(test.provider.refresh).toHaveBeenCalledTimes(1));
  const restarted = new TokenRefresh(test.ownership, test.vault, test.provider, test.allocate);
  await expect(restarted.refresh(test.grant)).rejects.toMatchObject({ code: 'refresh_busy' });
  expect(test.provider.refresh).toHaveBeenCalledTimes(1);
  test.finish({ status: 'renewed', credential: 'replacement' });
  await a;
});

it('blocks a timed-out rotating token and never commits its late response', async () => {
  vi.useFakeTimers();
  try {
    const test = await setup();
    const pending = test.refresh.refresh(test.grant);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'refresh_unknown' });
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    expect(test.vault.state).toBe('blocked');
    expect((await test.database.read(test.resource))?.state).toBe('reauth-required');
    test.finish({ status: 'renewed', credential: 'late-private-token' });
    await Promise.resolve();
    expect(test.vault.credential).toBe('original-private-token');
    await expect(test.refresh.refresh(test.grant)).rejects.toMatchObject({
      code: 'refresh_owner_changed',
    });
    expect(test.provider.refresh).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('records a rejected session without leaking a provider token or retrying it', async () => {
  const test = await setup();
  vi.mocked(test.provider.refresh).mockRejectedValueOnce(Error('private-provider-token'));
  await expect(test.refresh.refresh(test.grant)).rejects.toMatchObject({
    message: 'refresh_unknown',
  });
  expect(test.vault.state).toBe('blocked');
  expect(JSON.stringify(await test.database.read(test.resource))).not.toContain(
    'private-provider-token',
  );
});

it('requires explicit reauthorization on a definitive provider rejection', async () => {
  const test = await setup();
  vi.mocked(test.provider.refresh).mockResolvedValueOnce({ status: 'reauth-required' });
  await expect(test.refresh.refresh(test.grant)).rejects.toMatchObject({
    code: 'refresh_reauth_required',
  });
  expect((await test.database.read(test.resource))?.state).toBe('reauth-required');
  expect(test.vault.state).toBe('blocked');
});

it('restores reauthorization state from a vault already blocked before process restart', async () => {
  const test = await setup();
  test.vault.state = 'blocked';
  await expect(test.refresh.refresh(test.grant)).rejects.toMatchObject({
    code: 'refresh_reauth_required',
  });
  expect((await test.database.read(test.resource))?.state).toBe('reauth-required');
  expect(test.provider.refresh).not.toHaveBeenCalled();
});

it('does not reuse the token when committing the replacement fails', async () => {
  const test = await setup();
  vi.spyOn(test.vault, 'complete').mockRejectedValueOnce(Error('private-storage-failure'));
  const pending = test.refresh.refresh(test.grant);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'refresh_unknown' });
  await vi.waitFor(() => expect(test.provider.refresh).toHaveBeenCalledTimes(1));
  test.finish({ status: 'renewed', credential: 'replacement' });
  await rejected;
  expect(test.vault.state).toBe('blocked');
  expect(test.vault.credential).toBe('original-private-token');
});

it('leaves a durable pending marker when recovery storage fails', async () => {
  const test = await setup();
  vi.mocked(test.provider.refresh).mockRejectedValueOnce(Error('private-provider-failure'));
  vi.spyOn(test.vault, 'block').mockRejectedValueOnce(Error('private-storage-failure'));
  await expect(test.refresh.refresh(test.grant)).rejects.toMatchObject({
    code: 'refresh_recovery_required',
  });
  expect(test.vault.state).toBe('pending');
  const restarted = new TokenRefresh(test.ownership, test.vault, test.provider, test.allocate);
  await expect(restarted.refresh(test.grant)).rejects.toMatchObject({ code: 'refresh_busy' });
  expect(test.provider.refresh).toHaveBeenCalledTimes(1);
});

it('fences an in-flight refresh before another generation can own the integration', async () => {
  const test = await setup();
  const pending = test.refresh.refresh(test.grant);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'refresh_owner_changed' });
  await vi.waitFor(() => expect(test.provider.refresh).toHaveBeenCalledTimes(1));
  await test.ownership.revoke(test.grant, () => test.refresh.fence(test.grant));
  await rejected;
  const next = await test.ownership.acquire(test.resource, {
    hubId: 'other-hub',
    processId: 'new-boot',
  });
  expect(next.generation).toBe(2);
  test.finish({ status: 'renewed', credential: 'late-private-token' });
  await Promise.resolve();
  expect(test.vault.state).toBe('blocked');
  expect(test.vault.credential).toBe('original-private-token');
});
