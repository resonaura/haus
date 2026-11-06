/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, expect, it, vi } from 'vitest';
import { ContinuousCommand, type CommandClock } from '../src/continuous-command.js';
const clock: CommandClock = {
  now: () => Date.now(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};
afterEach(() => vi.useRealTimers());

it('coalesces a fast gesture, preserves its final intent and never replays intermediate values behind a slow ACK', async () => {
  vi.useFakeTimers();
  let acknowledge!: () => void;
  const first = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const send = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockResolvedValue(undefined);
  const control = new ContinuousCommand<number>(send, clock, vi.fn());
  control.update(1);
  for (let value = 2; value <= 100; value++) {
    control.update(value);
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(send.mock.calls).toEqual([[1]]);
  const finishing = control.finish();
  acknowledge();
  await finishing;
  expect(send.mock.calls).toEqual([[1], [100]]);
});

it('sends no more than once per 100 ms while dragging, flushes the last value and cancels on session loss', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue(undefined);
  const control = new ContinuousCommand<number>(send, clock, vi.fn());
  control.update(1);
  await vi.advanceTimersByTimeAsync(0);
  control.update(2);
  await vi.advanceTimersByTimeAsync(50);
  control.update(3);
  await vi.advanceTimersByTimeAsync(50);
  expect(send.mock.calls).toEqual([[1], [3]]);
  control.update(4);
  await control.finish();
  expect(send.mock.calls).toEqual([[1], [3], [4]]);
  const cancelled = new ContinuousCommand<number>(send, clock, vi.fn());
  cancelled.update(5);
  await vi.advanceTimersByTimeAsync(0);
  cancelled.update(6);
  cancelled.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(send.mock.calls.at(-1)).toEqual([5]);
});

it('stops a failed gesture and surfaces one error for rollback', async () => {
  vi.useFakeTimers();
  const error = new Error('offline');
  const onError = vi.fn();
  const send = vi.fn().mockRejectedValue(error);
  const control = new ContinuousCommand<number>(send, clock, onError);
  control.update(1);
  control.update(2);
  await vi.advanceTimersByTimeAsync(0);
  await expect(control.finish()).rejects.toBe(error);
  expect(send).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
});
