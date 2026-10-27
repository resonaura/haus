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
