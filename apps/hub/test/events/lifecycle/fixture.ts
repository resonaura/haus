/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, vi } from 'vitest';
import { Recorder, RecordingStore, type RecorderBuffer } from '../../../src/events/index.js';
import { openCatalog, Transactions } from '../../../src/storage/index.js';

export const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function lifecycleFixture() {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(async () => {
    try {
      for (const close of cleanups.splice(0).reverse()) await close();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  async function fixture({ localCapture = false }: { localCapture?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'haus-recorder-lifecycle-'));
    const source = await openCatalog(join(root, 'catalog.sqlite'));
    const transactions = new Transactions(source);
    const store = new RecordingStore(source, join(root, 'media'), transactions);
    await mkdir(store.media);
    const capture = {
      events: new Set<string>(),
      buffers: new Map<string, RecorderBuffer>(),
      sync: vi.fn(),
      record: vi.fn(async () => {}),
      finalize: vi.fn(async () => {}),
    };
    const recorder = new Recorder(
      {
        data: root,
        media: store.media,
        recording_enabled: true,
        record_audio: false,
        pre_roll_seconds: 6,
        post_roll_seconds: 10,
        max_event_seconds: 60,
        max_storage_gb: 1,
        max_buffer_gb: 1,
      },
      {},
      store,
      undefined,
      { capture: localCapture ? undefined : capture },
    );
    const teardown: { expectedStopError?: unknown } = {};
    cleanups.push(async () => {
      try {
        await recorder.stop().catch((error: unknown) => {
          if (!Object.hasOwn(teardown, 'expectedStopError') || error !== teardown.expectedStopError)
            throw error;
        });
        await store.close();
        await transactions.drain();
      } finally {
        if (source.isInitialized) await source.destroy();
        await rm(root, { recursive: true, force: true });
      }
    });
    return { recorder, store, capture, root, teardown };
  }

  return fixture;
}
