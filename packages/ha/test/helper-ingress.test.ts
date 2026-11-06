/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it, vi } from 'vitest';
import { HaIngressHelperPort } from '../src/helper-ingress';
import type { HaMessage } from '../src/ha-client';

function fixture(ingress = '/api/hassio_ingress/private-fixture/') {
  const messages: HaMessage[] = [];
  let sessions = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async () =>
      new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const port = new HaIngressHelperPort({
    homeUrl: 'https://ha.example.test',
    fetch,
    async requestHa<T>(message: HaMessage): Promise<T> {
      messages.push(message);
      let value: unknown;
      if (message.type === 'auth/current_user') value = { id: 'fixture-user' };
      else if (message.endpoint === '/addons')
        value = {
          addons: [
            { slug: 'old_haus-helper', state: 'stopped' },
            { slug: 'new_haus-helper', state: 'started' },
          ],
        };
      else if (message.endpoint === '/addons/new_haus-helper/info')
        value = { state: 'started', ingress: true, ingress_url: ingress };
      else if (message.endpoint === '/ingress/session')
        value = { session: `fixture-${++sessions}` };
      else throw Error('unexpected-test-request');
      return value as T;
    },
  });
  return { port, fetch, messages };
}
const read = { method: 'GET', path: '/api/preferences' } as const;

it('uses the running Helper and shares one user-bound ingress session across simultaneous reads', async () => {
  const { port, fetch, messages } = fixture();
  await Promise.all([port.request(read), port.request(read)]);
  expect(messages.filter((message) => message.endpoint === '/ingress/session')).toEqual([
    {
      type: 'supervisor/api',
      endpoint: '/ingress/session',
      method: 'post',
      data: { user_id: 'fixture-user' },
    },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toBe(
    'https://ha.example.test/api/hassio_ingress/private-fixture/api/preferences',
  );
  expect(init).toMatchObject({
    redirect: 'error',
    headers: {
      Cookie: 'ingress_session=fixture-1',
      'X-Haus-Client': '1',
    },
  });
  port.dispose();
});

it('never sends the ingress session to an absolute or malformed URL from HA metadata', async () => {
  for (const url of [
    'https://other.test/ingress/',
    '//other.test/ingress/',
    '/api/hassio_ingress/key/../other',
  ]) {
    const { port, fetch } = fixture(url);
    await expect(port.request(read)).rejects.toThrow('helper-ingress-unavailable');
    expect(fetch).not.toHaveBeenCalled();
    port.dispose();
  }
});

it('renews a failed ingress read once without replaying a write', async () => {
  const { port, fetch, messages } = fixture();
  fetch.mockResolvedValueOnce(new Response('Gateway', { status: 403 }));
  await port.request(read);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(messages.filter((message) => message.endpoint === '/ingress/session')).toHaveLength(2);
  fetch.mockResolvedValueOnce(
    new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
  );
  await expect(
    port.request({
      method: 'PATCH',
      path: '/api/preferences',
      data: {
        baseRevision: 'fixture',
        patch: { favorites: [] },
      },
    }),
  ).rejects.toThrow('helper-request-failed');
  expect(fetch).toHaveBeenCalledTimes(3);
  port.dispose();
});

it('invalidates in-flight replies and future requests when a home closes', async () => {
  const { port, fetch } = fixture();
  let respond!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const pending = port.request(read);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signal = fetch.mock.calls[0]![1]!.signal!;
  port.dispose();
  expect(signal.aborted).toBe(true);
  respond(new Response('{}'));
  await expect(pending).rejects.toThrow('session-changed');
  await expect(port.request(read)).rejects.toThrow('session-changed');
});

it('bounds a stalled ingress bootstrap without waiting for all HA requests to finish', async () => {
  vi.useFakeTimers();
  try {
    const port = new HaIngressHelperPort({
      homeUrl: 'https://ha.example.test',
      fetch: vi.fn(),
      requestHa: () => new Promise(() => {}),
    });
    const result = expect(port.request(read)).rejects.toThrow('helper-timeout');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    port.dispose();
  } finally {
    vi.useRealTimers();
  }
});
