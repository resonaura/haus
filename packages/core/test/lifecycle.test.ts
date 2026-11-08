/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { Service, type Bootstrap } from '../src/lifecycle.js';
it('coalesces startup and closes a late bootstrap exactly once when shutdown wins', async () => {
  let ready!: (value: { close: () => Promise<void> }) => void;
  const close = vi.fn(async () => {}),
    bootstrap = vi.fn(
      () =>
        new Promise<{ close: () => Promise<void> }>((resolve) => {
          ready = resolve;
        }),
    );
  const service = new Service(bootstrap);
  const first = service.start();
  expect(service.start()).toBe(first);
  const rejected = expect(first).rejects.toThrow('service_stopped');
  await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
  const stopped = service.stop();
  expect(service.stop()).toBe(stopped);
  ready({ close });
  await rejected;
  await stopped;
  expect(close).toHaveBeenCalledTimes(1);
  expect(service.state).toBe('closed');
  await expect(service.start()).rejects.toThrow('not_startable');
});
it('releases constructed resources in reverse order when startup fails without replaying startup', async () => {
  const released: number[] = [];
  const bootstrap = vi.fn(
    async ({ scope }: Parameters<ConstructorParameters<typeof Service>[0]>[0]) => {
      scope.defer(() => {
        released.push(1);
      });
      scope.defer(() => {
        released.push(2);
      });
      throw Error('bootstrap_failure');
    },
  );
  const service = new Service(bootstrap);
  await expect(service.start()).rejects.toThrow('bootstrap_failure');
  expect(released).toEqual([2, 1]);
  await service.stop();
  expect(bootstrap).toHaveBeenCalledTimes(1);
});

it('retains failed ownership when shutdown fails and does not replay close on another stop', async () => {
  const failure = Error('shutdown_failure');
  const close = vi.fn(async () => {
    throw failure;
  });
  const service = new Service(async () => ({ close }));
  await service.start();
  await expect(service.stop()).rejects.toBe(failure);
  expect(service.state).toBe('failed');
  await expect(service.stop()).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
});

it('an abort listener joining shutdown cannot create a second closer or return before it', async () => {
  let nested: Promise<void> | undefined;
  const close = vi.fn(async () => {});
  const service = new Service(async ({ signal }) => {
    signal.addEventListener(
      'abort',
      () => {
        nested = service.stop();
      },
      { once: true },
    );
    return { close };
  });
  await service.start();
  const stopping = service.stop();
  await stopping;
  expect(nested).toBe(stopping);
  await nested;
  expect(close).toHaveBeenCalledTimes(1);
});

it('preserves startup and cleanup failures and cannot declare failed cleanup released later', async () => {
  const startup = Error('startup_failure');
  const cleanup = Error('cleanup_failure');
  const close = vi.fn(async () => {
    throw cleanup;
  });
  const bootstrap: Bootstrap = async ({ scope }) => {
    scope.defer(close);
    throw startup;
  };
  const service = new Service(bootstrap);
  const failure = await service.start().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) throw Error('missing combined startup failure');
  expect(failure.errors[0]).toBe(startup);
  const releaseFailure: unknown = failure.errors[1];
  expect(releaseFailure).toBeInstanceOf(AggregateError);
  if (!(releaseFailure instanceof AggregateError)) throw Error('missing cleanup failure');
  expect(releaseFailure.errors).toEqual([cleanup]);
  await expect(service.stop()).rejects.toBe(failure);
  expect(service.state).toBe('failed');
  expect(close).toHaveBeenCalledTimes(1);
});

it('a cancelled late bootstrap that fails to close remains failed rather than released', async () => {
  let ready!: (service: { close(): Promise<void> }) => void;
  const closeFailure = Error('late_close_failure');
  const close = vi.fn(async () => {
    throw closeFailure;
  });
  const bootstrap = vi.fn(
    () =>
      new Promise<{ close(): Promise<void> }>((resolve) => {
        ready = resolve;
      }),
  );
  const service = new Service(bootstrap);
  const starting = service.start();
  const rejected = expect(starting).rejects.toBe(closeFailure);
  await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
  const stopping = service.stop();
  const stopped = expect(stopping).rejects.toBe(closeFailure);
  ready({ close });
  await Promise.all([rejected, stopped]);
  expect(service.state).toBe('failed');
  expect(close).toHaveBeenCalledTimes(1);
});
