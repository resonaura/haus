/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import { deferred, lifecycleFixture, turn } from './fixture.js';
const fixture = lifecycleFixture();

it('initializes once and owns only one periodic maintenance timer', async () => {
  const { recorder, store } = await fixture();
  const reconcile = vi.spyOn(store, 'reconcileLocalMedia');
  await Promise.all([recorder.initialize(), recorder.initialize()]);
  await recorder.initialize();
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  await recorder.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('shutdown drains startup and a delayed initializer cannot resurrect the timer', async () => {
  const { recorder, store } = await fixture();
  const gate = deferred();
  vi.spyOn(store, 'reconcileLocalMedia').mockImplementation(() => gate.promise);
  const starting = recorder.initialize();
  let stopped = false;
  const closing = recorder.stop().then(() => {
    stopped = true;
  });
  try {
    await turn();
    expect(stopped).toBe(false);
  } finally {
    gate.resolve();
    await starting;
    await closing;
  }
  expect(vi.getTimerCount()).toBe(0);
  await expect(recorder.initialize()).rejects.toThrow('recorder_stopped');
});

it('shutdown drains an admitted catalog scan and rejects all late capture admission', async () => {
  const { recorder, store, capture } = await fixture();
  const gate = deferred();
  const recording = vi.spyOn(store, 'recording').mockImplementation(async () => {
    await gate.promise;
    return [];
  });
  const scanning = recorder.tick();
  let stopped = false;
  const closing = recorder.stop().then(() => {
    stopped = true;
  });
  try {
    await turn();
    expect(stopped).toBe(false);
  } finally {
    gate.resolve();
    await scanning;
    await closing;
  }
  await recorder.tick();
  recorder.sync([{ id: 'camera.fixture', enabled: true, available: true }]);
  expect(recording).toHaveBeenCalledTimes(1);
  expect(capture.sync).not.toHaveBeenCalled();
  await expect(recorder.trigger('camera.fixture')).rejects.toThrow('recorder_stopped');
});

it('coalesces finalization per event and holds shutdown until the real media pin is released', async () => {
  const { recorder, store } = await fixture();
  const event = await store.create('camera.fixture', 'motion', 1000, 2000);
  const gate = deferred();
  const finalize = vi.spyOn(recorder, 'finishPinned').mockImplementation(() => gate.promise);
  const first = recorder.finish(event);
  const second = recorder.finish(event);
  let stopped = false;
  let closing: Promise<void> | undefined;
  try {
    await turn();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(store.isMediaPinned(event.id)).toBe(true);
    closing = recorder.stop().then(() => {
      stopped = true;
    });
    await turn();
    expect(stopped).toBe(false);
  } finally {
    gate.resolve();
    await Promise.all([first, second, closing]);
  }
  expect(store.isMediaPinned(event.id)).toBe(false);
  await expect(recorder.finish(event)).rejects.toThrow('recorder_stopped');
});

it('shutdown covers playback admission before its media pin and prevents post-close work', async () => {
  const { recorder, store } = await fixture();
  const event = await store.create('camera.fixture', 'motion', 1000, 2000);
  const gate = deferred();
  const pin = store.pinMedia.bind(store);
  vi.spyOn(store, 'pinMedia').mockImplementation(async (id) => {
    await gate.promise;
    return pin(id);
  });
  const prepare = vi.spyOn(recorder, 'preparePlaybackPinned').mockResolvedValue('fixture.mp4');
  const preparing = recorder.preparePlayback(event);
  const cancelled = expect(preparing).rejects.toThrow('recorder_stopped');
  let stopped = false;
  const closing = recorder.stop().then(() => {
    stopped = true;
  });
  try {
    await turn();
    expect(stopped).toBe(false);
  } finally {
    gate.resolve();
    await Promise.all([cancelled, closing]);
  }
  expect(prepare).not.toHaveBeenCalled();
  expect(store.isMediaPinned(event.id)).toBe(false);
  await expect(recorder.preparePlayback(event)).rejects.toThrow('recorder_stopped');
});

it('does not create a new recording after shutdown overtakes storage admission', async () => {
  const { recorder, store, capture } = await fixture();
  recorder.sync([{ id: 'camera.fixture', enabled: true, available: true }]);
  const gate = deferred();
  const entered = deferred();
  const totals = store.totals.bind(store);
  vi.spyOn(store, 'totals').mockImplementation(async () => {
    entered.resolve();
    await gate.promise;
    return totals();
  });
  const starting = recorder.trigger('camera.fixture');
  const cancelled = expect(starting).rejects.toThrow('recorder_stopped');
  await entered.promise;
  const closing = recorder.stop();
  try {
    await turn();
  } finally {
    gate.resolve();
    await Promise.all([cancelled, closing]);
  }
  expect(await store.recording()).toEqual([]);
  expect(capture.record).not.toHaveBeenCalled();
});

it('observes background finalization failure without publishing provider error payloads', async () => {
  const { recorder, store } = await fixture();
  const event = await store.create(
    'camera.fixture',
    'motion',
    Date.now() - 20000,
    Date.now() - 10000,
  );
  vi.spyOn(store, 'pinMedia').mockRejectedValue(Error('private-stream-and-token-fixture'));
  const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  await recorder.tick();
  await turn();
  expect(recorder.finalizing.has(event.id)).toBe(false);
  expect(warning).toHaveBeenCalledExactlyOnceWith('Recording finalization failed.', {
    code: 'HAUS_RECORDING_FINALIZE',
  });
  expect(JSON.stringify(warning.mock.calls)).not.toContain('private-stream-and-token-fixture');
});

it('shares shutdown cleanup and retains failed initialization without another timer or recovery pass', async () => {
  const { recorder, store } = await fixture();
  const reconcile = vi
    .spyOn(store, 'reconcileLocalMedia')
    .mockRejectedValue(Error('fixture-startup-failed'));
  const recoveryStop = vi.spyOn(recorder.primaryRecovery, 'stop');
  await expect(recorder.initialize()).rejects.toThrow('fixture-startup-failed');
  await expect(recorder.initialize()).rejects.toThrow('fixture-startup-failed');
  expect(reconcile).toHaveBeenCalledTimes(1);
  await Promise.all([recorder.stop(), recorder.stop()]);
  expect(recoveryStop).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('an abort listener cannot reenter shutdown and create a second cleanup owner', async () => {
  const { recorder } = await fixture();
  const recoveryStop = vi.spyOn(recorder.primaryRecovery, 'stop');
  let nested: Promise<void> | undefined;
  recorder.playbackAbort.signal.addEventListener(
    'abort',
    () => {
      nested = recorder.stop();
    },
    { once: true },
  );
  await recorder.stop();
  await nested;
  expect(recoveryStop).toHaveBeenCalledTimes(1);
});

it('releases the catalog media pin after failed finalization and admits a later explicit retry', async () => {
  const { recorder, store } = await fixture();
  const event = await store.create('camera.fixture', 'motion', 1000, 2000);
  const finalize = vi
    .spyOn(recorder, 'finishPinned')
    .mockRejectedValueOnce(Error('fixture-finalize-failed'));
  await expect(recorder.finish(event)).rejects.toThrow('fixture-finalize-failed');
  expect(store.isMediaPinned(event.id)).toBe(false);
  expect(recorder.finalizing.has(event.id)).toBe(false);
  finalize.mockResolvedValue(undefined);
  await recorder.finish(event);
  expect(finalize).toHaveBeenCalledTimes(2);
  expect(store.isMediaPinned(event.id)).toBe(false);
});
