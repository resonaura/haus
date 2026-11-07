/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HlsStreams } from '../../src/stream/hls.js';
import { MediaRuntime } from '../../src/pipeline/tools.js';
import { spawnFixture } from '../support/process.js';
test('stopping a relay during startup cannot spawn an orphan encoder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-relay-cancel-'));
  let spawned = 0;
  const streams = new HlsStreams(root, 'http://127.0.0.1:9999', {
    spawnProcess: () => {
      spawned++;
      throw new Error('unexpected encoder');
    },
  });
  try {
    await streams.initialize();
    const pending = streams.start(
      'http://127.0.0.1:9999/cluster/source/' + 'a'.repeat(48) + '/manifest.m3u8',
    );
    const rejected = assert.rejects(pending, /stream_stopped/);
    await streams.stop();
    await rejected;
    assert.equal(spawned, 0);
    assert.equal(streams.size, 0);
  } finally {
    await streams.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('a ready relay with a stale playlist is removed instead of serving a frozen stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-relay-stale-'));
  const streams = new HlsStreams(root, 'http://127.0.0.1:9999');
  const id = 'a'.repeat(36),
    dir = join(root, id);
  try {
    await mkdir(dir);
    const path = join(dir, 'index.m3u8');
    await writeFile(path, '#EXTM3U');
    const old = new Date(Date.now() - 31000);
    await utimes(path, old, old);
    streams.jobs.set(id, { id, dir, lastRead: Date.now(), state: 'ready' });
    await streams.prune();
    assert.equal(streams.size, 0);
    await assert.rejects(stat(dir));
  } finally {
    await streams.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('the relay uses its injected FFmpeg executable without a shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-relay-tool-'));
  let executable: string | undefined, receivedArgs: string[] | undefined;
  const streams = new HlsStreams(root, 'http://127.0.0.1:9999', {
    runtime: new MediaRuntime({
      tools: { ffmpeg: '/opt/media/ffmpeg-custom' },
      spawnProcess: spawnFixture((file, args, options) => {
        assert.equal(options?.shell, false);
        executable = file;
        receivedArgs = args;
        throw new Error('fixture_spawn_intercepted');
      }),
    }),
  });
  try {
    await streams.initialize();
    await assert.rejects(
      () =>
        streams.start('http://127.0.0.1:9999/cluster/source/' + 'a'.repeat(48) + '/manifest.m3u8'),
      /fixture_spawn_intercepted/,
    );
    assert.equal(executable, '/opt/media/ffmpeg-custom');
    assert.ok(Array.isArray(receivedArgs));
    assert.equal(streams.size, 0);
  } finally {
    await streams.stop();
    await rm(root, { recursive: true, force: true });
  }
});
