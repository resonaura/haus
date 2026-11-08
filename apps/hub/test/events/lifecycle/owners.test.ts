/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import { ChildProcess } from 'node:child_process';
import { stopRecordingRuntime } from '../../../src/runtime/recording.js';
import { deferred, lifecycleFixture, turn } from './fixture.js';
const fixture = lifecycleFixture();

it('an unconfirmed capture exit fails shutdown instead of declaring its owner released', async () => {
  const { recorder, root, teardown } = await fixture();
  // A missing-exit handle models unconfirmed ownership; OS signals stay fully mocked.
  const child = new ChildProcess();
  vi.spyOn(child, 'kill').mockReturnValue(false);
  recorder.buffers.set('camera.fixture', {
    id: 'camera.fixture',
    dir: root,
    status: 'buffering',
    stopped: false,
    process: child,
  });
  vi.useRealTimers();
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  let captured: unknown;
  const closing = recorder.stop().catch((error: unknown) => {
    captured = error;
  });
  await vi.advanceTimersByTimeAsync(5100);
  await closing;
  teardown.expectedStopError = captured;
  expect(captured).toBeInstanceOf(AggregateError);
  if (!(captured instanceof AggregateError)) throw Error('missing unconfirmed-exit failure');
  expect(captured.errors).toEqual([Error('recording_capture_shutdown_incomplete')]);
});

it('composition cancels the capture owner before awaiting a recorder finalization held by that owner', async () => {
  const { recorder, store, capture } = await fixture();
  const gate = deferred();
  capture.finalize.mockImplementation(() => gate.promise);
  const event = await store.create('camera.fixture', 'motion', 1000, 2000);
  const finalizing = recorder.finish(event);
  await turn();
  expect(capture.finalize).toHaveBeenCalledTimes(1);
  const sessions = {
    stop: vi.fn(async () => {
      gate.resolve();
    }),
  };
  const closing = stopRecordingRuntime(recorder, sessions);
  try {
    await turn();
    expect(sessions.stop).toHaveBeenCalledTimes(1);
  } finally {
    gate.resolve();
    await Promise.all([closing, finalizing]);
  }
  expect(store.isMediaPinned(event.id)).toBe(false);
});

it('composition drains both owners even if the first stop throws synchronously and reports both failures', async () => {
  const gate = deferred();
  const firstFailure = Error('recorder-fixture-failure');
  const secondFailure = Error('capture-fixture-failure');
  let captured: unknown;
  let settled = false;
  const closing = stopRecordingRuntime(
    {
      stop: (): Promise<void> => {
        throw firstFailure;
      },
    },
    {
      stop: async () => {
        await gate.promise;
        throw secondFailure;
      },
    },
  )
    .catch((error: unknown) => {
      captured = error;
    })
    .then(() => {
      settled = true;
    });
  try {
    await turn();
    expect(settled).toBe(false);
  } finally {
    gate.resolve();
    await closing;
  }
  expect(captured).toBeInstanceOf(AggregateError);
  if (!(captured instanceof AggregateError)) throw Error('missing aggregate failure');
  expect(captured.errors).toEqual([firstFailure, secondFailure]);
});

it('a capture-termination failure cannot bypass the admitted catalog-work barrier', async () => {
  const { recorder, store, root, teardown } = await fixture();
  const gate = deferred();
  vi.spyOn(store, 'recording').mockImplementation(async () => {
    await gate.promise;
    return [];
  });
  recorder.buffers.set('camera.fixture', {
    id: 'camera.fixture',
    dir: root,
    status: 'buffering',
    stopped: false,
  });
  const failure = Error('fixture-termination-failed');
  vi.spyOn(recorder, 'terminateBuffer').mockImplementation(() => {
    throw failure;
  });
  const scanning = recorder.tick();
  let captured: unknown;
  let settled = false;
  const closing = recorder
    .stop()
    .catch((error: unknown) => {
      captured = error;
    })
    .then(() => {
      settled = true;
    });
  try {
    await turn();
    expect(settled).toBe(false);
  } finally {
    gate.resolve();
    await Promise.all([scanning, closing]);
    teardown.expectedStopError = captured;
  }
  expect(captured).toBeInstanceOf(AggregateError);
  if (!(captured instanceof AggregateError)) throw Error('missing termination failure');
  expect(captured.errors).toEqual([failure]);
});
