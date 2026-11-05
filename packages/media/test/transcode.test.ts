/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import {
  probeRtspSource,
  extractVideoSnapshot,
  runMediaProcess,
  spawnTalkbackPipe,
} from '../src/index.js';

interface FakeChildProcess extends EventEmitter {
  stdout?: EventEmitter;
  stderr?: EventEmitter;
  stdin?: EventEmitter;
  kill: (signal?: string) => void;
}

describe('@haus/media transcode & talkback engine (P11.2)', () => {
  it('probes RTSP stream using mock spawn and detects decoded frame', async () => {
    const fakeSpawn = (() => {
      const child = new EventEmitter() as FakeChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setTimeout(() => {
        child.stdout?.emit('data', Buffer.from('frame=1\nfps=30\n'));
        child.emit('close', 0);
      }, 10);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;

    const result = await probeRtspSource(
      { url: 'rtsp://127.0.0.1:8554/live' },
      undefined,
      { spawnProcess: fakeSpawn, timeout: 500 },
    );
    expect(result).toBe(true);
  });

  it('runs media process and captures output', async () => {
    const fakeSpawn = (() => {
      const child = new EventEmitter() as FakeChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setTimeout(() => {
        child.stdout?.emit('data', Buffer.from('{"duration": 12.5}'));
        child.emit('close', 0);
      }, 10);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;

    const res = await runMediaProcess('ffprobe', ['input.mp4'], {
      spawnProcess: fakeSpawn,
    });
    expect(res.stdout).toContain('12.5');
  });

  it('extracts video snapshot with appropriate scale and parameters', async () => {
    let capturedArgs: string[] = [];
    const fakeSpawn = ((_cmd: string, args: string[]) => {
      capturedArgs = args;
      const child = new EventEmitter() as FakeChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setTimeout(() => {
        child.emit('close', 0);
      }, 10);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;

    await extractVideoSnapshot('in.mp4', 'out.jpg', {
      timestamp: 2.5,
      width: 640,
      spawnProcess: fakeSpawn,
    });
    expect(capturedArgs).toContain('-ss');
    expect(capturedArgs).toContain('2.5');
    expect(capturedArgs).toContain('scale=640:-2:flags=area');
  });

  it('spawns talkback pipe targeting remote camera endpoint', () => {
    let capturedArgs: string[] = [];
    const fakeSpawn = ((_cmd: string, args: string[]) => {
      capturedArgs = args;
      const child = new EventEmitter() as FakeChildProcess;
      child.stdin = new EventEmitter();
      child.kill = () => {};
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;

    const pipe = spawnTalkbackPipe({
      targetUrl: 'rtsp://192.168.1.100/talk',
      spawnProcess: fakeSpawn,
    });
    expect(pipe).toBeDefined();
    expect(capturedArgs).toContain('rtsp://192.168.1.100/talk');
    expect(capturedArgs).toContain('-vn');
    expect(capturedArgs).toContain('-c:a');
  });
});
