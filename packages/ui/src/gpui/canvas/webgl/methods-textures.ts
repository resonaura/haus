/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mapCoreInternalFormat, WEBGL2_CONSTANTS as GL } from './constants.js';
import { applyPixelUnpack, asUint8Bytes, extractPixelSource } from './framebuffer.js';
import type { WebGlInternalState } from './methods-state.js';
import { NativeGlHandle, unwrapHandle } from './types.js';

export function createTextureAndDrawMethods(st: WebGlInternalState) {
  const { gl } = st;
  return {
    createTexture: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.genTexture());
    },
    deleteTexture: (tex: NativeGlHandle | null): void => {
      if (!tex) return;
      gl.makeCurrent();
      gl.deleteTexture(tex.id);
    },
    activeTexture: (unit: number): void => {
      gl.makeCurrent();
      gl.activeTexture(unit);
    },
    bindTexture: (target: number, tex: NativeGlHandle | null): void => {
      gl.makeCurrent();
      gl.bindTexture(target, unwrapHandle(tex));
    },
    texParameteri: (target: number, pname: number, param: number): void => {
      gl.makeCurrent();
      gl.texParameteri(target, pname, param);
    },
    texParameterf: (target: number, pname: number, param: number): void => {
      gl.makeCurrent();
      gl.texParameterf(target, pname, param);
    },
    generateMipmap: (target: number): void => {
      gl.makeCurrent();
      gl.generateMipmap(target);
    },
    texImage2D: (
      target: number,
      level: number,
      internalFormat: number,
      ...rest: unknown[]
    ): void => {
      gl.makeCurrent();
      if (rest.length === 3) {
        const [format, type, source] = rest as [number, number, unknown];
        const extracted = extractPixelSource(source);
        if (!extracted) return;
        const mapped = mapCoreInternalFormat(internalFormat, format, type);
        const px = applyPixelUnpack(
          extracted.pixels,
          extracted.width,
          extracted.height,
          mapped.format,
          mapped.type,
          st.unpack,
        );
        gl.texImage2D(
          target,
          level,
          mapped.internalFormat,
          extracted.width,
          extracted.height,
          0,
          mapped.format,
          mapped.type,
          px,
        );
        return;
      }
      const [width, height, border, format, type, source] = rest as [
        number,
        number,
        number,
        number,
        number,
        unknown,
      ];
      const mapped = mapCoreInternalFormat(internalFormat, format, type);
      let px: Uint8Array | null = null;
      if (source && ArrayBuffer.isView(source)) {
        px = applyPixelUnpack(
          asUint8Bytes(source),
          width,
          height,
          mapped.format,
          mapped.type,
          st.unpack,
        );
      } else if (source) {
        const extracted = extractPixelSource(source);
        if (extracted) {
          px = applyPixelUnpack(
            extracted.pixels,
            extracted.width,
            extracted.height,
            mapped.format,
            mapped.type,
            st.unpack,
          );
        }
      }
      gl.texImage2D(
        target,
        level,
        mapped.internalFormat,
        width,
        height,
        border,
        mapped.format,
        mapped.type,
        px,
      );
    },
    texSubImage2D: (
      target: number,
      level: number,
      xoffset: number,
      yoffset: number,
      ...rest: unknown[]
    ): void => {
      gl.makeCurrent();
      if (rest.length === 3) {
        const [format, type, source] = rest as [number, number, unknown];
        const extracted = extractPixelSource(source);
        if (!extracted) return;
        const mapped = mapCoreInternalFormat(format, format, type);
        const px = applyPixelUnpack(
          extracted.pixels,
          extracted.width,
          extracted.height,
          mapped.format,
          mapped.type,
          st.unpack,
        );
        gl.texSubImage2D(
          target,
          level,
          xoffset,
          yoffset,
          extracted.width,
          extracted.height,
          mapped.format,
          mapped.type,
          px,
        );
        return;
      }
      const [width, height, format, type, source] = rest as [
        number,
        number,
        number,
        number,
        unknown,
      ];
      const mapped = mapCoreInternalFormat(format, format, type);
      const raw =
        source && ArrayBuffer.isView(source)
          ? asUint8Bytes(source)
          : extractPixelSource(source)?.pixels;
      if (!raw) return;
      const px = applyPixelUnpack(raw, width, height, mapped.format, mapped.type, st.unpack);
      gl.texSubImage2D(
        target,
        level,
        xoffset,
        yoffset,
        width,
        height,
        mapped.format,
        mapped.type,
        px,
      );
    },
    copyTexImage2D: (
      target: number,
      level: number,
      internalFormat: number,
      x: number,
      y: number,
      width: number,
      height: number,
      border: number,
    ): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(internalFormat, GL.RGBA, GL.UNSIGNED_BYTE);
      gl.copyTexImage2D(target, level, mapped.internalFormat, x, y, width, height, border);
    },
    copyTexSubImage2D: (
      target: number,
      level: number,
      xo: number,
      yo: number,
      x: number,
      y: number,
      width: number,
      height: number,
    ): void => {
      gl.makeCurrent();
      gl.copyTexSubImage2D(target, level, xo, yo, x, y, width, height);
    },
    texImage3D: (
      target: number,
      level: number,
      internalFormat: number,
      width: number,
      height: number,
      depth: number,
      border: number,
      format: number,
      type: number,
      source: ArrayBufferView | null,
    ): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(internalFormat, format, type);
      gl.texImage3D(
        target,
        level,
        mapped.internalFormat,
        width,
        height,
        depth,
        border,
        mapped.format,
        mapped.type,
        source ? asUint8Bytes(source) : null,
      );
    },
    texSubImage3D: (
      target: number,
      level: number,
      xo: number,
      yo: number,
      zo: number,
      w: number,
      h: number,
      d: number,
      format: number,
      type: number,
      source: ArrayBufferView,
    ): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(format, format, type);
      gl.texSubImage3D(
        target,
        level,
        xo,
        yo,
        zo,
        w,
        h,
        d,
        mapped.format,
        mapped.type,
        asUint8Bytes(source),
      );
    },
    texStorage2D: (
      target: number,
      levels: number,
      internalFormat: number,
      w: number,
      h: number,
    ): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(internalFormat, GL.RGBA, GL.UNSIGNED_BYTE);
      gl.texStorage2D(target, levels, mapped.internalFormat, w, h);
    },
    texStorage3D: (
      target: number,
      levels: number,
      internalFormat: number,
      w: number,
      h: number,
      d: number,
    ): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(internalFormat, GL.RGBA, GL.UNSIGNED_BYTE);
      gl.texStorage3D(target, levels, mapped.internalFormat, w, h, d);
    },
    createSampler: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.genSampler());
    },
    deleteSampler: (s: NativeGlHandle | null): void => {
      if (!s) return;
      gl.makeCurrent();
      gl.deleteSampler(s.id);
    },
    bindSampler: (unit: number, s: NativeGlHandle | null): void => {
      gl.makeCurrent();
      gl.bindSampler(unit, unwrapHandle(s));
    },
    samplerParameteri: (s: NativeGlHandle, pname: number, param: number): void => {
      gl.makeCurrent();
      gl.samplerParameteri(s.id, pname, param);
    },
    samplerParameterf: (s: NativeGlHandle, pname: number, param: number): void => {
      gl.makeCurrent();
      gl.samplerParameterf(s.id, pname, param);
    },
    createFramebuffer: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.genFramebuffer());
    },
    deleteFramebuffer: (fb: NativeGlHandle | null): void => {
      if (!fb) return;
      gl.makeCurrent();
      if (st.boundDrawFbo === fb.id) st.boundDrawFbo = 0;
      if (st.boundReadFbo === fb.id) st.boundReadFbo = 0;
      gl.deleteFramebuffer(fb.id);
    },
    bindFramebuffer: (target: number, fb: NativeGlHandle | null): void => {
      gl.makeCurrent();
      const id = unwrapHandle(fb);
      if (target === GL.FRAMEBUFFER) {
        st.boundDrawFbo = id;
        st.boundReadFbo = id;
        if (id === 0) {
          gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, st.fbo.drawFramebufferId);
          gl.bindFramebuffer(GL.READ_FRAMEBUFFER, st.fbo.readFramebufferId);
        } else {
          gl.bindFramebuffer(GL.FRAMEBUFFER, id);
        }
      } else if (target === GL.DRAW_FRAMEBUFFER) {
        st.boundDrawFbo = id;
        gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, id || st.fbo.drawFramebufferId);
      } else if (target === GL.READ_FRAMEBUFFER) {
        st.boundReadFbo = id;
        gl.bindFramebuffer(GL.READ_FRAMEBUFFER, id || st.fbo.readFramebufferId);
      }
    },
    framebufferTexture2D: (
      target: number,
      att: number,
      tt: number,
      tex: NativeGlHandle | null,
      lvl: number,
    ): void => {
      gl.makeCurrent();
      gl.framebufferTexture2D(target, att, tt, unwrapHandle(tex), lvl);
    },
    framebufferTextureLayer: (
      target: number,
      att: number,
      tex: NativeGlHandle | null,
      lvl: number,
      layer: number,
    ): void => {
      gl.makeCurrent();
      gl.framebufferTextureLayer(target, att, unwrapHandle(tex), lvl, layer);
    },
    framebufferRenderbuffer: (
      target: number,
      att: number,
      rbTarget: number,
      rb: NativeGlHandle | null,
    ): void => {
      gl.makeCurrent();
      gl.framebufferRenderbuffer(target, att, rbTarget, unwrapHandle(rb));
    },
    checkFramebufferStatus: (target: number): number => {
      gl.makeCurrent();
      return gl.checkFramebufferStatus(target);
    },
    blitFramebuffer: (
      sx0: number,
      sy0: number,
      sx1: number,
      sy1: number,
      dx0: number,
      dy0: number,
      dx1: number,
      dy1: number,
      mask: number,
      filter: number,
    ): void => {
      gl.makeCurrent();
      gl.blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter);
      st.markDirty();
    },
    invalidateFramebuffer: (): void => undefined,
    drawBuffers: (buffers: readonly number[]): void => {
      gl.makeCurrent();
      const mapped = new Uint32Array(
        buffers.map((b) => (b === GL.BACK && st.boundDrawFbo === 0 ? GL.COLOR_ATTACHMENT0 : b)),
      );
      gl.drawBuffers(mapped);
    },
    readBuffer: (src: number): void => {
      gl.makeCurrent();
      gl.readBuffer(src === GL.BACK && st.boundReadFbo === 0 ? GL.COLOR_ATTACHMENT0 : src);
    },
    createRenderbuffer: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.genRenderbuffer());
    },
    deleteRenderbuffer: (rb: NativeGlHandle | null): void => {
      if (!rb) return;
      gl.makeCurrent();
      gl.deleteRenderbuffer(rb.id);
    },
    bindRenderbuffer: (target: number, rb: NativeGlHandle | null): void => {
      gl.makeCurrent();
      gl.bindRenderbuffer(target, unwrapHandle(rb));
    },
    renderbufferStorage: (target: number, internalFormat: number, w: number, h: number): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(internalFormat, GL.RGBA, GL.UNSIGNED_BYTE);
      gl.renderbufferStorage(target, mapped.internalFormat, w, h);
    },
    renderbufferStorageMultisample: (
      target: number,
      samples: number,
      internalFormat: number,
      w: number,
      h: number,
    ): void => {
      gl.makeCurrent();
      const mapped = mapCoreInternalFormat(internalFormat, GL.RGBA, GL.UNSIGNED_BYTE);
      gl.renderbufferStorageMultisample(target, samples, mapped.internalFormat, w, h);
    },
    drawArrays: (mode: number, first: number, count: number): void => {
      gl.makeCurrent();
      gl.drawArrays(mode, first, count);
      st.markDirty();
    },
    drawElements: (mode: number, count: number, type: number, offset: number): void => {
      gl.makeCurrent();
      gl.drawElements(mode, count, type, offset);
      st.markDirty();
    },
    drawArraysInstanced: (
      mode: number,
      first: number,
      count: number,
      instanceCount: number,
    ): void => {
      gl.makeCurrent();
      gl.drawArraysInstanced(mode, first, count, instanceCount);
      st.markDirty();
    },
    drawElementsInstanced: (
      mode: number,
      count: number,
      type: number,
      offset: number,
      instanceCount: number,
    ): void => {
      gl.makeCurrent();
      gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
      st.markDirty();
    },
    readPixels: (
      x: number,
      y: number,
      w: number,
      h: number,
      format: number,
      type: number,
      pixels: ArrayBufferView,
    ): void => {
      gl.makeCurrent();
      gl.readPixelsRaw(x, y, w, h, format, type, asUint8Bytes(pixels));
    },
  };
}
