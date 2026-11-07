/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DetectionKind, VisionWorkerOptions, VisionWorkerPort } from './types.js';
import { defaultMediaRuntime, MediaRuntime, spawnRawVideoDecoder } from '@haus/media/pipeline';

const FRAME = 320 * 180 * 3;

/** Drop frames while inference is busy. Never queue seconds of obsolete motion analysis. */
export class VisionWorker implements VisionWorkerPort {
  children: ChildProcess[];
  state: string;
  calibrated: boolean;
  lastFrame: number;
  lastResult: number;
  processingMs?: number;
  stopped = false;
  timer?: ReturnType<typeof setInterval>;
  stopping?: Promise<PromiseSettledResult<void>[]>;

  constructor({
    source,
    mode = 'objects',
    headers,
    onDetection = () => {},
    spawnProcess,
    runtime = defaultMediaRuntime,
    interval = 1500,
    binaryPath = process.env.HAUS_VISION_BIN,
    pythonPath = process.env.HAUS_VISION_PYTHON || '/opt/vision-env/bin/python3',
    scriptPath,
  }: VisionWorkerOptions) {
    if (!['objects', 'motion'].includes(mode)) throw new Error('invalid_detection_mode');
    this.children = [];
    this.state = 'starting';
    this.calibrated = false;
    this.lastFrame = this.lastResult = Date.now();
    const workerSpawn = spawnProcess ?? runtime.spawnProcess;

    const defaultNativeBin = fileURLToPath(new URL('../bin/haus-vision-worker', import.meta.url));
    const effectiveBinary =
      binaryPath || (existsSync(defaultNativeBin) ? defaultNativeBin : undefined);

    let visionProcess: ChildProcess;
    if (effectiveBinary) {
      visionProcess = workerSpawn(effectiveBinary, [mode], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      const pythonScript =
        scriptPath || fileURLToPath(new URL('../vision/motion.py', import.meta.url));
      visionProcess = workerSpawn(pythonPath, [pythonScript, mode], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OPENBLAS_NUM_THREADS: '1',
          OMP_NUM_THREADS: '1',
        },
      });
    }
    this.children.push(visionProcess);

    let line = '',
      ready = false,
      busy = false,
      due = 0,
      capturedAt = 0;

    visionProcess.stdout?.on('data', (chunk: Buffer | string) => {
      line = (line + String(chunk)).slice(-16000);
      const lines = line.split('\n');
      line = lines.pop() || '';
      for (const value of lines) {
        try {
          const item = JSON.parse(value) as {
            type?: string;
            calibrated?: boolean;
            processingMs?: number;
            detections?: Array<{
              kind?: string;
              confidence?: number;
              box?: [number, number, number, number];
            }>;
          };
          if (item.type === 'ready') ready = true;
          if (item.type === 'frame') {
            busy = false;
            this.lastResult = Date.now();
            this.state = 'running';
            this.calibrated = item.calibrated === true;
            this.processingMs = item.processingMs;
            if (!this.calibrated) continue;
            for (const detection of (item.detections || []).slice(0, 3))
              if (detection.kind && ['person', 'pet', 'vehicle', 'motion'].includes(detection.kind))
                onDetection({
                  kind: detection.kind as DetectionKind,
                  confidence: detection.confidence,
                  box: detection.box,
                  at: capturedAt,
                });
          }
        } catch {
          /* An invalid diagnostic line cannot create a detection. */
        }
      }
    });

    visionProcess.stdin?.on('error', () => this.fail());

    const decoderRuntime = spawnProcess
      ? new MediaRuntime({ tools: runtime.tools, spawnProcess })
      : runtime;
    const decoder = spawnRawVideoDecoder({
      source,
      headers,
      width: 320,
      height: 180,
      fps: 1,
      runtime: decoderRuntime,
    });
    this.children.push(decoder);

    let pending = Buffer.alloc(FRAME),
      offset = 0;

    decoder.stdout?.on('data', (chunk: Buffer) => {
      let start = 0;
      while (start < chunk.length) {
        const length = Math.min(FRAME - offset, chunk.length - start);
        chunk.copy(pending, offset, start, start + length);
        start += length;
        offset += length;
        if (offset === FRAME) {
          this.lastFrame = Date.now();
          if (ready && !busy && this.lastFrame >= due && !this.stopped) {
            busy = true;
            capturedAt = this.lastFrame;
            due = this.lastFrame + Math.max(interval, (this.processingMs || 0) * 4);
            visionProcess.stdin?.write(pending);
            pending = Buffer.alloc(FRAME);
          }
          offset = 0;
        }
      }
    });

    for (const child of this.children) {
      child.stderr?.on('data', () => {});
      child.on('error', () => this.fail());
      child.on('exit', () => {
        if (!this.stopped) this.fail();
      });
    }

    this.timer = setInterval(() => {
      if (Date.now() - this.lastFrame > 25000 || Date.now() - this.lastResult > 30000) this.fail();
    }, 5000);
    this.timer.unref();
  }

  fail() {
    if (!this.stopped) {
      this.state = 'failed';
      void this.stop();
    }
  }

  async stop(): Promise<PromiseSettledResult<void>[]> {
    if (this.stopped) return this.stopping ?? Promise.allSettled([]);
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.stopping = Promise.allSettled(
      this.children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
            timer.unref();
            child.once('close', () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill('SIGTERM');
          }),
      ),
    );
    return this.stopping;
  }
}
