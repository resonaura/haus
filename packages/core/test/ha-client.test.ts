/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it, vi } from 'vitest';
import {
  HomeAssistantClient,
  HaClientError,
  type HaTransport,
  type HaConnectionState,
  type HaMessage,
} from '../src/ha-client.js';
import type { HassEntity } from '../src/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let state: (value: HaConnectionState) => void = () => undefined;
  let entities: (value: readonly HassEntity[]) => void = () => undefined;
  const requests: HaMessage[] = [];
  const response = deferred<unknown>();
  const transport: HaTransport = {
    connected: true,
    close: vi.fn(),
    async request<T>(message: HaMessage) {
      requests.push(message);
      return (await response.promise) as T;
    },
    watchState(callback) {
      state = callback;
      return vi.fn();
    },
    watchEntities(callback) {
      entities = callback;
      return vi.fn();
    },
  };
  const observer = { state: vi.fn(), entities: vi.fn(), authRequired: vi.fn() };
  const client = new HomeAssistantClient(async () => transport, observer);
  return {
    client,
    transport,
    observer,
    requests,
    response,
    state: (value: HaConnectionState) => state(value),
    entities: (value: readonly HassEntity[]) => entities(value),
  };
}
const action = { domain: 'light', service: 'turn_off', target: { entity_id: 'light.fixture' } };

it('rejects queued physical intent after disconnect/reconnect instead of replaying it', async () => {
  const f = fixture();
  await f.client.connect('home');
  const first = f.client.callService(action);
  const second = f.client.callService({ ...action, service: 'turn_on' });
  const rejected = expect(second).rejects.toMatchObject({ code: 'offline' });
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.state('reconnecting');
  f.state('connected');
  f.response.resolve({});
  await first;
  await rejected;
  expect(f.requests).toHaveLength(1);
  f.client.disconnect();
});

it('drops stale home opens, state callbacks and queued actions after a home switch', async () => {
  const old = deferred<HaTransport>();
  const f = fixture();
  const client = new HomeAssistantClient(
    (id) => (id === 'old' ? old.promise : Promise.resolve(f.transport)),
    f.observer,
  );
  const opening = client.connect('old');
  await client.connect('new');
  const oldTransport = fixture().transport;
  old.resolve(oldTransport);
  await opening;
  expect(oldTransport.close).toHaveBeenCalledOnce();
  f.entities([]);
  expect(f.observer.entities).toHaveBeenLastCalledWith('new', []);
  client.disconnect();
  f.entities([]);
  f.state('connected');
  expect(f.observer.state).toHaveBeenLastCalledWith('new', 'disconnected');
  expect(f.observer.entities).toHaveBeenCalledTimes(1);
});

it('fences in-flight results and never exposes errors or auth from a different session', async () => {
  const f = fixture();
  await f.client.connect('home');
  const sent = f.client.callService(action);
  const rejected = expect(sent).rejects.toMatchObject({ code: 'session-changed' });
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  f.client.disconnect();
  f.response.resolve({ context: { id: 'old' } });
  await rejected;
  await expect(f.client.callService(action)).rejects.toMatchObject({ code: 'offline' });
});

it('invalid auth closes the transport and notifies the secure session adapter once', async () => {
  const f = fixture();
  await f.client.connect('home');
  f.state('auth-required');
  f.state('auth-required');
  expect(f.transport.close).toHaveBeenCalledOnce();
  expect(f.observer.authRequired).toHaveBeenCalledExactlyOnceWith('home');
  await expect(f.client.callService(action)).rejects.toMatchObject({ code: 'offline' });
  const observer = { state: vi.fn(), entities: vi.fn(), authRequired: vi.fn() };
  const denied = new HomeAssistantClient(async () => {
    throw new HaClientError('auth-required');
  }, observer);
  await expect(denied.connect('home')).rejects.toMatchObject({ code: 'auth-required' });
  expect(observer.authRequired).toHaveBeenCalledExactlyOnceWith('home');
});
