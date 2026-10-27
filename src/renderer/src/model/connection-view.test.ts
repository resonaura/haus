import { it, expect } from 'vitest';
import { connectionView, mergeSourceHealth } from './connection-view';
import { createEmptySnapshot } from './empty-home';

it('keeps expiring NVR proofs independent from disconnected Helper observations', () => {
  const direct = [{ id: 'camera.a', available: true, expiresAt: 200 }];
  const helper = [{ id: 'camera.a', available: false, expiresAt: 300 }];
  expect(mergeSourceHealth([helper, direct], 100)).toEqual(direct);
  expect(mergeSourceHealth([helper, direct], 201)).toEqual([]);
  expect(
    mergeSourceHealth([direct, [{ id: 'camera.a', available: true, expiresAt: 400 }]], 100)[0]
      .expiresAt,
  ).toBe(400);
});

it('makes HA-dependent controls unavailable but retains a fresh NVR camera and leaves raw state intact', () => {
  const snapshot = createEmptySnapshot();
  snapshot.states = [
    {
      entity_id: 'light.narnia',
      state: 'on',
      attributes: {},
      last_changed: '2026-10-26T00:00:00Z',
    },
    {
      entity_id: 'camera.side',
      state: 'unavailable',
      attributes: {},
      last_changed: '2026-10-26T00:00:00Z',
    },
    {
      entity_id: 'camera.internal',
      state: 'idle',
      attributes: {},
      last_changed: '2026-10-26T00:00:00Z',
    },
    { entity_id: 'camera.off', state: 'off', attributes: {}, last_changed: '2026-10-26T00:00:00Z' },
    {
      entity_id: 'camera.expired',
      state: 'idle',
      attributes: {},
      last_changed: '2026-10-26T00:00:00Z',
    },
  ];
  const sources = [
    { id: 'camera.side', available: true, expiresAt: 200 },
    { id: 'camera.off', available: true, expiresAt: 200 },
    { id: 'camera.expired', available: true, expiresAt: 99 },
  ];
  const view = connectionView(
    snapshot,
    false,
    sources,
    [{ id: 'camera.side', aliases: ['camera.internal'] }],
    100,
  );
  expect(view.states.map((state) => state.state)).toEqual([
    'unavailable',
    'idle',
    'idle',
    'off',
    'unavailable',
  ]);
  expect(snapshot.states[0].state).toBe('on');
  expect(connectionView(snapshot, true, sources, [], 100)).toBe(snapshot);
  expect(connectionView(snapshot, false, sources, [], 201).states[1].state).toBe('unavailable');
});
