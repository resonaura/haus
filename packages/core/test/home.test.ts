/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { Home } from '../src/home.js';
import {
  Identities,
  type HomeAdapter,
  type HomeEvent,
  type HomeSnapshot,
  type SourceRef,
} from '../src/types.js';

function adapter(id: string): HomeAdapter & {
  emit: (event: Partial<HomeEvent> & { kind: 'availability' }) => void;
  read: HomeSnapshot;
} {
  const listeners = new Set<(event: HomeEvent) => void>();
  const read: HomeSnapshot = {
    schema: 'haus.home',
    version: 1,
    homeId: 'house',
    revision: '1',
    rooms: [],
    devices: [
      {
        id: `${id}-device`,
        source: { instanceId: id, externalId: 'physical' },
        name: 'Lamp',
        availability: 'online',
      },
    ],
    endpoints: [
      {
        id: `${id}-switch`,
        source: { instanceId: id, externalId: 'outlet' },
        deviceId: `${id}-device`,
        name: 'Power',
        kind: 'switch',
        availability: 'online',
        capabilities: [{ id: 'power', kind: 'power', readable: true, operations: ['on', 'off'] }],
        readings: { power: { value: true, freshness: 'live' } },
      },
    ],
  };
  return {
    id,
    read,
    features: new Set(['devices', 'commands', 'events']),
    snapshot: async () => read,
    execute: vi.fn(async () => ({ status: 'accepted' as const })),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: vi.fn(),
    emit(event) {
      for (const listener of listeners)
        listener({
          schema: 'haus.event',
          version: 1,
          sourceId: id,
          epoch: 'session',
          sequence: 1,
          availability: 'offline',
          ...event,
        } as HomeEvent);
    },
  };
}
it('keeps independent sources alive and ignores stale source events', async () => {
  const home = new Home('house'),
    one = adapter('automation'),
    two = adapter('camera');
  home.add(one);
  home.add(two);
  await Promise.all([home.connect(one.id), home.connect(two.id)]);
  one.emit({ kind: 'availability', sequence: 2, availability: 'offline' });
  one.emit({ kind: 'availability', sequence: 1, availability: 'online' });
  one.emit({
    kind: 'availability',
    epoch: 'replaced-session',
    sequence: 3,
    availability: 'online',
  });
  expect(home.snapshot().devices.map((device) => device.availability)).toEqual([
    'offline',
    'online',
  ]);
  expect(home.snapshot().endpoints[0].readings.power.freshness).toBe('cached');
  await expect(
    home.execute({
      id: 'request',
      endpointId: 'automation-switch',
      capabilityId: 'power',
      operation: 'on',
      arguments: {},
    }),
  ).rejects.toThrow('offline');
  await home.execute({
    id: 'request-two',
    endpointId: 'camera-switch',
    capabilityId: 'power',
    operation: 'off',
    arguments: {},
  });
  expect(two.execute).toHaveBeenCalledTimes(1);
  await expect(
    home.execute({
      id: 'request-three',
      endpointId: 'camera-switch',
      capabilityId: 'power',
      operation: 'erase',
      arguments: {},
    }),
  ).rejects.toThrow('unsupported_operation');
  home.close();
});
it('retains persistent source identities and does not merge matching labels or external keys across sources', () => {
  const records = new Map<string, string>();
  let sequence = 0;
  const key = (source: SourceRef) => JSON.stringify(source);
  const store = {
    get: (source: SourceRef) => records.get(key(source)),
    putIfAbsent(source: SourceRef, id: string) {
      if (!records.has(key(source))) records.set(key(source), id);
      return records.get(key(source))!;
    },
  };
  const first = new Identities(store, () => String(++sequence));
  const a = first.resolve({ instanceId: 'one', externalId: 'device' });
  const second = new Identities(store, () => String(++sequence));
  expect(second.resolve({ instanceId: 'one', externalId: 'device' })).toBe(a);
  expect(second.resolve({ instanceId: 'two', externalId: 'device' })).not.toBe(a);
});
it('refuses a source snapshot that claims another sources device identity', async () => {
  const home = new Home('house'),
    one = adapter('one'),
    two = adapter('two');
  home.add(one);
  home.add(two);
  await home.connect('one');
  two.read.devices[0].id = 'one-device';
  await expect(home.connect('two')).rejects.toThrow('duplicate_home_identity');
  home.close();
});
