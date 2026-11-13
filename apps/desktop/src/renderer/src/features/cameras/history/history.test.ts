/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeEvent } from '../../../../../shared/native';

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  reset() {
    this.slots = [];
    this.cursor = 0;
    this.effects = [];
  },
  rewind() {
    this.cursor = 0;
  },
  flushEffects() {
    const queue = this.effects.splice(0, this.effects.length);
    for (const run of queue) run();
  },
}));

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const equal = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  return {
    ...react,
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      return (hooks.slots[index] ??= { current: initial });
    },
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      const slot = hooks.slots[index] as { value: unknown };
      return [
        slot.value,
        (value: unknown) => {
          slot.value = typeof value === 'function' ? value(slot.value) : value;
        },
      ];
    },
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as
        { value: unknown; dependencies: readonly unknown[] } | undefined;
      if (!prev || !equal(prev.dependencies, dependencies)) {
        hooks.slots[index] = { value: callback, dependencies };
      }
      return (hooks.slots[index] as { value: unknown }).value;
    },
    useMemo: (factory: () => unknown, dependencies: readonly unknown[]) => {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as
        { value: unknown; dependencies: readonly unknown[] } | undefined;
      if (!prev || !equal(prev.dependencies, dependencies)) {
        hooks.slots[index] = { value: factory(), dependencies };
      }
      return (hooks.slots[index] as { value: unknown }).value;
    },
    useEffect: (effect: () => (() => void) | undefined, dependencies?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as EffectSlot | undefined;
      if (prev && equal(prev.dependencies, dependencies)) return;
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.effects.push(() => {
        prev?.cleanup?.();
        slot.cleanup = effect();
      });
    },
  };
});

import { extractAvailability, mergePeriods, useRecordingHistory } from '../useRecordingHistory';

describe('recording history helpers', () => {
  it('normalizes both array availability and Hub { segments } objects', () => {
    const seg1 = { cameraId: 'camera.front', startAt: 1000, endAt: 2000, state: 'online' as const };
    const seg2 = {
      cameraId: 'camera.front',
      startAt: 3000,
      endAt: 4000,
      state: 'offline' as const,
    };

    expect(extractAvailability(undefined)).toEqual([]);
    expect(extractAvailability([seg1])).toEqual([seg1]);
    expect(extractAvailability({ segments: [seg2] })).toEqual([seg2]);
    expect(mergePeriods([seg1], { segments: [seg1, seg2] })).toEqual([seg1, seg2]);
  });
});

describe('useRecordingHistory', () => {
  const flushAsync = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  beforeEach(() => {
    hooks.reset();
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads Hub { items, cursor, availability: { segments } } pages, paginates, and refreshes on helper-live camera events', async () => {
    let listener: ((event: NativeEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const helper = vi.fn(async (req: { path: string }) => {
      if (req.path === '/api/availability') return { installed: true, state: 'started' };
      if (req.path.includes('direction=older')) {
        return {
          items: [
            {
              id: 'evt-older',
              cameraId: 'camera.front',
              startAt: 1000,
              endAt: 1500,
              status: 'ready',
              kinds: ['motion'],
              duration: 0.5,
              bytes: 1200,
            },
          ],
          cursor: null,
          availability: {
            from: 0,
            to: 2000,
            total: 1,
            segments: [{ cameraId: 'camera.front', startAt: 1000, endAt: 1500, state: 'online' }],
          },
        };
      }
      return {
        items: [
          {
            id: 'evt-latest',
            cameraId: 'camera.front',
            startAt: 3000,
            endAt: 4000,
            status: 'ready',
            kinds: ['manual'],
            duration: 1,
            bytes: 2400,
          },
        ],
        cursor: 'cur-1',
        availability: {
          from: 2000,
          to: 5000,
          total: 1,
          segments: [{ cameraId: 'camera.front', startAt: 3000, endAt: 4000, state: 'online' }],
        },
      };
    });
    const onEvent = vi.fn((cb: (event: NativeEvent) => void) => {
      listener = cb;
      return unsubscribe;
    });
    vi.stubGlobal('window', { hausNative: { helper, onEvent } });
    vi.stubGlobal('hausNative', { helper, onEvent });

    const render = () => {
      hooks.rewind();
      const state = useRecordingHistory('camera.front', false, { allDays: true });
      hooks.flushEffects();
      return state;
    };

    render();
    await flushAsync();
    let state = render();

    expect(state.error).toBe('');
    expect(state.events.map((e) => e.id)).toEqual(['evt-latest']);
    expect(state.periods).toHaveLength(1);
    expect(state.older).toBe('cur-1');

    state.earlier();
    await flushAsync();
    state = render();

    expect(state.events.map((e) => e.id)).toEqual(['evt-latest', 'evt-older']);
    expect(state.periods).toHaveLength(2);
    expect(state.older).toBeNull();

    const callsBeforeLive = helper.mock.calls.length;
    listener?.({
      type: 'helper-live',
      scope: 'hub:1',
      online: true,
      topic: 'preferences',
    });
    await flushAsync();
    expect(helper.mock.calls.length).toBe(callsBeforeLive);

    listener?.({
      type: 'helper-live',
      scope: 'hub:1',
      online: true,
      topic: 'cameras',
    });
    await flushAsync();
    expect(helper.mock.calls.length).toBeGreaterThan(callsBeforeLive);

    const effectSlot = hooks.slots.find(
      (slot): slot is EffectSlot => typeof slot === 'object' && slot !== null && 'cleanup' in slot,
    );
    effectSlot?.cleanup?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
