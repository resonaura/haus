/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

export type Canvas2dPresentCallback = (width: number, height: number, rgba: Uint8Array) => void;

const MUTATING_2D_METHODS = new Set<string | symbol>([
  'clearRect',
  'fillRect',
  'strokeRect',
  'fill',
  'stroke',
  'fillText',
  'strokeText',
  'drawImage',
  'putImageData',
]);

/**
 * Skia-backed HTML5 2D canvas surface (`@napi-rs/canvas`) that tracks mutating draw calls
 * and coalesces straight-RGBA uploads into GPUI's GPU texture via `onPresent`.
 */
export class NativeCanvas2dSurface {
  private skia: Canvas;
  private rawCtx: SKRSContext2D;
  private readonly proxyCtx: SKRSContext2D;
  private dirty = false;
  private flushScheduled = false;
  private disposed = false;

  constructor(
    width: number,
    height: number,
    private readonly onPresent: Canvas2dPresentCallback,
  ) {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    this.skia = createCanvas(w, h);
    this.rawCtx = this.skia.getContext('2d');
    this.proxyCtx = this.createTrackingProxy();
  }

  get width(): number {
    return this.skia.width;
  }

  get height(): number {
    return this.skia.height;
  }

  get context(): SKRSContext2D {
    return this.proxyCtx;
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (w === this.skia.width && h === this.skia.height) return;
    this.skia = createCanvas(w, h);
    this.rawCtx = this.skia.getContext('2d');
    this.scheduleFlush();
  }

  flushNow(): void {
    if (this.disposed) return;
    this.dirty = false;
    const w = this.skia.width;
    const h = this.skia.height;
    if (w <= 0 || h <= 0) return;
    const imgData = this.rawCtx.getImageData(0, 0, w, h);
    const rgba = new Uint8Array(
      imgData.data.buffer,
      imgData.data.byteOffset,
      imgData.data.byteLength,
    );
    this.onPresent(w, h, rgba);
  }

  readRgbaPixels(): {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8Array;
  } {
    const w = this.skia.width;
    const h = this.skia.height;
    const imgData = this.rawCtx.getImageData(0, 0, w, h);
    return {
      width: w,
      height: h,
      pixels: new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
    };
  }

  toDataURL(mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png'): string {
    return this.skia.toDataURL(mimeType);
  }

  dispose(): void {
    this.disposed = true;
    this.dirty = false;
  }

  private scheduleFlush(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (this.dirty && !this.disposed) this.flushNow();
    });
  }

  private createTrackingProxy(): SKRSContext2D {
    return new Proxy({} as SKRSContext2D, {
      get: (_target, prop) => {
        const value = Reflect.get(this.rawCtx, prop, this.rawCtx) as unknown;
        if (typeof value !== 'function') return value;
        const mutates = MUTATING_2D_METHODS.has(prop);
        return (...args: unknown[]) => {
          const result = (value as (...params: unknown[]) => unknown).apply(this.rawCtx, args);
          if (mutates) this.scheduleFlush();
          return result;
        };
      },
      set: (_target, prop, value) => {
        Reflect.set(this.rawCtx, prop, value, this.rawCtx);
        return true;
      },
      has: (_target, prop) => prop in this.rawCtx,
    });
  }
}
