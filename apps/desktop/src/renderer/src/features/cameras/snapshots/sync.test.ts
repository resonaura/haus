/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraSnapshotFrame } from '../../../../../shared/native';
import { CameraSnapshotSync, SNAPSHOT_CYCLE_MS, SNAPSHOT_ROUND_WINDOW_MS } from './sync';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('CameraSnapshotSync', () => {
  let visibility = 'visible';
  let documentEvents: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    visibility = 'visible';
    documentEvents = new EventTarget();
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility;
      },
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('commits fast and slower cameras together at the exact same timestamp within a round', async () => {
    const sync = new CameraSnapshotSync();
    const fastFrames: CameraSnapshotFrame[] = [];
    const slowFrames: CameraSnapshotFrame[] = [];
    const fastPending = deferred<CameraSnapshotFrame>();
    const slowPending = deferred<CameraSnapshotFrame>();

    const unsubA = sync.subscribe({
      entityId: 'camera.aqara_1',
      canFetch: () => true,
      fetchSnapshot: () => fastPending.promise,
      onFrame: (frame) => fastFrames.push(frame),
    });
    const unsubB = sync.subscribe({
      entityId: 'camera.outdoor_side',
      canFetch: () => true,
      fetchSnapshot: () => slowPending.promise,
      onFrame: (frame) => slowFrames.push(frame),
    });

    await flushMicrotasks();

    // Fast camera finishes in 80ms — must wait for the slower camera in the same round.
    await vi.advanceTimersByTimeAsync(80);
    fastPending.resolve({
      image: 'data:image/jpeg;base64,fast',
      receivedAt: Date.now(),
      capturedAt: Date.now(),
      fresh: true,
    });
    await flushMicrotasks();
    expect(fastFrames).toHaveLength(0);
    expect(slowFrames).toHaveLength(0);

    // Slower camera finishes at 2800ms (< 4500ms window) -> both commit together!
    await vi.advanceTimersByTimeAsync(2720);
    slowPending.resolve({
      image: 'data:image/jpeg;base64,slow',
      receivedAt: Date.now(),
      capturedAt: Date.now(),
      fresh: true,
    });
    await flushMicrotasks();

    expect(fastFrames).toHaveLength(1);
    expect(slowFrames).toHaveLength(1);
    expect(fastFrames[0]?.receivedAt).toBe(slowFrames[0]?.receivedAt);

    unsubA();
    unsubB();
  });

  it('commits healthy cameras on time if one misses a round, then delivers the missed camera in the next round', async () => {
    const sync = new CameraSnapshotSync();
    const aFrames: CameraSnapshotFrame[] = [];
    const bFrames: CameraSnapshotFrame[] = [];
    let bRound = 0;

    const unsubA = sync.subscribe({
      entityId: 'camera.aqara_1',
      canFetch: () => true,
      fetchSnapshot: async () => ({
        image: `data:image/jpeg;base64,a-${Date.now()}`,
        receivedAt: Date.now(),
        capturedAt: Date.now(),
        fresh: true,
      }),
      onFrame: (frame) => aFrames.push(frame),
    });
    const unsubB = sync.subscribe({
      entityId: 'camera.outdoor_side',
      canFetch: () => true,
      fetchSnapshot: async () => {
        bRound += 1;
        if (bRound === 1) throw new Error('temporary_timeout');
        return {
          image: `data:image/jpeg;base64,b-${bRound}`,
          receivedAt: Date.now(),
          capturedAt: Date.now(),
          fresh: true,
        };
      },
      onFrame: (frame) => bFrames.push(frame),
    });

    await flushMicrotasks();
    // Round 1: A succeeds, B fails -> A commits cleanly, B stays empty.
    expect(aFrames).toHaveLength(1);
    expect(bFrames).toHaveLength(0);

    // Round 2 (+10s): both succeed and commit together with identical timestamp.
    await vi.advanceTimersByTimeAsync(SNAPSHOT_CYCLE_MS);
    await flushMicrotasks();
    expect(aFrames).toHaveLength(2);
    expect(bFrames).toHaveLength(1);
    expect(bFrames[0]?.image).toBe('data:image/jpeg;base64,b-2');
    expect(aFrames[1]?.receivedAt).toBe(bFrames[0]?.receivedAt);

    unsubA();
    unsubB();
  });

  it('holds a late snapshot past the round window and commits it together in the next round', async () => {
    const sync = new CameraSnapshotSync();
    const aFrames: CameraSnapshotFrame[] = [];
    const bFrames: CameraSnapshotFrame[] = [];
    const bFirst = deferred<CameraSnapshotFrame>();
    let bCalls = 0;

    const unsubA = sync.subscribe({
      entityId: 'camera.aqara_1',
      canFetch: () => true,
      fetchSnapshot: async () => ({
        image: `data:image/jpeg;base64,a-${Date.now()}`,
        receivedAt: Date.now(),
        capturedAt: Date.now(),
        fresh: true,
      }),
      onFrame: (frame) => aFrames.push(frame),
    });
    const unsubB = sync.subscribe({
      entityId: 'camera.slow_cam',
      canFetch: () => true,
      fetchSnapshot: () => {
        bCalls += 1;
        if (bCalls === 1) return bFirst.promise;
        return Promise.reject(new Error('missed_second'));
      },
      onFrame: (frame) => bFrames.push(frame),
    });

    await flushMicrotasks();
    // Round window elapses at 4500ms: A commits on time without waiting forever for B.
    await vi.advanceTimersByTimeAsync(SNAPSHOT_ROUND_WINDOW_MS);
    expect(aFrames).toHaveLength(1);
    expect(bFrames).toHaveLength(0);

    // B finishes late at 6000ms: must NOT jump out-of-sync mid-interval.
    await vi.advanceTimersByTimeAsync(1500);
    bFirst.resolve({
      image: 'data:image/jpeg;base64,b-late-1',
      receivedAt: Date.now(),
      capturedAt: Date.now(),
      fresh: true,
    });
    await flushMicrotasks();
    expect(bFrames).toHaveLength(0);

    // Next cycle at 10000ms: even if B's 2nd fetch fails, the carried late frame commits WITH A!
    await vi.advanceTimersByTimeAsync(SNAPSHOT_CYCLE_MS - SNAPSHOT_ROUND_WINDOW_MS - 1500);
    await flushMicrotasks();
    expect(aFrames).toHaveLength(2);
    expect(bFrames).toHaveLength(1);
    expect(bFrames[0]?.image).toBe('data:image/jpeg;base64,b-late-1');
    expect(aFrames[1]?.receivedAt).toBe(bFrames[0]?.receivedAt);

    unsubA();
    unsubB();
  });

  it('continues refreshing snapshots every 10 seconds even while the window is hidden', async () => {
    const sync = new CameraSnapshotSync();
    const frames: CameraSnapshotFrame[] = [];
    const onVisibilityChange = vi.fn();
    let count = 0;

    const unsub = sync.subscribe({
      entityId: 'camera.porch',
      canFetch: () => true,
      fetchSnapshot: async () => {
        count += 1;
        return {
          image: `data:image/jpeg;base64,frame-${count}`,
          receivedAt: Date.now(),
          capturedAt: Date.now(),
          fresh: true,
        };
      },
      onFrame: (frame) => frames.push(frame),
      onVisibilityChange,
    });

    await flushMicrotasks();
    expect(frames).toHaveLength(1);

    visibility = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    expect(onVisibilityChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SNAPSHOT_CYCLE_MS * 2);
    await flushMicrotasks();
    expect(frames).toHaveLength(3);
    expect(frames[2]?.image).toBe('data:image/jpeg;base64,frame-3');

    unsub();
  });
});
