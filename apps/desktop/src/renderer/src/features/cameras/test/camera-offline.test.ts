/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntity } from '../../../model';

interface EffectSlot {
  dependencies?: readonly unknown[];
  cleanup?: () => void;
}
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pending: [] as (() => void)[],
  effects: [] as EffectSlot[],
}));

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const equal = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
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
      const previous = hooks.slots[index] as
        { value: unknown; dependencies: readonly unknown[] } | undefined;
      if (!previous || !equal(previous.dependencies, dependencies))
        hooks.slots[index] = { value: callback, dependencies };
      return (hooks.slots[index] as { value: unknown }).value;
    },
    useEffect: (effect: () => (() => void) | undefined, dependencies?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as EffectSlot | undefined;
      if (previous && equal(previous.dependencies, dependencies)) return;
      const slot: EffectSlot = { dependencies };
      hooks.slots[index] = slot;
      hooks.effects.push(slot);
      hooks.pending.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect();
      });
    },
  };
});
vi.mock('../useCameraPreheat', () => ({ useCameraPreheat: () => {} }));

import { CameraOfflineIndicator, CameraPreview } from '../CameraCard';

function render(callback: () => unknown) {
  hooks.cursor = 0;
  const result = callback();
  for (const effect of hooks.pending.splice(0)) effect();
  return result;
}

function findElement(
  node: unknown,
  predicate: (el: { type?: unknown; props?: Record<string, unknown> }) => boolean,
): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (predicate(element)) return element;
  return findElement(element.props?.children, predicate);
}

describe('CameraPreview offline blur + indicator synchronization', () => {
  let api: {
    cameraSnapshot: ReturnType<typeof vi.fn>;
    cameraLastSnapshot: ReturnType<typeof vi.fn>;
    onEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hooks.slots = [];
    hooks.effects = [];
    hooks.pending = [];
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    api = {
      cameraSnapshot: vi.fn(),
      cameraLastSnapshot: vi.fn(async () => ({
        image: 'data:image/jpeg;base64,cached-frame',
        receivedAt: Date.now() - 60_000,
      })),
      onEvent: vi.fn(() => () => {}),
    };
    vi.stubGlobal('window', { hausNative: api });
  });

  afterEach(() => {
    for (const effect of hooks.effects) effect.cleanup?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function settle() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  it('immediately shows BOTH is-cached-preview blur and CameraOfflineIndicator for unavailable cameras (even when paused/offscreen)', async () => {
    const offline = vi.fn();
    const unavailable = {
      entity_id: 'camera.narnia',
      state: 'unavailable',
      attributes: { friendly_name: 'Narnia Camera' },
    } as unknown as HassEntity;

    const props = { entity: unavailable, demo: false, enabled: false, onOfflineChange: offline };
    render(() => CameraPreview(props));
    await settle();
    const tree = render(() => CameraPreview(props));

    const blurred = findElement(tree, (el) => el.props?.className === 'is-cached-preview');
    const indicator = findElement(tree, (el) => el.type === CameraOfflineIndicator);
    expect(blurred).toBeDefined();
    expect(indicator).toBeDefined();
    expect(offline).toHaveBeenLastCalledWith(true);
    expect(api.cameraSnapshot).not.toHaveBeenCalled();
  });

  it('keeps offline indicator visible when switching directly from one unavailable camera to another', async () => {
    const offline = vi.fn();
    const cam1 = {
      entity_id: 'camera.narnia_1',
      state: 'unavailable',
      attributes: { friendly_name: 'Narnia 1' },
    } as unknown as HassEntity;
    const cam2 = {
      entity_id: 'camera.narnia_2',
      state: 'unavailable',
      attributes: { friendly_name: 'Narnia 2' },
    } as unknown as HassEntity;

    render(() =>
      CameraPreview({ entity: cam1, demo: false, enabled: true, onOfflineChange: offline }),
    );
    await settle();
    render(() =>
      CameraPreview({ entity: cam2, demo: false, enabled: true, onOfflineChange: offline }),
    );
    await settle();
    const tree = render(() =>
      CameraPreview({ entity: cam2, demo: false, enabled: true, onOfflineChange: offline }),
    );

    expect(findElement(tree, (el) => el.props?.className === 'is-cached-preview')).toBeDefined();
    expect(findElement(tree, (el) => el.type === CameraOfflineIndicator)).toBeDefined();
    expect(offline).toHaveBeenLastCalledWith(true);
  });
});
