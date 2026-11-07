/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cameraAccessKey } from '../src/camera/access.js';
import { cameraFileDigest } from '../src/pipeline/process.js';
import { CameraRing } from '../src/recording/ring.js';
import { RtspPeer } from '../src/camera/peer.js';
import { MediaRuntime } from '../src/pipeline/tools.js';

describe('@haus/media contracts', () => {
  it('derives stable HMAC-SHA256 camera access keys', () => {
    const key1 = cameraAccessKey('secret-passphrase', 'node-1', 'camera-front', 1700000000);
    const key2 = cameraAccessKey('secret-passphrase', 'node-1', 'camera-front', 1700000000);
    const key3 = cameraAccessKey('secret-passphrase', 'node-1', 'camera-back', 1700000000);
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64);
    expect(key1).not.toBe(key3);
  });

  it('computes sha256 digest of media files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'media-test-'));
    try {
      const file = join(dir, 'sample.txt');
      await writeFile(file, 'hello world\n');
      const digest = await cameraFileDigest(file);
      // sha256 of "hello world\n"
      expect(digest).toBe('a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('instantiates CameraRing with defaults and handles lifecycle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'camera-ring-test-'));
    try {
      const ring = new CameraRing(dir, 'rtsp://127.0.0.1:8554/live');
      expect(ring.ready()).toBe(false);
      await ring.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves the configured FFmpeg path when a process factory is injected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'camera-ring-runtime-'));
    let executable = '';
    const spawnProcess = ((file: string) => {
      executable = file;
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, {
        exitCode: null,
        signalCode: null,
        killed: false,
        kill: () => {
          Object.assign(child, { exitCode: 0 });
          queueMicrotask(() => child.emit('close', 0));
          return true;
        },
      });
      return child;
    }) as typeof import('node:child_process').spawn;
    const ring = new CameraRing(dir, 'rtsp://127.0.0.1:8554/live', {
      runtime: new MediaRuntime({ tools: { ffmpeg: '/opt/media/ffmpeg' } }),
      spawnProcess,
    });
    try {
      await ring.start();
      expect(executable).toBe('/opt/media/ffmpeg');
    } finally {
      await ring.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('instantiates RtspPeer and grants ticket', () => {
    const mockCameras = {
      owned: (id: string) => ({ id }),
      engine: {
        localRtsp: (id: string) => `rtsp://127.0.0.1:8554/${id}`,
      },
    };
    const peer = new RtspPeer(mockCameras);
    const grant = peer.grant({ sessionId: 'camera-1', owner: 'test-owner' });
    expect(grant.token).toHaveLength(64);
    expect(grant.path).toBe('/camera-1');
    peer.stop();
  });
});
