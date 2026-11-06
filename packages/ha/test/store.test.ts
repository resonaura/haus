/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import type { HaConnectionState, HaMessage, HaTransport } from '@haus/ha/ha-client';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { createHausHomeStore } from '../src/store.js';

class TestTransport implements HaTransport {
  connected = true;
  readonly requests: HaMessage[] = [];
  failure: unknown;
  private readonly stateListeners = new Set<(state: HaConnectionState) => void>();
  private readonly entityListeners = new Set<(entities: readonly HassEntity[]) => void>();

  close(): void {
    this.connected = false;
    for (const listener of this.stateListeners) listener('disconnected');
  }
  request<T>(message: HaMessage): Promise<T> {
    if (!this.connected) return Promise.reject(new Error('offline'));
    this.requests.push(message);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve({ context: { id: 'test-context' } } as T);
  }
  watchState(callback: (state: HaConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    return () => {
      this.stateListeners.delete(callback);
    };
  }
  watchEntities(callback: (entities: readonly HassEntity[]) => void): () => void {
    this.entityListeners.add(callback);
    return () => {
      this.entityListeners.delete(callback);
    };
  }
  emitState(state: HaConnectionState): void {
    this.connected = state === 'connected';
    for (const listener of this.stateListeners) listener(state);
  }
  emitEntities(entities: readonly HassEntity[]): void {
    for (const listener of this.entityListeners) listener(entities);
  }
}

function entity(state: string): HassEntity {
  return {
    entity_id: 'light.desk',
    state,
    attributes: { friendly_name: 'Desk light', brightness: state === 'on' ? 180 : 0 },
    last_changed: '2026-10-31T12:00:00.000Z',
  };
}

function snapshot(state: string): Snapshot {
  return {
    states: [entity(state)],
    areas: [],
    devices: [],
    entities: [],
    services: {},
    config: { location_name: 'Test home' },
    user: { name: 'Test user', is_admin: true },
  };
}

describe('Haus selector home store', () => {
  it('adds bootstrap metadata without overwriting a newer live subscription or marking it cached', async () => {
    const transport = new TestTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    await store.getState().connectHome('home-a');
    transport.emitEntities([entity('on')]);
    const reply = { ...snapshot('off'), areas: [{ area_id: 'narnia', name: 'Narnia' }] };
    store.getState().hydrateLiveSnapshot('home-a', reply);
    expect(store.getState().snapshot?.states[0]?.state).toBe('on');
    expect(store.getState().snapshot?.areas).toEqual(reply.areas);
    expect(store.getState().snapshotFreshness).toBe('live');
    store.getState().dispose();
  });

  it('does not turn optimistic intent into an authoritative fact when bootstrap finishes', async () => {
    const transport = new TestTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    await store.getState().connectHome('home-a', snapshot('off'));
    transport.emitEntities([entity('off')]);
    let fail!: (error: Error) => void;
    let sent!: () => void;
    const requested = new Promise<void>((resolve) => {
      sent = resolve;
    });
    transport.request = <T>() =>
      new Promise<T>((_resolve, reject) => {
        fail = reject;
        sent();
      });
    const command = store
      .getState()
      .callService({ domain: 'light', service: 'turn_on', target: { entity_id: 'light.desk' } });
    await requested;
    store.getState().hydrateLiveSnapshot('home-a', snapshot('off'));
    expect(store.getState().snapshot?.states[0]?.state).toBe('on');
    expect(store.getState().snapshot?.pendingEntityIds).toEqual(['light.desk']);
    expect(store.getState().confirmedSnapshot()?.states[0]?.state).toBe('off');
    expect(store.getState().confirmedSnapshot()?.pendingEntityIds).toBeUndefined();
    const failure = expect(command).rejects.toMatchObject({ code: 'connection-failed' });
    fail(new Error('connection lost'));
    await failure;
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    store.getState().dispose();
  });

  it('never restores transient command-pending markers from an old local snapshot', () => {
    const store = createHausHomeStore({ openTransport: async () => new TestTransport() });
    store.getState().hydrateSnapshot('home-a', {
      ...snapshot('off'),
      pendingEntityIds: ['light.desk'],
      pendingSince: { 'light.desk': 1 },
    });
    expect(store.getState().snapshot?.pendingEntityIds).toBeUndefined();
    expect(store.getState().snapshot?.pendingSince).toBeUndefined();
    store.getState().dispose();
  });

  it('ignores live bootstrap replies after disconnection or switching homes', async () => {
    const store = createHausHomeStore({ openTransport: async () => new TestTransport() });
    await store.getState().connectHome('home-a', snapshot('off'));
    store.getState().disconnect();
    store.getState().hydrateLiveSnapshot('home-a', snapshot('on'));
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    await store.getState().connectHome('home-b', snapshot('off'));
    store.getState().hydrateLiveSnapshot('home-a', snapshot('on'));
    expect(store.getState().homeId).toBe('home-b');
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    store.getState().dispose();
  });
  it('keeps cached state visibly stale until a live entity subscription arrives', async () => {
    const transport = new TestTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    store.getState().hydrateSnapshot('home-a', snapshot('off'));

    expect(store.getState().connection).toBe('disconnected');
    expect(store.getState().snapshotFreshness).toBe('cached');
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');

    await store.getState().connectHome('home-a');
    expect(store.getState().connection).toBe('connected');
    expect(store.getState().snapshotFreshness).toBe('cached');
    transport.emitEntities([entity('off')]);
    expect(store.getState().snapshotFreshness).toBe('live');
    expect(store.getState().lastLiveAt).toEqual(expect.any(String));

    store.getState().disconnect();
    expect(store.getState().connection).toBe('disconnected');
    expect(store.getState().snapshotFreshness).toBe('cached');
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    await expect(
      store.getState().callService({
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.desk' },
      }),
    ).rejects.toMatchObject({ code: 'offline' });
    expect(transport.requests).toHaveLength(0);
    store.getState().dispose();
  });

  it('keeps live entities available when no persisted snapshot exists yet', async () => {
    const transport = new TestTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });

    await store.getState().connectHome('home-a');
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().snapshotFreshness).toBe('none');

    transport.emitEntities([entity('on')]);
    expect(store.getState().entities).toEqual([entity('on')]);
    expect(store.getState().entitiesFreshness).toBe('live');
    expect(store.getState().snapshot).toBeNull();
    store.getState().dispose();
  });

  it('projects local intent, reconciles a live confirmation, and only notifies matching selectors', async () => {
    const transport = new TestTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    store.getState().hydrateSnapshot('home-a', snapshot('off'));
    await store.getState().connectHome('home-a');
    transport.emitEntities([entity('off')]);

    const selectedStates: string[] = [];
    const stop = store.subscribe(
      (state) => state.snapshot?.states[0]?.state,
      (value) => {
        if (value) selectedStates.push(value);
      },
    );
    const command = store.getState().callService({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.desk' },
    });
    expect(store.getState().snapshot?.states[0]?.state).toBe('on');
    expect(store.getState().entities[0]?.state).toBe('on');
    expect(store.getState().snapshot?.pendingEntityIds).toEqual(['light.desk']);
    await command;
    expect(transport.requests).toHaveLength(1);

    transport.emitEntities([entity('on')]);
    expect(store.getState().snapshot?.states[0]?.state).toBe('on');
    expect(store.getState().snapshot?.pendingEntityIds).toBeUndefined();
    expect(selectedStates).toEqual(['on']);
    stop();
    store.getState().dispose();
  });

  it('rolls back rejected intent without publishing raw transport errors', async () => {
    const transport = new TestTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    store.getState().hydrateSnapshot('home-a', snapshot('off'));
    await store.getState().connectHome('home-a');
    transport.emitEntities([entity('off')]);
    transport.failure = new Error('secret access token was rejected');

    await expect(
      store.getState().callService({
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.desk' },
      }),
    ).rejects.toMatchObject({ code: 'connection-failed' });
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    expect(store.getState().entities[0]?.state).toBe('off');
    expect(store.getState().commandErrors['light.desk']).toBe('action-failed');
    store.getState().dispose();
  });

  it('does not carry cached entities or optimistic facts across home switches', async () => {
    const transports = new Map<string, TestTransport>();
    const store = createHausHomeStore({
      openTransport: async (homeId) => {
        const transport = new TestTransport();
        transports.set(homeId, transport);
        return transport;
      },
    });
    store.getState().hydrateSnapshot('home-a', snapshot('on'));
    await store.getState().connectHome('home-a');
    transports.get('home-a')?.emitEntities([entity('on')]);

    store.getState().hydrateSnapshot('home-b', snapshot('off'));
    expect(store.getState().homeId).toBe('home-b');
    expect(store.getState().connection).toBe('disconnected');
    expect(store.getState().snapshotFreshness).toBe('cached');
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    transports.get('home-a')?.emitEntities([entity('on')]);
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    store.getState().dispose();
  });
});
