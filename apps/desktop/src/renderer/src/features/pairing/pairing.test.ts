/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type HookSlot = {
  value?: unknown;
  deps?: unknown[];
  callback?: unknown;
  cleanup?: (() => void) | undefined;
};

const hookRunner = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as HookSlot[],
  effects: [] as Array<() => void>,
  reset() {
    this.cursor = 0;
    this.slots = [];
    this.effects = [];
  },
  rewind() {
    this.cursor = 0;
  },
  runEffects() {
    for (const eff of this.effects) eff();
    this.effects = [];
  },
}));

vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] {
    const idx = hookRunner.cursor++;
    if (!hookRunner.slots[idx]) {
      hookRunner.slots[idx] = {
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
      };
    }
    const slot = hookRunner.slots[idx]!;
    const setter = (val: T | ((prev: T) => T)) => {
      slot.value = typeof val === 'function' ? (val as (prev: T) => T)(slot.value as T) : val;
    };
    return [slot.value as T, setter];
  },
  useCallback<T extends (...args: unknown[]) => unknown>(callback: T, deps: unknown[]): T {
    const idx = hookRunner.cursor++;
    const prev = hookRunner.slots[idx];
    if (!prev || !prev.deps || deps.some((d, i) => d !== prev.deps![i])) {
      hookRunner.slots[idx] = { callback, deps };
      return callback;
    }
    return prev.callback as T;
  },
  useEffect(effect: () => (() => void) | void, deps?: unknown[]): void {
    const idx = hookRunner.cursor++;
    const prev = hookRunner.slots[idx];
    if (!prev || !prev.deps || !deps || deps.some((d, i) => d !== prev.deps![i])) {
      const slot: HookSlot = { deps };
      hookRunner.slots[idx] = slot;
      hookRunner.effects.push(() => {
        prev?.cleanup?.();
        const clean = effect();
        if (typeof clean === 'function') slot.cleanup = clean;
      });
    }
  },
}));

import { usePairingRequests } from './usePairingRequests.js';

describe('usePairingRequests', () => {
  beforeEach(() => {
    hookRunner.reset();
  });

  it('does not poll when disconnected or not connected to a Haus Hub', async () => {
    const management = vi.fn().mockResolvedValue({ requests: [] });
    vi.stubGlobal('hausNative', { management });

    hookRunner.rewind();
    const state = usePairingRequests(false, null);
    hookRunner.runEffects();

    expect(state.requests).toEqual([]);
    expect(state.activePairing).toBeNull();
    expect(management).not.toHaveBeenCalled();

    hookRunner.reset();
    const haState = usePairingRequests(true, { kind: 'home-assistant' });
    hookRunner.runEffects();

    expect(haState.requests).toEqual([]);
    expect(management).not.toHaveBeenCalled();
  });

  it('polls pending requests when connected to Haus Hub', async () => {
    const mockRequest = {
      sessionId: 'sess-123',
      challengeCode: 'A1B2C3D4',
      createdAt: Date.now(),
    };
    const management = vi.fn().mockResolvedValue({ requests: [mockRequest] });
    vi.stubGlobal('window', {
      hausNative: { management },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    hookRunner.rewind();
    usePairingRequests(true, { kind: 'haus-hub' });
    hookRunner.runEffects();

    await Promise.resolve();
    expect(management).toHaveBeenCalledWith({ method: 'GET', path: 'auth/pairing-requests' });

    hookRunner.rewind();
    const updated = usePairingRequests(true, { kind: 'haus-hub' });
    expect(updated.requests).toEqual([mockRequest]);
    expect(updated.activePairing).toEqual(mockRequest);
  });

  it('dismisses a pending pairing request via management IPC', async () => {
    const mockRequest = {
      sessionId: 'sess-456',
      challengeCode: 'F9E8D7C6',
      createdAt: Date.now(),
    };
    const management = vi
      .fn()
      .mockResolvedValueOnce({ requests: [mockRequest] })
      .mockResolvedValueOnce({ dismissed: true });
    vi.stubGlobal('window', {
      hausNative: { management },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    hookRunner.rewind();
    usePairingRequests(true, { kind: 'haus-hub' });
    hookRunner.runEffects();
    await Promise.resolve();

    hookRunner.rewind();
    const active = usePairingRequests(true, { kind: 'haus-hub' });
    expect(active.activePairing).toEqual(mockRequest);

    await active.dismissPairing('sess-456');

    expect(management).toHaveBeenCalledWith({
      method: 'POST',
      path: 'auth/pairing-requests/dismiss',
      data: { sessionId: 'sess-456' },
    });

    hookRunner.rewind();
    const cleared = usePairingRequests(true, { kind: 'haus-hub' });
    expect(cleared.requests).toEqual([]);
    expect(cleared.activePairing).toBeNull();
  });
});
