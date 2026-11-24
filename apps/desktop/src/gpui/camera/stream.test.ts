/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { MediaRuntime } from '@haus/media/pipeline';
import { expect, it, vi } from 'vitest';
import { GpuiCameraStreams } from './stream.js';

vi.mock('node:timers/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:timers/promises')>()),
  setTimeout: async (_delay: number, _value: undefined, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted();
  },
}));

const id = 'camera.fixture';
const hub = 'http://hub.test';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

class OneFrameMedia extends MediaRuntime {
  override spawn(): ChildProcess {
    const child = new ChildProcess();
    const output = new PassThrough();
    child.stdout = output;
    output.once('end', () => {
      Object.defineProperty(child, 'exitCode', { value: 0 });
      child.emit('close', 0);
    });
    vi.spyOn(child, 'kill').mockImplementation(() => {
      child.emit('close', null, 'SIGKILL');
      return true;
    });
    output.end(Buffer.alloc(960 * 540 * 4));
    return child;
  }
}

function fixture(
  warm = true,
  onWarm?: (active: boolean, owner: number, signal: AbortSignal) => Promise<void>,
) {
  const requests: boolean[] = [];
  let viewers = 0;
  const createViewer = vi.fn((_hub: string) => {
    const owner = ++viewers;
    return {
      request: async (input: unknown, signal: AbortSignal) => {
        expect(input).toMatchObject({ method: 'POST', path: `/api/cameras/${id}/warm` });
        if (!input || typeof input !== 'object' || !('data' in input))
          throw new Error('Missing data');
        const { data } = input;
        if (
          !data ||
          typeof data !== 'object' ||
          !('active' in data) ||
          typeof data.active !== 'boolean'
        ) {
          throw new Error('Missing activity');
        }
        requests.push(data.active);
        await onWarm?.(data.active, owner, signal);
        return { warm: warm && data.active, streamPath: `/api/cameras/${id}/live/index.m3u8` };
      },
      media: async () => new Response(null, { status: 404 }),
      clear: vi.fn(),
    };
  });
  return {
    requests,
    createViewer,
    streams: new GpuiCameraStreams(new OneFrameMedia(), createViewer),
  };
}

it('bounds repeated decoder exits and renews the same warm owner', async () => {
  const { createViewer, requests, streams } = fixture();
  const status = vi.fn();
  const frames = streams.open(hub, id, new AbortController().signal, status);
  for (let i = 0; i < 4; i++) expect((await frames.next()).done).toBe(false);
  await expect(frames.next()).rejects.toThrow('The live camera stream ended.');
  expect(status.mock.calls.map(([value]) => value)).toEqual([
    'playing',
    'reconnecting',
    'playing',
    'reconnecting',
    'playing',
    'reconnecting',
    'playing',
  ]);
  expect(createViewer).toHaveBeenCalledOnce();
  expect(requests).toEqual([true, false, true, false, true, false, true, false]);
  await streams.close();
});

it('cancels a pending restart when the view closes', async () => {
  const { requests, streams } = fixture();
  const controller = new AbortController();
  const frames = streams.open(hub, id, controller.signal, (status) => {
    if (status === 'reconnecting') controller.abort();
  });
  expect((await frames.next()).done).toBe(false);
  await expect(frames.next()).rejects.toMatchObject({ name: 'AbortError' });
  expect(requests).toEqual([true, false]);
  await streams.close();
});

it('leaves failed initial negotiation to the manual Retry control', async () => {
  const { requests, streams } = fixture(false);
  const status = vi.fn();
  const frames = streams.open(hub, id, new AbortController().signal, status);
  await expect(frames.next()).rejects.toThrow('Haus Hub did not provide an HLS camera stream.');
  expect(status).not.toHaveBeenCalled();
  expect(requests).toEqual([true, false]);
  await streams.close();
});

it('defers reopening a camera until the old warm lease is released', async () => {
  const releasing = gate();
  const released = gate();
  const { requests, createViewer, streams } = fixture(true, async (active) => {
    if (active) return;
    releasing.resolve();
    await released.promise;
  });
  const signal = new AbortController().signal;
  const first = streams.open(hub, id, signal);
  const reopened = streams.open(hub, id, signal);
  try {
    expect((await first.next()).done).toBe(false);
    const stopped = first.return(undefined);
    await releasing.promise;
    const next = reopened.next();
    await Promise.resolve();
    expect(createViewer).toHaveBeenCalledOnce();
    expect(requests).toEqual([true, false]);
    released.resolve();
    await stopped;
    expect((await next).done).toBe(false);
  } finally {
    released.resolve();
    await first.return(undefined);
    await reopened.return(undefined);
    await streams.close();
  }
  expect(requests).toEqual([true, false, true, false]);
});

it('cancels a queued reopen without acquiring another warm lease', async () => {
  const releasing = gate();
  const released = gate();
  const { requests, streams } = fixture(true, async (active) => {
    if (active) return;
    releasing.resolve();
    await released.promise;
  });
  const controller = new AbortController();
  const first = streams.open(hub, id, new AbortController().signal);
  const reopened = streams.open(hub, id, controller.signal);
  try {
    expect((await first.next()).done).toBe(false);
    const stopped = first.return(undefined);
    await releasing.promise;
    const next = reopened.next();
    controller.abort();
    await expect(next).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toEqual([true, false]);
    released.resolve();
    await stopped;
  } finally {
    released.resolve();
    await first.return(undefined);
    await reopened.return(undefined);
    await streams.close();
  }
});

it('lets an in-flight warm request settle before releasing after cancellation', async () => {
  const acquiring = gate();
  const acquired = gate();
  let requestSignal: AbortSignal | undefined;
  const { requests, streams } = fixture(true, async (active, _owner, signal) => {
    if (!active) return;
    requestSignal = signal;
    acquiring.resolve();
    await acquired.promise;
  });
  const controller = new AbortController();
  const frames = streams.open(hub, id, controller.signal);
  const stopped = expect(frames.next()).rejects.toMatchObject({ name: 'AbortError' });
  try {
    await acquiring.promise;
    controller.abort();
    expect(requestSignal?.aborted).toBe(false);
    expect(requests).toEqual([true]);
    acquired.resolve();
    await stopped;
    expect(requests).toEqual([true, false]);
  } finally {
    acquired.resolve();
    await frames.return(undefined);
    await streams.close();
  }
});

it('confirms release with the previous owner before opening a fresh viewer after a lost acknowledgement', async () => {
  const writes: [boolean, number][] = [];
  let allowRelease = false;
  const { createViewer, streams } = fixture(true, async (active, owner) => {
    writes.push([active, owner]);
    if (!active && !allowRelease) throw new Error('Fixture lost the release acknowledgement.');
  });
  const signal = new AbortController().signal;
  const first = streams.open(hub, id, signal);
  expect((await first.next()).done).toBe(false);
  await expect(first.return(undefined)).rejects.toThrow('lost the release acknowledgement');

  await expect(streams.open(hub, id, signal).next()).rejects.toThrow(
    'lost the release acknowledgement',
  );
  expect(createViewer).toHaveBeenCalledOnce();
  expect(writes).toEqual([
    [true, 1],
    [false, 1],
    [false, 1],
  ]);

  allowRelease = true;
  const recovered = streams.open(hub, id, signal);
  try {
    expect((await recovered.next()).done).toBe(false);
    expect(writes.slice(-2)).toEqual([
      [false, 1],
      [true, 2],
    ]);
  } finally {
    await recovered.return(undefined);
    await streams.close();
  }
});

it('keeps cameras with the same entity ID on different Hubs independent', async () => {
  const { createViewer, streams } = fixture();
  const signal = new AbortController().signal;
  const otherHub = 'http://other-hub.test';
  const first = streams.open(hub, id, signal);
  const other = streams.open(otherHub, id, signal);
  try {
    expect((await first.next()).done).toBe(false);
    expect((await other.next()).done).toBe(false);
    expect(createViewer.mock.calls).toEqual([[hub], [otherHub]]);
  } finally {
    await streams.close();
    await first.return(undefined);
    await other.return(undefined);
  }
});

it('validates recording UUIDs and tears down relay and viewer cleanly on openRecording', async () => {
  const clear = vi.fn();
  const media = vi.fn(async () => new Response(null, { status: 404 }));
  const spawn = vi.spyOn(OneFrameMedia.prototype, 'spawn');
  const runtime = new OneFrameMedia();
  const streams = new GpuiCameraStreams(runtime, () => ({
    request: async () => ({}),
    media,
    clear,
  }));

  const bad = streams.openRecording(hub, 'not-a-uuid', new AbortController().signal);
  await expect(bad.next()).rejects.toThrow('Invalid recording.');

  const validId = '12345678-1234-1234-1234-1234567890ab';
  const status = vi.fn();
  const frames = streams.openRecording(hub, validId, new AbortController().signal, {
    original: true,
    startSeconds: 4.5,
    onStatus: status,
  });
  try {
    expect((await frames.next()).done).toBe(false);
    expect(status).toHaveBeenCalledWith('playing');
    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-ss', '4.5']),
      expect.anything(),
    );
  } finally {
    await frames.return(undefined);
    expect(clear).toHaveBeenCalledTimes(1);
    await streams.close();
    spawn.mockRestore();
  }
});
