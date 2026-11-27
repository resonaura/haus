/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { OPTIMISTIC_TIMEOUT_NOTICE } from '@haus/state';
import type {
  HaConnectionState,
  HaEntityObservation,
  HaMessage,
  HaTransport,
} from '../../src/ha-client.js';
import { coalesceHausActions } from '../../src/optimistic.js';
import { createHausHomeStore } from '../../src/store.js';
import type { HassEntity, Snapshot } from '../../src/types.js';

interface DeferredRequest {
  readonly message: HaMessage;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

class ControlledTransport implements HaTransport {
  connected = true;
  readonly queue: DeferredRequest[] = [];
  private readonly stateListeners = new Set<(state: HaConnectionState) => void>();
  private readonly entityListeners = new Set<(entities: readonly HassEntity[]) => void>();
  private readonly observationListeners = new Set<(obs: HaEntityObservation) => void>();

  close(): void {
    this.connected = false;
  }

  request<T>(message: HaMessage): Promise<T> {
    if (!this.connected) return Promise.reject(new Error('offline'));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        message,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
  }

  watchState(callback: (state: HaConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  watchEntities(callback: (entities: readonly HassEntity[]) => void): () => void {
    this.entityListeners.add(callback);
    return () => this.entityListeners.delete(callback);
  }

  watchObservations(callback: (obs: HaEntityObservation) => void): () => void {
    this.observationListeners.add(callback);
    return () => this.observationListeners.delete(callback);
  }

  emitObservation(obs: HaEntityObservation): void {
    for (const listener of this.observationListeners) listener(obs);
  }
}

function makeLight(id: string, state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id: id,
    state,
    attributes: { friendly_name: id, brightness: state === 'on' ? 200 : 0, ...attrs },
    last_changed: '2026-11-26T00:00:00.000Z',
  };
}

function makeSnapshot(states: HassEntity[]): Snapshot {
  return {
    states,
    areas: [{ area_id: 'studio', name: 'Studio' }],
    devices: [],
    entities: [],
    services: {
      light: { turn_on: {}, turn_off: {}, toggle: {} },
      scene: { turn_on: {}, apply: {} },
      humidifier: { set_humidity: {} },
      climate: { set_preset_mode: {} },
      media_player: { volume_mute: {} },
    },
    config: { location_name: 'Haus' },
    user: { name: 'Tester', is_admin: true },
  };
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('unified cross-platform optimistic system', () => {
  it('projects multi-entity batches atomically at 0ms and rolls back only failed entities', async () => {
    const transport = new ControlledTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    await store
      .getState()
      .connectHome(
        'home-1',
        makeSnapshot([makeLight('light.a', 'off'), makeLight('light.b', 'off')]),
      );

    const batchPromise = store.getState().executeBatch([
      { domain: 'light', service: 'turn_on', target: { entity_id: 'light.a' } },
      { domain: 'light', service: 'turn_on', target: { entity_id: 'light.b' } },
    ]);

    // 0ms synchronous optimistic projection before transport resolves
    expect(store.getState().snapshot?.states.map((s) => s.state)).toEqual(['on', 'on']);
    expect(store.getState().snapshot?.pendingEntityIds).toEqual(['light.a', 'light.b']);
    expect(
      store
        .getState()
        .confirmedSnapshot()
        ?.states.map((s) => s.state),
    ).toEqual(['off', 'off']);
    await flushMicrotasks();
    expect(transport.queue).toHaveLength(2);

    // Light A succeeds, Light B fails
    transport.queue[0]!.resolve({ context: { id: 'ctx-a' } });
    transport.queue[1]!.reject(new Error('zigbee_timeout'));
    await expect(batchPromise).rejects.toMatchObject({ code: 'connection-failed' });

    const states = store.getState().snapshot?.states ?? [];
    expect(states.find((s) => s.entity_id === 'light.a')?.state).toBe('on');
    expect(states.find((s) => s.entity_id === 'light.b')?.state).toBe('off');
    expect(store.getState().commandErrors['light.b']).toBe('action-failed');
    expect(store.getState().commandErrors['light.a']).toBeUndefined();

    // Confirm Light A via observation
    transport.emitObservation({
      entityId: 'light.a',
      value: makeLight('light.a', 'on'),
      correlationId: 'ctx-a',
    });
    expect(store.getState().snapshot?.pendingEntityIds).toBeUndefined();
    store.getState().dispose();
  });

  it('coalesces rapid waiting light and slider commands while stripping conflicting colour modes', async () => {
    const merged = coalesceHausActions(
      {
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.desk' },
        service_data: { brightness_pct: 40, rgb_color: [255, 0, 128], effect: 'Rainbow' },
      },
      {
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.desk' },
        service_data: { color_temp_kelvin: 3200 },
      },
    );
    expect(merged?.service_data).toEqual({
      brightness_pct: 40,
      color_temp_kelvin: 3200,
    });

    const transport = new ControlledTransport();
    const store = createHausHomeStore({ openTransport: async () => transport });
    await store.getState().connectHome('home-1', makeSnapshot([makeLight('light.desk', 'on')]));

    const first = store.getState().callService({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.desk' },
      service_data: { brightness_pct: 20 },
    });
    const second = store.getState().callService({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.desk' },
      service_data: { brightness_pct: 55, rgb_color: [255, 100, 50] },
    });
    const third = store.getState().callService({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.desk' },
      service_data: { brightness_pct: 85, color_temp_kelvin: 4000 },
    });

    // Latest optimistic brightness/kelvin is immediately projected while only 1 request is on the wire
    expect(store.getState().snapshot?.states[0]?.attributes.brightness).toBe(217);
    expect(store.getState().snapshot?.states[0]?.attributes.color_temp_kelvin).toBe(4000);
    await flushMicrotasks();
    expect(transport.queue).toHaveLength(1);

    transport.queue[0]!.resolve({ context: { id: 'ctx-1' } });
    await first;
    await flushMicrotasks();
    // Waiting second + third coalesced into a single wire request
    expect(transport.queue).toHaveLength(2);
    expect(transport.queue[1]!.message.service_data).toEqual({
      brightness_pct: 85,
      color_temp_kelvin: 4000,
    });
    transport.queue[1]!.resolve({ context: { id: 'ctx-2' } });
    await Promise.all([second, third]);
    store.getState().dispose();
  });

  it('rejects out-of-order stale local echoes via watchObservations correlationId and preserves syncLiveSnapshot overlays', async () => {
    let clock = 1_000;
    const transport = new ControlledTransport();
    const store = createHausHomeStore({
      openTransport: async () => transport,
      now: () => clock,
    });
    await store.getState().connectHome('home-1', makeSnapshot([makeLight('light.desk', 'off')]));

    const turnOn = store.getState().callService({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.desk' },
    });
    await flushMicrotasks();
    transport.queue[0]!.resolve({ context: { id: 'ctx-old' } });
    await turnOn;

    clock = 1_050;
    const turnOff = store.getState().callService({
      domain: 'light',
      service: 'turn_off',
      target: { entity_id: 'light.desk' },
    });
    await flushMicrotasks();
    transport.queue[1]!.resolve({ context: { id: 'ctx-new' } });
    await turnOff;

    // Newer command settles first
    clock = 1_100;
    transport.emitObservation({
      entityId: 'light.desk',
      value: makeLight('light.desk', 'off'),
      correlationId: 'ctx-new',
    });
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    expect(store.getState().snapshot?.pendingEntityIds).toBeUndefined();

    // Late echo from older local command arrives out of order -> suppressed!
    clock = 1_150;
    transport.emitObservation({
      entityId: 'light.desk',
      value: makeLight('light.desk', 'on'),
      correlationId: 'ctx-old',
    });
    expect(store.getState().snapshot?.states[0]?.state).toBe('off');
    expect(store.getState().confirmedSnapshot()?.states[0]?.state).toBe('off');

    // Start another command and run syncLiveSnapshot with stale server data + updated background entity
    clock = 1_200;
    const toggleDirect = store.getState().callService({
      domain: 'light',
      service: 'toggle',
      target: { entity_id: 'light.desk' },
    });
    expect(store.getState().snapshot?.states[0]?.state).toBe('on');
    store
      .getState()
      .syncLiveSnapshot(
        'home-1',
        makeSnapshot([makeLight('light.desk', 'off'), makeLight('light.hall', 'on')]),
      );
    // Active optimistic state stays 'on', while background 'light.hall' is added immediately!
    expect(store.getState().snapshot?.states.map((s) => [s.entity_id, s.state])).toEqual([
      ['light.desk', 'on'],
      ['light.hall', 'on'],
    ]);
    await flushMicrotasks();
    transport.queue[2]!.resolve({ context: { id: 'ctx-toggle' } });
    await toggleDirect;
    store.getState().dispose();
  });

  it('expires unconfirmed transactions on timer and surfaces timeout notice', async () => {
    vi.useFakeTimers();
    let clock = 1_000;
    const transport = new ControlledTransport();
    const store = createHausHomeStore({
      openTransport: async () => transport,
      now: () => clock,
    });
    try {
      await store.getState().connectHome('home-1', makeSnapshot([makeLight('light.desk', 'off')]));
      const cmd = store.getState().callService({
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.desk' },
      });
      await flushMicrotasks();
      transport.queue[0]!.resolve({ context: { id: 'ctx-timeout' } });
      await cmd;
      expect(store.getState().snapshot?.states[0]?.state).toBe('on');

      // Advance past 10s post-ACK observation window
      clock = 12_000;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.getState().snapshot?.states[0]?.state).toBe('off');
      expect(store.getState().snapshot?.pendingEntityIds).toBeUndefined();
      expect(store.getState().commandNotice).toBe(OPTIMISTIC_TIMEOUT_NOTICE);
    } finally {
      store.getState().dispose();
      vi.useRealTimers();
    }
  });
});
