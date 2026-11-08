/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { listen, port, closeServer, stubStore } from '../support/http.js';
import { test, onTestFinished } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createApi } from '@haus/hub/runtime';
import { WarmStreams, type WarmStreamEntry } from '@haus/hub/camera';
const run = promisify(execFile);

test('FFmpeg decodes nested HLS and fMP4 through opaque source capabilities with extension checks enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-source-decode-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=10',
      '-t',
      '3',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-g',
      '10',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_segment_type',
      'fmp4',
      '-hls_playlist_type',
      'vod',
      join(root, 'media.m3u8'),
    ],
    { timeout: 15000 },
  );
  const ha = {
    stream: async () => 'http://private-ha/api/hls/private-token/master.m3u8',
    media: async (value: string) => {
      const name = basename(new URL(value).pathname);
      return new Response(
        name === 'master.m3u8'
          ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nmedia.m3u8\n'
          : await readFile(join(root, name)),
        {
          headers: {
            'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
          },
        },
      );
    },
  };
  const warm = new WarmStreams(ha, { buffers: new Map() });
  const token = 'a'.repeat(48);
  const entry: WarmStreamEntry & { source: string } = {
    id: 'camera.fixture',
    owners: new Map(),
    source: 'http://private-ha/api/hls/private-token/master.m3u8',
    expires: Date.now() + 60000,
  };
  warm.entries.set(entry.id, entry);
  warm.leases.set(token, entry);
  const server = createApi({
    config: { standalone: true, apiToken: 'fixture-only' },
    ha,
    store: stubStore(),
    recorder: {},
    warm,
    getRegistry: () => ({ cameras: [], states: [] }),
    refresh: async () => {},
  });
  await listen(server);
  onTestFinished(async () => {
    await warm.stop();
    server.closeAllConnections();
    await closeServer(server);
  });
  const source = `http://127.0.0.1:${port(server)}/cluster/source/${token}/${warm.resource(entry, entry.source)}`;
  const { stdout } = await run(
    'ffmpeg',
    ['-v', 'error', '-i', source, '-an', '-f', 'framemd5', '-'],
    { timeout: 15000 },
  );
  assert.equal(stdout.split('\n').filter((line) => line.startsWith('0,')).length, 30);
});
