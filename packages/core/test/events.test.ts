/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { Home } from '../src/home.js';
import type { HomeAdapter, HomeEvent, HomeSnapshot, ProviderSession } from '../src/types.js';

class Provider implements HomeAdapter {
  readonly features = new Set(['devices', 'events', 'commands'] as const);
  readonly callbacks: ((event: HomeEvent) => void)[] = [];
  readonly read: HomeSnapshot;
  constructor(readonly id: string) {
    this.read = {
      schema: 'haus.home',
      version: 1,
      homeId: 'house',
      revision: '1',
      rooms: [],
      devices: [
        {
          id: `${id}-device`,
          source: { instanceId: id, externalId: 'serial' },
          name: 'Same device name',
          availability: 'online',
        },
      ],
      endpoints: [
        {
          id: `${id}-endpoint`,
          source: { instanceId: id, externalId: 'state' },
          deviceId: `${id}-device`,
          name: 'State',
          kind: 'sensor',
          availability: 'online',
          capabilities: [],
          readings: { value: { value: 1, freshness: 'live' } },
        },
      ],
    };
  }
  snapshot = vi.fn(async () => this.read);
  execute = vi.fn(async () => ({ status: 'accepted' as const }));
  subscribe(callback: (event: HomeEvent) => void) {
    this.callbacks.push(callback);
    return () => {};
  }
  close() {}
  emit(event: HomeEvent) {
    this.callbacks.at(-1)?.(event);
  }
}

const session: ProviderSession = {
  epoch: 'current-connection',
  generation: 3,
  owner: { hubId: 'hub', processId: 'boot' },
};
function event(
  sourceId: string,
  sequence: number,
  binding = session,
): Extract<HomeEvent, { version: 2; kind: 'availability' }> {
  return {
    schema: 'haus.event',
    version: 2,
    homeId: 'house',
    sourceId,
    sequence,
    epoch: binding.epoch,
    owner: binding.owner,
    ownerGeneration: binding.generation,
    kind: 'availability',
    availability: 'offline',
  };
}

it('pins owner/session/generation and rejects stale events and protocol downgrade', async () => {
  const home = new Home('house'),
    provider = new Provider('integration'),
    camera = new Provider('camera');
  home.add(provider);
  home.add(camera);
  await home.connect(provider.id, session);
  await home.connect(camera.id);
  const valid = event(provider.id, 4);
  const invalid: HomeEvent[] = [
    { ...valid, version: 1 },
    { ...valid, homeId: 'foreign-house' },
    { ...valid, epoch: 'old-connection' },
    { ...valid, ownerGeneration: 2 },
    { ...valid, ownerGeneration: 4 },
    { ...valid, owner: { hubId: 'other', processId: 'boot' } },
    { ...valid, owner: { hubId: 'hub', processId: 'old-boot' } },
  ];
  for (const item of invalid) provider.emit(item);
  expect(home.snapshot().devices.map((device) => device.availability)).toEqual([
    'online',
    'online',
  ]);
  provider.emit(valid);
  expect(home.snapshot().devices.map((device) => device.availability)).toEqual([
    'offline',
    'online',
  ]);
  const restore: HomeEvent = { ...valid, sequence: 5, kind: 'snapshot', snapshot: provider.read };
  provider.emit({ ...restore, sequence: 3 });
  provider.emit({ ...restore, sequence: 4 });
  expect(home.snapshot().devices[0].availability).toBe('offline');
  provider.emit(restore);
  expect(home.snapshot().devices[0].availability).toBe('online');
  home.close();
});

it('fences callbacks from replaced subscriptions and refuses an older owner binding', async () => {
  const home = new Home('house'),
    provider = new Provider('integration');
  home.add(provider);
  await home.connect(provider.id, session);
  const old = provider.callbacks[0];
  const replacement = {
    ...session,
    generation: 4,
    epoch: 'replacement',
    owner: { hubId: 'other', processId: 'new-boot' },
  };
  await home.connect(provider.id, replacement);
  old(event(provider.id, 99));
  provider.emit(event(provider.id, 100));
  expect(home.snapshot().devices[0].availability).toBe('online');
  await expect(home.connect(provider.id, session)).rejects.toThrow('stale_provider_owner');
  provider.emit(event(provider.id, 1, replacement));
  expect(home.snapshot().devices[0].availability).toBe('offline');
  // Reconnecting without a new handshake retains the pinned owner rather than accepting v1.
  await home.connect(provider.id);
  provider.emit({ ...event(provider.id, 2, replacement), version: 1 });
  expect(home.snapshot().devices[0].availability).toBe('online');
  home.close();
});

it('keeps a newer streamed snapshot when the older bootstrap request fails', async () => {
  const home = new Home('house'),
    provider = new Provider('integration');
  home.add(provider);
  let fail = (_error: Error) => {};
  provider.snapshot.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const connecting = home.connect(provider.id, session);
  provider.emit({ ...event(provider.id, 1), kind: 'snapshot', snapshot: provider.read });
  fail(Error('bootstrap_failed'));
  await expect(connecting).resolves.toBeUndefined();
  expect(home.snapshot().devices[0].availability).toBe('online');
  home.close();
});

it('retains a snapshot emitted synchronously while subscribing even if bootstrap fails', async () => {
  const home = new Home('house'),
    provider = new Provider('integration');
  home.add(provider);
  vi.spyOn(provider, 'subscribe').mockImplementationOnce((callback) => {
    callback({ ...event(provider.id, 1), kind: 'snapshot', snapshot: provider.read });
    return () => {};
  });
  provider.snapshot.mockRejectedValueOnce(Error('bootstrap_failed'));
  await home.connect(provider.id, session);
  expect(home.snapshot().devices[0].availability).toBe('online');
  home.close();
});

it.each(['online', 'offline'] as const)(
  'loads bootstrap inventory while preserving a newer %s availability event',
  async (availability) => {
    const home = new Home('house'),
      provider = new Provider('integration');
    home.add(provider);
    vi.spyOn(provider, 'subscribe').mockImplementationOnce((callback) => {
      callback({ ...event(provider.id, 1), availability });
      return () => {};
    });
    await home.connect(provider.id, session);
    expect(home.snapshot().devices[0].availability).toBe(availability);
    expect(home.snapshot().endpoints[0].readings.value.freshness).toBe(
      availability === 'online' ? 'live' : 'cached',
    );
    home.close();
  },
);

it('rejects endpoints that claim a device outside their source snapshot', async () => {
  const home = new Home('house'),
    provider = new Provider('integration');
  home.add(provider);
  provider.read.endpoints[0].deviceId = 'foreign-device';
  await expect(home.connect(provider.id, session)).rejects.toThrow(
    'invalid_endpoint_device_ownership',
  );
  home.close();
});
