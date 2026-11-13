/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaRuntime } from '@haus/media/pipeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultCameraService } from '../../src/camera/camera.service.js';
import {
  captureBufferFrame,
  captureRtspFrame,
  extractCompleteJpeg,
} from '../../src/camera/control/frame.js';
import { CameraSnapshots } from '../../src/camera/control/snapshots.js';
import { createSessionsFixture } from './sessions-fixture.js';

const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);

function scriptRuntime(script: string): MediaRuntime {
  const port = { spawn };
  vi.spyOn(port, 'spawn').mockImplementation((_tool, args) =>
    spawn(process.execPath, ['-e', script, '--', ...(args ?? [])], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
  return new MediaRuntime({ spawnProcess: port.spawn });
}

describe('extractCompleteJpeg', () => {
  it('returns valid JPEG bounds and strips trailing bytes after EOI', () => {
    const padded = Buffer.concat([VALID_JPEG, Buffer.from([0x00, 0x01, 0x02])]);
    expect(extractCompleteJpeg(padded)?.equals(VALID_JPEG)).toBe(true);
    expect(extractCompleteJpeg(VALID_JPEG.subarray(0, 6))).toBeNull();
    expect(extractCompleteJpeg(Buffer.from('not-a-jpeg'))).toBeNull();
  });
});

describe('captureRtspFrame', () => {
  it('accepts a complete JPEG frame even when FFmpeg exits with a non-zero code', async () => {
    const hex = VALID_JPEG.toString('hex');
    const runtime = scriptRuntime(
      `if (!process.argv.includes('nobuffer')) process.exit(2); process.stdout.write(Buffer.from('${hex}', 'hex'), () => process.exit(69));`,
    );
    const buf = await captureRtspFrame(runtime, 'rtsp://127.0.0.1:554/ch1');
    expect(buf.equals(VALID_JPEG)).toBe(true);
  });

  it('rejects when FFmpeg exits non-zero without a complete JPEG frame', async () => {
    const partialHex = VALID_JPEG.subarray(0, 5).toString('hex');
    const runtime = scriptRuntime(
      `process.stdout.write(Buffer.from('${partialHex}', 'hex'), () => process.exit(69));`,
    );
    await expect(captureRtspFrame(runtime, 'rtsp://127.0.0.1:554/ch1')).rejects.toThrow(
      'rtsp_snapshot_exit_69',
    );
  });

  it('rejects frames exceeding 6 MiB', async () => {
    const runtime = scriptRuntime(
      'process.stdout.write(Buffer.alloc(6 * 1024 * 1024 + 10, 0xaa));',
    );
    await expect(captureRtspFrame(runtime, 'rtsp://127.0.0.1:554/ch1')).rejects.toThrow(
      'rtsp_snapshot_too_large',
    );
  });
});

describe('captureBufferFrame', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('selects the newest valid segment and falls back if it cannot decode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-buffer-frame-'));
    dirs.push(dir);
    const older = join(dir, 'b1700000000000-abcdef01-000000001.mp4');
    const newer = join(dir, 'b1700000000000-abcdef01-000000002.mp4');
    const tiny = join(dir, 'b1700000000000-abcdef01-000000003.mp4');
    const ignored = join(dir, 'index.csv');
    const attemptsFile = join(dir, 'attempts.txt');

    await writeFile(older, Buffer.alloc(5000, 1));
    await writeFile(newer, Buffer.alloc(5000, 2));
    await writeFile(tiny, Buffer.alloc(100, 3));
    await writeFile(ignored, 'csv');

    const now = Date.now() / 1000;
    await utimes(older, now - 10, now - 10);
    await utimes(newer, now - 2, now - 2);
    await utimes(tiny, now, now);

    const hex = VALID_JPEG.toString('hex');
    const runtime = scriptRuntime(
      [
        'const fs = require("node:fs");',
        'const args = process.argv.slice(1);',
        'const i = args.indexOf("-i");',
        'const input = i >= 0 ? args[i + 1] : "";',
        `fs.appendFileSync(${JSON.stringify(attemptsFile)}, input + "\\n");`,
        `if (input === ${JSON.stringify(newer)}) process.exit(1);`,
        `process.stdout.write(Buffer.from('${hex}', 'hex'), () => process.exit(0));`,
      ].join(' '),
    );

    const frame = await captureBufferFrame(runtime, dir);
    expect(frame.equals(VALID_JPEG)).toBe(true);
    const attempts = await readFile(attemptsFile, 'utf8');
    expect(attempts.trim().split('\n')).toEqual([newer, older]);
  });
});

describe('DefaultCameraService standalone vs cluster snapshot fallback', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it('propagates snapshot_busy when no RTSP source exists', async () => {
    const fixture = await createSessionsFixture();
    cleanups.push(fixture.cleanup);
    fixture.nodes.length = 0;

    const snapshots = new CameraSnapshots({
      config: { data: fixture.root },
      sessions: fixture.sessions,
    });
    vi.spyOn(snapshots, 'snapshot').mockRejectedValue(new Error('snapshot_busy'));

    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      snapshots,
      undefined,
      undefined,
      undefined,
      fixture.sessions,
    );
    svc.registerCamera({ id: 'camera.no_rtsp', name: 'No RTSP' });

    await expect(svc.getSnapshot('camera.no_rtsp')).rejects.toThrow('snapshot_busy');
  });

  it('tries cluster snapshots first when an enabled stream node exists', async () => {
    const fixture = await createSessionsFixture();
    cleanups.push(fixture.cleanup);

    const snapshots = new CameraSnapshots({
      config: { data: fixture.root },
      sessions: fixture.sessions,
    });
    const spy = vi.spyOn(snapshots, 'snapshot').mockResolvedValue({
      buffer: VALID_JPEG,
      mime: 'image/jpeg',
      at: 1234,
      stale: false,
      checkedAt: 1234,
    });

    const svc = new DefaultCameraService(
      undefined,
      undefined,
      undefined,
      snapshots,
      undefined,
      undefined,
      undefined,
      fixture.sessions,
    );
    svc.registerCamera({
      id: 'camera.cluster_cam',
      name: 'Cluster Cam',
      rtspUrl: 'rtsp://127.0.0.1:1/live',
    });

    const snap = await svc.getSnapshot('camera.cluster_cam');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(snap.buffer.equals(VALID_JPEG)).toBe(true);
  });
});
