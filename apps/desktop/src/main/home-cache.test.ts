/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, it, expect, vi } from 'vitest';
import { HomeCache, homeCacheScope } from './home-cache';
import { createDemoSnapshot } from '../renderer/src/model/demo';

afterEach(() => vi.useRealTimers());

it('stores only complete successful home reads, coalesces event writes and rejects another session or expired context', async () => {
  vi.useFakeTimers();
  let scope = 'home-a',
    saved: unknown;
  const store = {
    saveHomeCache: vi.fn(async (value: unknown) => {
      saved = structuredClone(value);
    }),
    loadHomeCache: async () => saved,
  };
  const cache = new HomeCache(store, () => scope);
  const snapshot = createDemoSnapshot();
  const documents = {
    get_states: snapshot.states,
    get_services: snapshot.services,
    get_config: snapshot.config,
    'auth/current_user': snapshot.user,
    'config/area_registry/list': snapshot.areas,
    'config/device_registry/list': snapshot.devices,
    'config/entity_registry/list': snapshot.entities,
  };
  try {
    cache.record('get_states', snapshot.states);
    cache.record('call_service', { privateCommand: 'never cache commands' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.saveHomeCache).not.toHaveBeenCalled();
    for (const [type, value] of Object.entries(documents)) cache.record(type, value);
    await vi.advanceTimersByTimeAsync(500);
    expect(store.saveHomeCache).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ schema: 'haus.snapshot', version: 1, scope: 'home-a' });
    expect(await cache.load()).toMatchObject({ snapshot });
    expect(JSON.stringify(saved)).not.toContain('never cache commands');
    const state = snapshot.states[0];
    cache.state({ entity_id: state.entity_id, new_state: { ...state, state: 'off' } });
    cache.state({ entity_id: state.entity_id, new_state: { ...state, state: 'on' } });
    await vi.advanceTimersByTimeAsync(30000);
    expect(store.saveHomeCache).toHaveBeenCalledTimes(2);
    expect(
      (await cache.load())?.snapshot.states.find((item) => item.entity_id === state.entity_id)
        ?.state,
    ).toBe('on');
    scope = 'home-b';
    expect(await cache.load()).toBeNull();
    scope = 'home-a';
    await vi.advanceTimersByTimeAsync(8 * 86400000);
    expect(await cache.load()).toBeNull();
    cache.record('get_states', snapshot.states);
    cache.reset();
    await vi.advanceTimersByTimeAsync(500);
    expect(store.saveHomeCache).toHaveBeenCalledTimes(2);
  } finally {
    cache.reset();
  }
});

it('migrates a valid legacy cache for the current session to the versioned envelope', async () => {
  const snapshot = createDemoSnapshot();
  let saved: unknown = {
    scope: 'home-a',
    capturedAt: Date.now(),
    snapshot,
  };
  const store = {
    loadHomeCache: vi.fn(async () => saved),
    saveHomeCache: vi.fn(async (value: unknown) => {
      saved = structuredClone(value);
    }),
  };
  const cache = new HomeCache(store, () => 'home-a');

  expect(await cache.load()).toMatchObject({ snapshot });
  expect(store.saveHomeCache).toHaveBeenCalledOnce();
  expect(saved).toMatchObject({ schema: 'haus.snapshot', version: 1, scope: 'home-a' });
  cache.reset();
});

it('does not migrate unsupported data or a legacy cache after the session changes during read', async () => {
  const snapshot = createDemoSnapshot();
  let scope = 'home-a';
  let release: (value: unknown) => void = () => {};
  const store = {
    loadHomeCache: vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          release = resolve;
        }),
    ),
    saveHomeCache: vi.fn(async () => {}),
  };
  const cache = new HomeCache(store, () => scope);
  const pending = cache.load();
  scope = 'home-b';
  release({ scope: 'home-a', capturedAt: Date.now(), snapshot });
  expect(await pending).toBeNull();
  expect(store.saveHomeCache).not.toHaveBeenCalled();

  const unsupported = new HomeCache(
    {
      loadHomeCache: async () => ({
        schema: 'haus.snapshot',
        version: 2,
        scope: 'home-b',
        capturedAt: Date.now(),
        snapshot,
      }),
      saveHomeCache: vi.fn(async () => {}),
    },
    () => scope,
  );
  expect(await unsupported.load()).toBeNull();
  unsupported.reset();
  cache.reset();
});

it('binds cached home/grant authorization to the account session even at the same server URL', () => {
  const a = {
    url: 'https://home.fixture',
    name: 'Home',
    clientId: 'client',
    refreshToken: 'private-a',
  };
  expect(homeCacheScope(a)).toBe(homeCacheScope({ ...a, name: 'Renamed home' }));
  expect(homeCacheScope(a)).not.toBe(homeCacheScope({ ...a, refreshToken: 'private-b' }));
  expect(homeCacheScope(a)).not.toContain('private');
});
