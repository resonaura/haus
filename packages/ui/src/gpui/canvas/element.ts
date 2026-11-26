/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCanvas, ImageData as SkiaImageData, type SKRSContext2D } from '@napi-rs/canvas';
import type { ImgInstance } from '@gpuix/react';
import { NativeCanvas2dSurface } from './canvas-2d.js';
import { createNativeWebGL2Context, type NativeWebGL2Context } from './webgl/context.js';
import type { ExtractedImageSource } from './webgl/framebuffer.js';
import type { NativeWebGLContextAttributes } from './webgl/types.js';

export type GpuiCanvasContextKind = '2d' | 'webgl2' | 'webgl' | 'experimental-webgl';

export interface GpuiCanvasRect {
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

type CanvasEventListener = (event: Record<string, unknown>) => void;

interface PendingFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly format: 'rgba' | 'bgra';
}

const TRANSPARENT_PIXEL = new Uint8Array(4);

function createMiniDocument() {
  return {
    createElement: (tag: string) => {
      if (tag.toLowerCase() === 'canvas') return new GpuiCanvasElement(300, 150);
      return { tagName: tag.toUpperCase(), style: {} };
    },
    createElementNS: (_ns: string, tag: string) => {
      if (tag.toLowerCase() === 'canvas') return new GpuiCanvasElement(300, 150);
      return { tagName: tag.toUpperCase(), style: {} };
    },
  };
}

/**
 * HTML5 `<canvas>`-compatible element for GPUIX supporting BOTH Skia Canvas 2D
 * (`CanvasRenderingContext2D`) and hardware-accelerated OpenGL Core WebGL 2
 * (`WebGL2RenderingContext`, compatible with Three.js `THREE.WebGLRenderer`).
 */
export class GpuiCanvasElement {
  readonly tagName = 'CANVAS';
  readonly nodeName = 'CANVAS';
  readonly style: Record<string, string> = { width: '', height: '', display: 'block' };
  readonly ownerDocument = createMiniDocument();

  private _width: number;
  private _height: number;
  private layoutRect: GpuiCanvasRect;
  private contextMode: '2d' | 'webgl2' | null = null;
  private surface2d: NativeCanvas2dSurface | null = null;
  private webgl2: NativeWebGL2Context | null = null;
  private imageTarget: ImgInstance | null = null;
  private lastFrame: PendingFrame | null = null;
  private readonly listeners = new Map<string, Set<CanvasEventListener>>();
  private disposed = false;

  constructor(width = 300, height = 150) {
    this._width = Math.max(1, width | 0);
    this._height = Math.max(1, height | 0);
    this.layoutRect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this._width,
      bottom: this._height,
      width: this._width,
      height: this._height,
    };
  }

  get width(): number {
    return this._width;
  }

  set width(value: number) {
    const next = Math.max(1, Math.round(Number(value) || 1));
    if (next === this._width) return;
    this._width = next;
    this.syncBackingSize();
  }

  get height(): number {
    return this._height;
  }

  set height(value: number) {
    const next = Math.max(1, Math.round(Number(value) || 1));
    if (next === this._height) return;
    this._height = next;
    this.syncBackingSize();
  }

  get clientWidth(): number {
    return this.layoutRect.width || this._width;
  }

  get clientHeight(): number {
    return this.layoutRect.height || this._height;
  }

  get offsetWidth(): number {
    return this.clientWidth;
  }

  get offsetHeight(): number {
    return this.clientHeight;
  }

  getContext(contextId: '2d', options?: Record<string, unknown>): SKRSContext2D | null;
  getContext(
    contextId: 'webgl2' | 'webgl' | 'experimental-webgl',
    options?: NativeWebGLContextAttributes,
  ): NativeWebGL2Context | null;
  getContext(
    contextId: string,
    options?: NativeWebGLContextAttributes | Record<string, unknown>,
  ): SKRSContext2D | NativeWebGL2Context | null;
  getContext(
    contextId: string,
    options?: NativeWebGLContextAttributes | Record<string, unknown>,
  ): SKRSContext2D | NativeWebGL2Context | null {
    if (this.disposed) return null;
    if (contextId === '2d') {
      if (this.contextMode === 'webgl2') return null;
      this.contextMode = '2d';
      if (!this.surface2d) {
        this.surface2d = new NativeCanvas2dSurface(this._width, this._height, (w, h, rgba) => {
          this.presentFrame(w, h, rgba, 'rgba');
        });
      }
      return this.surface2d.context;
    }
    if (contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl') {
      if (this.contextMode === '2d') return null;
      this.contextMode = 'webgl2';
      if (!this.webgl2) {
        this.webgl2 = createNativeWebGL2Context(
          this,
          options as NativeWebGLContextAttributes | undefined,
          (w, h, bgra) => {
            this.presentFrame(w, h, bgra, 'bgra');
          },
        );
      }
      return this.webgl2;
    }
    return null;
  }

  getBoundingClientRect(): GpuiCanvasRect {
    return this.layoutRect;
  }

  addEventListener(type: string, listener: CanvasEventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: CanvasEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Record<string, unknown> & { readonly type: string }): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const fn of set) fn(event);
    return true;
  }

  setPointerCapture(_pointerId: number): void {
    // No-op stub for OrbitControls / pointer libraries.
  }

  releasePointerCapture(_pointerId: number): void {
    // No-op stub for OrbitControls / pointer libraries.
  }

  focus(): void {
    this.dispatchEvent({ type: 'focus', target: this });
  }

  blur(): void {
    this.dispatchEvent({ type: 'blur', target: this });
  }

  /** Synchronously uploads the current 2D or WebGL2 framebuffer to GPUI's GPU image. */
  flush(): void {
    if (this.disposed) return;
    if (this.surface2d) {
      this.surface2d.flushNow();
    } else if (this.webgl2) {
      this.webgl2.presentNow();
    }
  }

  /** Internal helper used by `gl.texImage2D` so any `GpuiCanvasElement` works as a WebGL texture. */
  __readRgbaPixels(): ExtractedImageSource | null {
    if (this.surface2d) return this.surface2d.readRgbaPixels();
    if (this.webgl2) {
      const { width, height, bgra } = this.webgl2.readCurrentBgra();
      const rgba = new Uint8Array(bgra.length);
      for (let i = 0; i + 3 < bgra.length; i += 4) {
        rgba[i] = bgra[i + 2] ?? 0;
        rgba[i + 1] = bgra[i + 1] ?? 0;
        rgba[i + 2] = bgra[i] ?? 0;
        rgba[i + 3] = bgra[i + 3] ?? 255;
      }
      return { width, height, pixels: rgba };
    }
    return null;
  }

  toDataURL(mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png'): string {
    if (this.surface2d) return this.surface2d.toDataURL(mimeType);
    const extracted = this.__readRgbaPixels();
    if (!extracted) return '';
    const tmp = createCanvas(extracted.width, extracted.height);
    const ctx = tmp.getContext('2d');
    const clamped = new Uint8ClampedArray(
      extracted.pixels.buffer,
      extracted.pixels.byteOffset,
      extracted.pixels.byteLength,
    );
    ctx.putImageData(new SkiaImageData(clamped, extracted.width, extracted.height), 0, 0);
    return tmp.toDataURL(mimeType);
  }

  attachImage(target: ImgInstance | null): void {
    this.imageTarget = target;
    if (!target) return;
    if (this.lastFrame) {
      target.setImagePixels(this.lastFrame.width, this.lastFrame.height, this.lastFrame.pixels, {
        format: this.lastFrame.format,
      });
    } else {
      target.setImagePixels(1, 1, TRANSPARENT_PIXEL, { format: 'rgba' });
    }
  }

  setLayoutBounds(x: number, y: number, width: number, height: number): void {
    this.layoutRect = {
      x,
      y,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.surface2d?.dispose();
    this.webgl2?.dispose();
    this.surface2d = null;
    this.webgl2 = null;
    this.imageTarget = null;
    this.lastFrame = null;
    this.listeners.clear();
  }

  private syncBackingSize(): void {
    this.surface2d?.resize(this._width, this._height);
    this.webgl2?.resize(this._width, this._height);
  }

  private presentFrame(
    width: number,
    height: number,
    pixels: Uint8Array,
    format: 'rgba' | 'bgra',
  ): void {
    if (this.disposed) return;
    this.lastFrame = { width, height, pixels, format };
    this.imageTarget?.setImagePixels(width, height, pixels, { format });
  }
}

export function createNativeCanvas(width = 300, height = 150): GpuiCanvasElement {
  return new GpuiCanvasElement(width, height);
}

let globalsInstalled = false;

/**
 * Installs lightweight HTML5 canvas globals (`HTMLCanvasElement`, `OffscreenCanvas`, `ImageData`,
 * `requestAnimationFrame`, `document.createElement('canvas')`, `devicePixelRatio`) in the GPUIX
 * JS runtime so standard web canvas & Three.js libraries work out-of-the-box.
 */
export function installGpuiCanvasGlobals(): void {
  if (globalsInstalled) return;
  globalsInstalled = true;
  const g = globalThis as Record<string, unknown>;
  if (g.HTMLCanvasElement === undefined) g.HTMLCanvasElement = GpuiCanvasElement;
  if (g.OffscreenCanvas === undefined) g.OffscreenCanvas = GpuiCanvasElement;
  if (g.ImageData === undefined) g.ImageData = SkiaImageData;
  if (g.devicePixelRatio === undefined) g.devicePixelRatio = 2;
  if (g.document === undefined) g.document = createMiniDocument();
  if (g.self === undefined) g.self = globalThis;
  if (typeof g.requestAnimationFrame !== 'function') {
    let nextRafId = 1;
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    g.requestAnimationFrame = (cb: (time: number) => void): number => {
      const id = nextRafId++;
      const timer = setTimeout(() => {
        timers.delete(id);
        cb(performance.now());
      }, 16);
      timers.set(id, timer);
      return id;
    };
    g.cancelAnimationFrame = (id: number): void => {
      const timer = timers.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(id);
      }
    };
  }
}
