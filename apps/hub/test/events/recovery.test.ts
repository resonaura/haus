/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  PrimarySourceRecovery,
  probePrimarySource,
  runMedia,
} from '../../src/events/index.js';

describe('primary source recovery', () => {
  it('a working fallback stays alive during cooldown, failed probes and active events', async () => {
    let now = 0;
    let enabled = true;
    let attempts = 0;
    let promoted = 0;
    const recovery = new PrimarySourceRecovery({
      now: () => now,
      retryMs: 100,
      probe: async () => {
        attempts++;
        if (attempts === 1) throw Error('unavailable');
      },
    });
    const buffer = {};
    const options = {
      eligible: () => enabled,
      find: async () => ({ url: 'rtsp://127.0.0.1/live', kind: 'rtsp' }),
      promote: () => {
        promoted++;
      },
    };
    recovery.consider(buffer, options);
    now = 99;
    recovery.consider(buffer, options);
    expect(attempts).toBe(0);
    now = 100;
    await recovery.consider(buffer, options);
    expect(attempts).toBe(1);
    expect(promoted).toBe(0);
    now = 199;
    recovery.consider(buffer, options);
    expect(attempts).toBe(1);
    enabled = false;
    now = 200;
    recovery.consider(buffer, options);
    expect(attempts).toBe(1);
    enabled = true;
    await recovery.consider(buffer, options);
    expect(promoted).toBe(1);
    await recovery.stop();
  });

  it('one in-flight probe is shared across ticks and cannot promote a disabled or recording camera', async () => {
    for (const cancel of [false, true]) {
      let finish!: () => void;
      let promoted = 0;
      let enabled = true;
      let attempts = 0;
      const recovery = new PrimarySourceRecovery({
        retryMs: 0,
        probe: async () => {
          attempts++;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      });
      const buffer = {};
      const other = {};
      const options = {
        eligible: () => enabled,
        find: async () => ({ url: 'rtsp://127.0.0.1/live', kind: 'rtsp' }),
        promote: () => {
          promoted++;
        },
      };
      const work = recovery.consider(buffer, options);
      await Promise.resolve();
      recovery.consider(buffer, options);
      recovery.consider(other, options);
      expect(attempts).toBe(1);
      if (cancel) recovery.cancel(buffer);
      else enabled = false;
      finish();
      await work;
      expect(promoted).toBe(0);
      expect(recovery.active.size).toBe(0);
      await recovery.stop();
    }
  });

  it('shutdown cancels a probe before releasing its slot and no-RTSP discovery never interrupts HA', async () => {
    let promoted = 0;
    let stopped = false;
    const recovery = new PrimarySourceRecovery({
      retryMs: 0,
      probe: (_input, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              stopped = true;
              reject(Error('aborted'));
            },
            { once: true },
          );
        }),
    });
    const options = {
      eligible: () => true,
      find: async () => ({ url: 'http://127.0.0.1/hls', kind: 'ha' }),
      promote: () => {
        promoted++;
      },
    };
    await recovery.consider({}, options);
    expect(recovery.active.size).toBe(0);
    const work = recovery.consider(
      {},
      { ...options, find: async () => ({ url: 'rtsp://127.0.0.1/live', kind: 'rtsp' }) },
    );
    await Promise.resolve();
    await recovery.stop();
    await work;
    expect(stopped).toBe(true);
    expect(promoted).toBe(0);
    expect(recovery.active.size).toBe(0);
    recovery.consider({}, options);
    expect(recovery.active.size).toBe(0);
  });

  it('the real probe requires a decoded frame and cancels a stalled RTSP peer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-primary-source-'));
    const clients = new Set<Socket>();
    const abort = new AbortController();
    let reached = false;
    const server = createServer((socket) => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));
      socket.once('data', (bytes) => {
        reached = bytes.toString().includes('RTSP/1.0');
        abort.abort();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const input = join(root, 'picture.mp4');
      await runMedia('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=10',
        '-t',
        '0.2',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        input,
      ]);
      await probePrimarySource({ url: input }, new AbortController().signal);
      const invalid = join(root, 'empty.mp4');
      await writeFile(invalid, 'not video');
      await expect(
        probePrimarySource({ url: invalid }, new AbortController().signal),
      ).rejects.toThrow(/primary_source_unavailable/);

      const port = (server.address() as AddressInfo).port;
      const began = performance.now();
      await expect(
        probePrimarySource(
          {
            url: `rtsp://127.0.0.1:${port}/fixture`,
            inputArguments: ['-rtsp_transport', 'tcp'],
          },
          abort.signal,
        ),
      ).rejects.toThrow();
      expect(reached).toBe(true);
      expect(performance.now() - began).toBeLessThan(5000);
    } finally {
      for (const client of clients) client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
