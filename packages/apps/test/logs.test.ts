/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DockerAppLifecycle, DockerLogDemuxer, DockerSocket } from '../src/index.js';

function encodeDockerFrame(streamType: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('Docker container log demuxing and live Unix socket streaming', () => {
  const containerId = 'a'.repeat(64);
  let server: Server | undefined;
  let socketPath: string | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    if (socketPath) {
      rmSync(socketPath, { force: true });
      socketPath = undefined;
    }
  });

  it('demultiplexes split 8-byte Docker frames and strips ANSI sequences', () => {
    const lines: string[] = [];
    const demuxer = new DockerLogDemuxer((line) => lines.push(line));
    const combined = Buffer.concat([
      encodeDockerFrame(1, '\x1b[32m2026-11-21T10:00:00Z MQTT connected\x1b[0m\n'),
      encodeDockerFrame(2, '2026-11-21T10:00:01Z stderr warning\r\nline two\n'),
    ]);

    // Feed arbitrary odd byte slices to exercise frame boundary reassembly.
    for (let i = 0; i < combined.length; i += 5) {
      demuxer.push(combined.subarray(i, i + 5));
    }
    demuxer.flush();

    expect(lines).toEqual([
      '2026-11-21T10:00:00Z MQTT connected',
      '2026-11-21T10:00:01Z stderr warning',
      'line two',
    ]);
  });

  it('handles raw TTY streams without 8-byte frame headers', () => {
    const lines: string[] = [];
    const demuxer = new DockerLogDemuxer((line) => lines.push(line));
    demuxer.push(Buffer.from('plain line one\nplain line two'));
    demuxer.flush();

    expect(lines).toEqual(['plain line one', 'plain line two']);
  });

  it('reads tail logs and streams follow=1 logs over DockerSocket with clean abort', async () => {
    socketPath = join(
      tmpdir(),
      `haus-docker-logs-${Date.now()}-${Math.random().toString(16).slice(2)}.sock`,
    );
    let streamClosedOnServer = false;

    server = createServer((req, res) => {
      if (req.url?.includes('follow=1')) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' });
        res.write(encodeDockerFrame(1, '2026-11-21T10:00:00Z initial line\n'));
        const timer = setTimeout(() => {
          res.write(encodeDockerFrame(1, '2026-11-21T10:00:01Z live line\n'));
        }, 25);
        req.once('close', () => {
          clearTimeout(timer);
          streamClosedOnServer = true;
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' });
      res.end(
        Buffer.concat([
          encodeDockerFrame(1, '2026-11-21T10:00:00Z snapshot one\n'),
          encodeDockerFrame(2, '2026-11-21T10:00:01Z snapshot two\n'),
        ]),
      );
    });

    await new Promise<void>((resolve) => server!.listen(socketPath!, resolve));

    const socket = new DockerSocket(socketPath);
    const lifecycle = new DockerAppLifecycle(socket, { dataRoot: '/tmp/apps' });

    const snapshot = await lifecycle.logs(containerId, { tail: 50 });
    expect(snapshot).toEqual([
      '2026-11-21T10:00:00Z snapshot one',
      '2026-11-21T10:00:01Z snapshot two',
    ]);

    const streamed: string[] = [];
    const controller = new AbortController();
    const streamPromise = lifecycle.streamLogs(
      containerId,
      { tail: 50 },
      (line) => {
        streamed.push(line);
        if (streamed.length >= 2) controller.abort();
      },
      controller.signal,
    );

    await streamPromise;
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(streamed).toEqual([
      '2026-11-21T10:00:00Z initial line',
      '2026-11-21T10:00:01Z live line',
    ]);
    expect(streamClosedOnServer).toBe(true);
  });
});
