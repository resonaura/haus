/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { computeReconnectDelayMs, LiveReconnectController } from './reconnect';

describe('LiveReconnectController', () => {
  it('applies bounded exponential backoff with jitter across reconnect attempts', () => {
    expect(computeReconnectDelayMs(0, 2000, 30000, () => 0.5)).toBe(2000);
    expect(computeReconnectDelayMs(1, 2000, 30000, () => 0.5)).toBe(4000);
    expect(computeReconnectDelayMs(2, 2000, 30000, () => 0.5)).toBe(8000);
    expect(computeReconnectDelayMs(5, 2000, 30000, () => 1)).toBe(30000);
    expect(computeReconnectDelayMs(0, 500, 30000, () => 0)).toBe(500);
  });

  it('defers reconnect while hidden and resumes immediately when visibility returns', () => {
    vi.useFakeTimers();
    try {
      let visible = false;
      let emitVisible = () => {};
      const triggered: number[] = [];
      const controller = new LiveReconnectController({
        baseDelayMs: 2000,
        maxDelayMs: 30000,
        isVisible: () => visible,
        random: () => 0.5,
        onTrigger: (next) => triggered.push(next),
        subscribeVisibility: (listener) => {
          emitVisible = listener;
          return () => {};
        },
        subscribeOnline: () => () => {},
      });

      controller.schedule();
      vi.advanceTimersByTime(2000);
      expect(triggered).toEqual([]);

      visible = true;
      emitVisible();
      expect(triggered).toEqual([1]);

      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('triggers immediate reconnect and resets attempt counter on network online event', () => {
    vi.useFakeTimers();
    try {
      let emitOnline = () => {};
      const triggered: number[] = [];
      const controller = new LiveReconnectController({
        initialAttempt: 4,
        baseDelayMs: 2000,
        maxDelayMs: 30000,
        isVisible: () => true,
        random: () => 0.5,
        onTrigger: (next) => triggered.push(next),
        subscribeVisibility: () => () => {},
        subscribeOnline: (listener) => {
          emitOnline = listener;
          return () => {};
        },
      });

      controller.schedule();
      emitOnline();
      expect(triggered).toEqual([0]);

      vi.advanceTimersByTime(30000);
      expect(triggered).toEqual([0]);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets backoff counter when stream recovers and unsubscribes on dispose', () => {
    vi.useFakeTimers();
    try {
      const triggered: number[] = [];
      const resets = vi.fn();
      const unsubVis = vi.fn();
      const unsubOnline = vi.fn();
      const controller = new LiveReconnectController({
        initialAttempt: 3,
        isVisible: () => true,
        random: () => 0.5,
        onTrigger: (next) => triggered.push(next),
        onReset: resets,
        subscribeVisibility: () => unsubVis,
        subscribeOnline: () => unsubOnline,
      });

      controller.reset();
      expect(resets).toHaveBeenCalledTimes(1);
      expect(controller.currentAttempt).toBe(0);

      controller.schedule();
      controller.dispose();
      vi.advanceTimersByTime(30000);
      expect(triggered).toEqual([]);
      expect(unsubVis).toHaveBeenCalledTimes(1);
      expect(unsubOnline).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
