/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { MediaRuntime } from '../../src/pipeline/tools.js';
import { port } from './values.js';

/** Synthetic source shared by media engine and Hub wire tests; all FFmpeg arguments stay here. */
export async function hlsFixture(root: string) {
  const input = join(root, 'input');
  await mkdir(input);
  const source = new MediaRuntime().spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-re',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=20',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-g',
      '20',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_list_size',
      '5',
      '-hls_flags',
      'delete_segments',
      '-hls_segment_filename',
      join(input, 'source-%09d.ts'),
      join(input, 'index.m3u8'),
    ],
    { stdio: 'ignore' },
  );
  let failure: Error | undefined,
    closed = false;
  source.on('error', (error) => {
    failure = error;
  });
  source.on('close', () => {
    closed = true;
  });
  const gate = createServer(async (req, res) => {
    try {
      const name = new URL(req.url ?? '/', 'http://fixture').pathname.split('/').at(-1) ?? '';
      if (!/^(manifest\.m3u8|source-\d+\.ts)$/.test(name)) {
        res.writeHead(403).end();
        return;
      }
      const bytes = await readFile(join(input, name === 'manifest.m3u8' ? 'index.m3u8' : name));
      res
        .writeHead(200, {
          'Content-Type': name === 'manifest.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        })
        .end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  const stop = async () => {
    gate.closeAllConnections();
    if (gate.listening)
      await new Promise<void>((resolve, reject) =>
        gate.close((error) => (error ? reject(error) : resolve())),
      );
    if (!closed) {
      const ended = new Promise<void>((resolve) => source.once('close', () => resolve()));
      source.kill('SIGKILL');
      await ended;
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      gate.once('error', reject);
      gate.listen(0, '127.0.0.1', () => {
        gate.removeListener('error', reject);
        resolve();
      });
    });
    return {
      origin: `http://127.0.0.1:${port(gate)}`,
      ready: async () => {
        const deadline = Date.now() + 8000;
        while (!(await stat(join(input, 'index.m3u8')).catch(() => null))) {
          if (failure) throw failure;
          assert.ok(!closed && Date.now() < deadline, 'source fixture startup');
          await pause(100);
        }
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
