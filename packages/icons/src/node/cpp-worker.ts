/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexColorToRgb, type ResolvedIconVariation } from '../appearance.js';
import {
  compositeSemanticPresentation,
  renderAllBaseLayers,
  type RenderedAllBaseLayers,
} from '../engine/enclosure.js';
import { APP_ICON_METRICS } from '../engine/parameters.js';

const OP_RENDER_ALL_BASE = 1;
const OP_COMPOSITE_SEMANTIC = 2;

export interface NativeBaseLayerResult extends RenderedAllBaseLayers {
  readonly engine: 'cpp' | 'ts';
}

interface PendingBaseRequest {
  readonly kind: 'base';
  readonly targetSize: number;
  readonly resolve: (value: NativeBaseLayerResult) => void;
  readonly reject: (err: Error) => void;
}

interface PendingCompositeRequest {
  readonly kind: 'composite';
  readonly resolve: (value: Uint8ClampedArray) => void;
  readonly reject: (err: Error) => void;
}

type PendingRequest = PendingBaseRequest | PendingCompositeRequest;

function defaultWorkerPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.HAUS_ICON_WORKER_BIN,
    '/usr/local/bin/haus-icon-worker',
    resolve(here, '../haus-icon-worker'),
    resolve(here, '../../dist/haus-icon-worker'),
    resolve('packages/icons/dist/haus-icon-worker'),
  ].filter((p): p is string => Boolean(p));
}

export function findIconWorkerBinary(customPath?: string): string | null {
  if (customPath && existsSync(customPath)) return customPath;
  for (const candidate of defaultWorkerPaths()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Persistent multi-threaded binary IPC bridge to the C++20 `haus-icon-worker`
 * executable, with automatic transparent fallback to the TypeScript engine
 * whenever the native binary is absent or unavailable.
 */
export class NativeIconWorkerPool {
  private proc: ChildProcessByStdio<Writable, Readable, null> | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextReqId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private binaryPath: string | null;
  private disabled = false;

  constructor(
    private readonly options: {
      readonly binaryPath?: string;
      readonly threads?: number;
      readonly allowCpp?: boolean;
    } = {},
  ) {
    this.binaryPath = options.allowCpp === false ? null : findIconWorkerBinary(options.binaryPath);
  }

  get activeEngine(): 'cpp' | 'ts' {
    return this.binaryPath && !this.disabled ? 'cpp' : 'ts';
  }

  private ensureProcess(): ChildProcessByStdio<Writable, Readable, null> | null {
    if (!this.binaryPath || this.disabled) return null;
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;

    const threads = Math.max(1, Math.min(8, this.options.threads ?? 4));
    const child = spawn(this.binaryPath, ['--threads', String(threads)], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainResponses();
    });
    child.on('error', () => {
      this.disabled = true;
      this.rejectAll(new Error('Native icon worker failed to launch'));
    });
    child.on('exit', () => {
      if (this.proc === child) this.proc = null;
      this.rejectAll(new Error('Native icon worker exited'));
    });
    this.proc = child;
    return child;
  }

  private drainResponses(): void {
    while (this.buffer.length >= 12) {
      const reqId = this.buffer.readUInt32LE(0);
      const status = this.buffer.readUInt32LE(4);
      const payloadLen = this.buffer.readUInt32LE(8);
      if (this.buffer.length < 12 + payloadLen) break;
      const payload = Buffer.from(this.buffer.subarray(12, 12 + payloadLen));
      this.buffer = this.buffer.subarray(12 + payloadLen);

      const pending = this.pending.get(reqId);
      if (!pending) continue;
      this.pending.delete(reqId);

      if (status !== 0) {
        pending.reject(new Error(`Native icon worker error code ${status}`));
        continue;
      }

      if (pending.kind === 'base') {
        this.resolveBaseResponse(pending, payload);
      } else {
        pending.resolve(
          new Uint8ClampedArray(payload.buffer, payload.byteOffset, payload.byteLength),
        );
      }
    }
  }

  private resolveBaseResponse(pending: PendingBaseRequest, payload: Buffer): void {
    if (payload.length < 16) {
      pending.reject(new Error('Truncated native base layer header'));
      return;
    }
    const width = payload.readUInt32LE(0);
    const height = payload.readUInt32LE(4);
    const bodySize = payload.readUInt32LE(8);
    const flags = payload.readUInt32LE(12);
    const layout: 'fill' | 'inset' = (flags & 1) !== 0 ? 'fill' : 'inset';
    const segmented = (flags & 2) !== 0;
    const planeBytes = width * height * 4;
    if (payload.length !== 16 + planeBytes * 4) {
      pending.reject(new Error('Unexpected native base layer payload size'));
      return;
    }
    const copyPlane = (index: number): Uint8Array => {
      const start = 16 + index * planeBytes;
      const out = new Uint8Array(planeBytes);
      out.set(payload.subarray(start, start + planeBytes));
      return out;
    };
    const defaultPlane = copyPlane(0);
    const darkPlane = copyPlane(1);
    const clearPlane = copyPlane(2);
    const tintedPlane = copyPlane(3);
    pending.resolve({
      width,
      height,
      bodySize,
      tileFraction: bodySize / Math.max(1, width),
      layout,
      segmented,
      branch: null,
      defaultRgba: new Uint8ClampedArray(defaultPlane.buffer),
      darkRgba: new Uint8ClampedArray(darkPlane.buffer),
      clearSemanticRgba: clearPlane,
      tintedSemanticRgba: tintedPlane,
      engine: 'cpp',
    });
  }

  private rejectAll(err: Error): void {
    this.buffer = Buffer.alloc(0);
    for (const req of this.pending.values()) req.reject(err);
    this.pending.clear();
  }

  async renderAllBase(
    sourceRgba: Uint8Array | Uint8ClampedArray,
    sourceWidth: number,
    sourceHeight: number,
    targetSize = 128,
    tileFraction = APP_ICON_METRICS.tileFraction,
  ): Promise<NativeBaseLayerResult> {
    const child = this.ensureProcess();
    if (child) {
      const reqId = this.nextReqId++;
      const payloadLen = 16 + sourceRgba.length;
      const frame = Buffer.allocUnsafe(12 + payloadLen);
      frame.writeUInt32LE(reqId, 0);
      frame.writeUInt32LE(OP_RENDER_ALL_BASE, 4);
      frame.writeUInt32LE(payloadLen, 8);
      frame.writeUInt32LE(targetSize, 12);
      frame.writeFloatLE(tileFraction, 16);
      frame.writeUInt32LE(sourceWidth, 20);
      frame.writeUInt32LE(sourceHeight, 24);
      frame.set(sourceRgba, 28);

      try {
        return await new Promise<NativeBaseLayerResult>((resolve, reject) => {
          this.pending.set(reqId, { kind: 'base', targetSize, resolve, reject });
          child.stdin.write(frame);
        });
      } catch {
        // Fall back to TypeScript engine transparently.
      }
    }

    const tsResult = renderAllBaseLayers(sourceRgba, sourceWidth, sourceHeight, {
      targetSize,
      tileFraction,
    });
    return { ...tsResult, engine: 'ts' };
  }

  async compositeSemantic(
    semanticRgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    options: {
      readonly appearance: 'clear' | 'tinted';
      readonly variation: ResolvedIconVariation;
      readonly tintHex: string;
      readonly tileFraction?: number;
      readonly displaySize?: number;
    },
  ): Promise<Uint8ClampedArray> {
    const tileFraction = options.tileFraction ?? APP_ICON_METRICS.tileFraction;
    const displaySize = options.displaySize ?? 44;
    const child = this.ensureProcess();
    if (child) {
      const reqId = this.nextReqId++;
      const [ar, ag, ab] = hexColorToRgb(options.tintHex);
      const payloadLen = 32 + semanticRgba.length;
      const frame = Buffer.allocUnsafe(12 + payloadLen);
      frame.writeUInt32LE(reqId, 0);
      frame.writeUInt32LE(OP_COMPOSITE_SEMANTIC, 4);
      frame.writeUInt32LE(payloadLen, 8);
      frame.writeUInt32LE(options.appearance === 'tinted' ? 1 : 0, 12);
      frame.writeUInt32LE(options.variation === 'dark' ? 1 : 0, 16);
      frame.writeFloatLE(ar, 20);
      frame.writeFloatLE(ag, 24);
      frame.writeFloatLE(ab, 28);
      frame.writeFloatLE(tileFraction, 32);
      frame.writeUInt32LE(width, 36);
      frame.writeUInt32LE((height & 0xffff) | ((displaySize & 0xffff) << 16), 40);
      frame.set(semanticRgba, 44);

      try {
        return await new Promise<Uint8ClampedArray>((resolve, reject) => {
          this.pending.set(reqId, { kind: 'composite', resolve, reject });
          child.stdin.write(frame);
        });
      } catch {
        // Fall back cleanly to TypeScript composite.
      }
    }

    return compositeSemanticPresentation(semanticRgba, width, height, {
      appearance: options.appearance,
      variation: options.variation,
      tintHex: options.tintHex,
      tileFraction,
      displaySize,
    });
  }

  dispose(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.proc = null;
    }
    this.rejectAll(new Error('Native icon worker disposed'));
  }
}
