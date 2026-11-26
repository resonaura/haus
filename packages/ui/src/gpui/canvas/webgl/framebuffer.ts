/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WEBGL2_CONSTANTS as GL } from './constants.js';
import type { NativeGlContext } from './types.js';

export interface PixelUnpackState {
  flipY: boolean;
  premultiplyAlpha: boolean;
}

export interface ExtractedImageSource {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export function asUint8Bytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

export function sliceFloat32(
  value: Float32List | readonly number[],
  srcOffset = 0,
  srcLength = 0,
): Float32Array {
  const arr = value instanceof Float32Array ? value : new Float32Array(value);
  if (srcOffset === 0 && srcLength === 0) return arr;
  const end = srcLength > 0 ? srcOffset + srcLength : arr.length;
  return arr.subarray(srcOffset, end);
}

export function sliceInt32(
  value: Int32List | readonly number[],
  srcOffset = 0,
  srcLength = 0,
): Int32Array {
  const arr = value instanceof Int32Array ? value : new Int32Array(value);
  if (srcOffset === 0 && srcLength === 0) return arr;
  const end = srcLength > 0 ? srcOffset + srcLength : arr.length;
  return arr.subarray(srcOffset, end);
}

export function sliceUint32(
  value: Uint32List | readonly number[],
  srcOffset = 0,
  srcLength = 0,
): Uint32Array {
  const arr = value instanceof Uint32Array ? value : new Uint32Array(value);
  if (srcOffset === 0 && srcLength === 0) return arr;
  const end = srcLength > 0 ? srcOffset + srcLength : arr.length;
  return arr.subarray(srcOffset, end);
}

export function extractPixelSource(source: unknown): ExtractedImageSource | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as {
    readonly width?: unknown;
    readonly height?: unknown;
    readonly data?: unknown;
    readonly getContext?: (kind: string) => unknown;
    readonly __readRgbaPixels?: () => ExtractedImageSource | null;
  };
  if (typeof obj.__readRgbaPixels === 'function') {
    return obj.__readRgbaPixels();
  }
  if (
    typeof obj.width === 'number' &&
    typeof obj.height === 'number' &&
    obj.data &&
    ArrayBuffer.isView(obj.data)
  ) {
    return {
      width: Math.max(1, obj.width | 0),
      height: Math.max(1, obj.height | 0),
      pixels: asUint8Bytes(obj.data),
    };
  }
  if (
    typeof obj.width === 'number' &&
    typeof obj.height === 'number' &&
    typeof obj.getContext === 'function'
  ) {
    const ctx = obj.getContext('2d') as {
      getImageData?: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
    } | null;
    if (ctx && typeof ctx.getImageData === 'function' && obj.width > 0 && obj.height > 0) {
      const w = obj.width | 0;
      const h = obj.height | 0;
      const imageData = ctx.getImageData(0, 0, w, h);
      return { width: w, height: h, pixels: asUint8Bytes(imageData.data) };
    }
  }
  return null;
}

function bytesPerPixel(format: number, type: number): number {
  const channels =
    format === GL.RED || format === GL.ALPHA || format === GL.LUMINANCE || format === GL.RED_INTEGER
      ? 1
      : format === GL.RG || format === GL.LUMINANCE_ALPHA || format === GL.RG_INTEGER
        ? 2
        : format === GL.RGB || format === GL.RGB_INTEGER
          ? 3
          : 4;
  const compSize =
    type === GL.FLOAT || type === GL.UNSIGNED_INT || type === GL.INT
      ? 4
      : type === GL.HALF_FLOAT || type === GL.UNSIGNED_SHORT || type === GL.SHORT
        ? 2
        : 1;
  return channels * compSize;
}

export function applyPixelUnpack(
  pixels: Uint8Array,
  width: number,
  height: number,
  format: number,
  type: number,
  unpack: PixelUnpackState,
): Uint8Array {
  if (!unpack.flipY && !unpack.premultiplyAlpha) return pixels;
  const bpp = bytesPerPixel(format, type);
  const rowBytes = width * bpp;
  if (rowBytes <= 0 || pixels.byteLength < rowBytes * height) return pixels;
  const out = new Uint8Array(pixels.byteLength);
  if (unpack.flipY) {
    for (let y = 0; y < height; y++) {
      const srcOff = (height - 1 - y) * rowBytes;
      out.set(pixels.subarray(srcOff, srcOff + rowBytes), y * rowBytes);
    }
  } else {
    out.set(pixels);
  }
  if (unpack.premultiplyAlpha && format === GL.RGBA && type === GL.UNSIGNED_BYTE) {
    for (let i = 0; i + 3 < out.length; i += 4) {
      const a = out[i + 3] ?? 255;
      if (a === 255) continue;
      if (a === 0) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
      } else {
        const k = a / 255;
        out[i] = Math.round((out[i] ?? 0) * k);
        out[i + 1] = Math.round((out[i + 1] ?? 0) * k);
        out[i + 2] = Math.round((out[i + 2] ?? 0) * k);
      }
    }
  }
  return out;
}

/**
 * Owns the default offscreen framebuffer (optional 4x MSAA + RGBA8 resolve texture + DEPTH24_STENCIL8)
 * so WebGL `bindFramebuffer(..., null)` draws offscreen and resolves to top-down BGRA pixels.
 */
export class OffscreenFramebuffer {
  private resolveFbo = 0;
  private resolveColorTex = 0;
  private resolveDepthRb = 0;
  private msaaFbo = 0;
  private msaaColorRb = 0;
  private msaaDepthRb = 0;
  private samples = 0;
  width = 0;
  height = 0;
  private bgraBuffer = new Uint8Array(0);

  constructor(
    private readonly gl: NativeGlContext,
    private readonly antialias: boolean,
  ) {}

  get drawFramebufferId(): number {
    return this.msaaFbo || this.resolveFbo;
  }

  get readFramebufferId(): number {
    return this.resolveFbo;
  }

  get sampleCount(): number {
    return this.samples;
  }

  ensureSize(width: number, height: number): void {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (w === this.width && h === this.height && this.resolveFbo !== 0) return;

    this.releaseResources();
    this.width = w;
    this.height = h;
    this.gl.makeCurrent();

    this.resolveFbo = this.gl.genFramebuffer();
    this.resolveColorTex = this.gl.genTexture();
    this.resolveDepthRb = this.gl.genRenderbuffer();
    this.gl.bindFramebuffer(GL.FRAMEBUFFER, this.resolveFbo);
    this.gl.bindTexture(GL.TEXTURE_2D, this.resolveColorTex);
    this.gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA8, w, h, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    this.gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    this.gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    this.gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.COLOR_ATTACHMENT0,
      GL.TEXTURE_2D,
      this.resolveColorTex,
      0,
    );
    this.gl.bindRenderbuffer(GL.RENDERBUFFER, this.resolveDepthRb);
    this.gl.renderbufferStorage(GL.RENDERBUFFER, GL.DEPTH24_STENCIL8, w, h);
    this.gl.framebufferRenderbuffer(
      GL.FRAMEBUFFER,
      GL.DEPTH_STENCIL_ATTACHMENT,
      GL.RENDERBUFFER,
      this.resolveDepthRb,
    );

    if (this.antialias) {
      const targetSamples = Math.min(4, this.gl.getInteger(GL.MAX_SAMPLES));
      if (targetSamples >= 2) {
        const msaaFbo = this.gl.genFramebuffer();
        const msaaColor = this.gl.genRenderbuffer();
        const msaaDepth = this.gl.genRenderbuffer();
        this.gl.bindFramebuffer(GL.FRAMEBUFFER, msaaFbo);
        this.gl.bindRenderbuffer(GL.RENDERBUFFER, msaaColor);
        this.gl.renderbufferStorageMultisample(GL.RENDERBUFFER, targetSamples, GL.RGBA8, w, h);
        this.gl.framebufferRenderbuffer(
          GL.FRAMEBUFFER,
          GL.COLOR_ATTACHMENT0,
          GL.RENDERBUFFER,
          msaaColor,
        );
        this.gl.bindRenderbuffer(GL.RENDERBUFFER, msaaDepth);
        this.gl.renderbufferStorageMultisample(
          GL.RENDERBUFFER,
          targetSamples,
          GL.DEPTH24_STENCIL8,
          w,
          h,
        );
        this.gl.framebufferRenderbuffer(
          GL.FRAMEBUFFER,
          GL.DEPTH_STENCIL_ATTACHMENT,
          GL.RENDERBUFFER,
          msaaDepth,
        );
        if (this.gl.checkFramebufferStatus(GL.FRAMEBUFFER) === GL.FRAMEBUFFER_COMPLETE) {
          this.msaaFbo = msaaFbo;
          this.msaaColorRb = msaaColor;
          this.msaaDepthRb = msaaDepth;
          this.samples = targetSamples;
        } else {
          this.gl.deleteFramebuffer(msaaFbo);
          this.gl.deleteRenderbuffer(msaaColor);
          this.gl.deleteRenderbuffer(msaaDepth);
          this.gl.bindFramebuffer(GL.FRAMEBUFFER, this.resolveFbo);
        }
      }
    }

    this.gl.bindTexture(GL.TEXTURE_2D, 0);
    this.gl.bindRenderbuffer(GL.RENDERBUFFER, 0);
    this.gl.bindFramebuffer(GL.FRAMEBUFFER, this.drawFramebufferId);
  }

  readBgraPixels(restoreDrawFbo: number, restoreReadFbo: number): Uint8Array {
    const byteLen = this.width * this.height * 4;
    if (this.bgraBuffer.length !== byteLen) this.bgraBuffer = new Uint8Array(byteLen);
    this.gl.makeCurrent();
    if (this.msaaFbo !== 0) {
      this.gl.bindFramebuffer(GL.READ_FRAMEBUFFER, this.msaaFbo);
      this.gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, this.resolveFbo);
      this.gl.blitFramebuffer(
        0,
        0,
        this.width,
        this.height,
        0,
        0,
        this.width,
        this.height,
        GL.COLOR_BUFFER_BIT,
        GL.NEAREST,
      );
    }
    this.gl.bindFramebuffer(GL.READ_FRAMEBUFFER, this.resolveFbo);
    this.gl.readFramebufferBgraFlipped(this.width, this.height, this.bgraBuffer);
    this.gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, restoreDrawFbo || this.drawFramebufferId);
    this.gl.bindFramebuffer(GL.READ_FRAMEBUFFER, restoreReadFbo || this.readFramebufferId);
    return this.bgraBuffer;
  }

  releaseResources(): void {
    if (this.msaaFbo) this.gl.deleteFramebuffer(this.msaaFbo);
    if (this.msaaColorRb) this.gl.deleteRenderbuffer(this.msaaColorRb);
    if (this.msaaDepthRb) this.gl.deleteRenderbuffer(this.msaaDepthRb);
    if (this.resolveFbo) this.gl.deleteFramebuffer(this.resolveFbo);
    if (this.resolveColorTex) this.gl.deleteTexture(this.resolveColorTex);
    if (this.resolveDepthRb) this.gl.deleteRenderbuffer(this.resolveDepthRb);
    this.msaaFbo = 0;
    this.msaaColorRb = 0;
    this.msaaDepthRb = 0;
    this.resolveFbo = 0;
    this.resolveColorTex = 0;
    this.resolveDepthRb = 0;
    this.samples = 0;
  }
}
