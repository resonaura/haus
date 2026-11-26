/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { bindNativeGlSymbols } from './bindings.js';
import { WEBGL2_CONSTANTS as GL } from './constants.js';
import { createPlatformGlContext } from './platform.js';
import type { NativeGlContext } from './types.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function fallbackStorageFormat(internalFormat: number): { format: number; type: number } {
  const format =
    internalFormat === GL.DEPTH_COMPONENT24 ||
    internalFormat === GL.DEPTH_COMPONENT16 ||
    internalFormat === GL.DEPTH_COMPONENT32F
      ? GL.DEPTH_COMPONENT
      : internalFormat === GL.DEPTH24_STENCIL8 || internalFormat === GL.DEPTH32F_STENCIL8
        ? GL.DEPTH_STENCIL
        : internalFormat === GL.R8 || internalFormat === GL.R16F || internalFormat === GL.R32F
          ? GL.RED
          : internalFormat === GL.RG8 || internalFormat === GL.RG16F || internalFormat === GL.RG32F
            ? GL.RG
            : internalFormat === GL.RGB8 ||
                internalFormat === GL.RGB16F ||
                internalFormat === GL.RGB32F
              ? GL.RGB
              : GL.RGBA;
  const type =
    internalFormat === GL.DEPTH24_STENCIL8
      ? GL.UNSIGNED_INT_24_8
      : internalFormat === GL.RGBA32F ||
          internalFormat === GL.RGB32F ||
          internalFormat === GL.R32F ||
          internalFormat === GL.RG32F
        ? GL.FLOAT
        : internalFormat === GL.RGBA16F ||
            internalFormat === GL.RGB16F ||
            internalFormat === GL.R16F ||
            internalFormat === GL.RG16F
          ? GL.HALF_FLOAT
          : GL.UNSIGNED_BYTE;
  return { format, type };
}

/** Creates a hardware-accelerated native OpenGL Core Profile context for offscreen WebGL 2. */
export function createNativeGlContext(): NativeGlContext {
  const handle = createPlatformGlContext();
  const s = bindNativeGlSymbols(handle.glLib);
  const idScratch = new Uint32Array(1);
  const intScratch = new Int32Array(1);
  const floatScratch = new Float32Array(1);
  const boolScratch = new Uint8Array(1);
  let flipScratch = new Uint8Array(0);

  // Desktop GL core requires seamless cubemaps & program point size to match WebGL2 semantics.
  s.glEnable(GL.TEXTURE_CUBE_MAP_SEAMLESS);
  s.glEnable(GL.PROGRAM_POINT_SIZE);

  return {
    targetGlslVersion: handle.targetGlslVersion,
    makeCurrent: () => handle.makeCurrent(),
    dispose: () => handle.dispose(),
    getError: () => s.glGetError() as number,
    getString: (name) => (s.glGetString(name) as string | null) ?? '',
    getStringi: (name, index) => (s.glGetStringi(name, index) as string | null) ?? '',
    getInteger: (pname) => {
      s.glGetIntegerv(pname, intScratch);
      return intScratch[0] ?? 0;
    },
    getIntegers: (pname, count) => {
      const out = new Int32Array(count);
      s.glGetIntegerv(pname, out);
      return out;
    },
    getFloat: (pname) => {
      s.glGetFloatv(pname, floatScratch);
      return floatScratch[0] ?? 0;
    },
    getFloats: (pname, count) => {
      const out = new Float32Array(count);
      s.glGetFloatv(pname, out);
      return out;
    },
    getBoolean: (pname) => {
      s.glGetBooleanv(pname, boolScratch);
      return boolScratch[0] !== 0;
    },
    getBooleans: (pname, count) => {
      const out = new Uint8Array(count);
      s.glGetBooleanv(pname, out);
      return Array.from(out, (b) => b !== 0);
    },
    isEnabled: (cap) => (s.glIsEnabled(cap) as number) !== 0,
    enable: (cap) => void s.glEnable(cap),
    disable: (cap) => void s.glDisable(cap),
    viewport: (x, y, w, h) => void s.glViewport(x | 0, y | 0, w | 0, h | 0),
    scissor: (x, y, w, h) => void s.glScissor(x | 0, y | 0, w | 0, h | 0),
    clearColor: (r, g, b, a) => void s.glClearColor(r, g, b, a),
    clearDepth: (d) => void s.glClearDepth(d),
    clearStencil: (st) => void s.glClearStencil(st | 0),
    clear: (mask) => void s.glClear(mask),
    clearBufferfv: (buf, db, v) => void s.glClearBufferfv(buf, db, v),
    clearBufferiv: (buf, db, v) => void s.glClearBufferiv(buf, db, v),
    clearBufferuiv: (buf, db, v) => void s.glClearBufferuiv(buf, db, v),
    clearBufferfi: (buf, db, d, st) => void s.glClearBufferfi(buf, db, d, st),
    colorMask: (r, g, b, a) => void s.glColorMask(r ? 1 : 0, g ? 1 : 0, b ? 1 : 0, a ? 1 : 0),
    depthMask: (flag) => void s.glDepthMask(flag ? 1 : 0),
    depthFunc: (func) => void s.glDepthFunc(func),
    depthRange: (zNear, zFar) => void s.glDepthRange(zNear, zFar),
    cullFace: (mode) => void s.glCullFace(mode),
    frontFace: (mode) => void s.glFrontFace(mode),
    polygonOffset: (factor, units) => void s.glPolygonOffset(factor, units),
    lineWidth: (width) => void s.glLineWidth(width),
    blendColor: (r, g, b, a) => void s.glBlendColor(r, g, b, a),
    blendEquation: (mode) => void s.glBlendEquation(mode),
    blendEquationSeparate: (mRgb, mA) => void s.glBlendEquationSeparate(mRgb, mA),
    blendFunc: (sf, df) => void s.glBlendFunc(sf, df),
    blendFuncSeparate: (sr, dr, sa, da) => void s.glBlendFuncSeparate(sr, dr, sa, da),
    stencilFunc: (func, ref, mask) => void s.glStencilFunc(func, ref, mask),
    stencilFuncSeparate: (face, func, ref, mask) =>
      void s.glStencilFuncSeparate(face, func, ref, mask),
    stencilMask: (mask) => void s.glStencilMask(mask),
    stencilMaskSeparate: (face, mask) => void s.glStencilMaskSeparate(face, mask),
    stencilOp: (fail, zfail, zpass) => void s.glStencilOp(fail, zfail, zpass),
    stencilOpSeparate: (face, fail, zfail, zpass) =>
      void s.glStencilOpSeparate(face, fail, zfail, zpass),
    pixelStorei: (pname, param) => void s.glPixelStorei(pname, param | 0),
    hint: (target, mode) => void s.glHint(target, mode),
    flush: () => void s.glFlush(),
    finish: () => void s.glFinish(),
    genBuffer: () => {
      s.glGenBuffers(1, idScratch);
      return idScratch[0] ?? 0;
    },
    deleteBuffer: (id) => {
      idScratch[0] = id;
      s.glDeleteBuffers(1, idScratch);
    },
    bindBuffer: (target, id) => void s.glBindBuffer(target, id),
    bindBufferBase: (target, index, id) => void s.glBindBufferBase(target, index, id),
    bindBufferRange: (target, index, id, offset, size) =>
      void s.glBindBufferRange(target, index, id, offset, size),
    bufferData: (target, size, data, usage) => void s.glBufferData(target, size, data, usage),
    bufferSubData: (target, offset, size, data) =>
      void s.glBufferSubData(target, offset, size, data),
    copyBufferSubData: (rt, wt, ro, wo, sz) => void s.glCopyBufferSubData(rt, wt, ro, wo, sz),
    genVertexArray: () => {
      s.glGenVertexArrays(1, idScratch);
      return idScratch[0] ?? 0;
    },
    deleteVertexArray: (id) => {
      idScratch[0] = id;
      s.glDeleteVertexArrays(1, idScratch);
    },
    bindVertexArray: (id) => void s.glBindVertexArray(id),
    enableVertexAttribArray: (idx) => void s.glEnableVertexAttribArray(idx),
    disableVertexAttribArray: (idx) => void s.glDisableVertexAttribArray(idx),
    vertexAttribPointer: (idx, sz, typ, norm, stride, off) =>
      void s.glVertexAttribPointer(idx, sz, typ, norm ? 1 : 0, stride, off),
    vertexAttribIPointer: (idx, sz, typ, stride, off) =>
      void s.glVertexAttribIPointer(idx, sz, typ, stride, off),
    vertexAttribDivisor: (idx, div) => void s.glVertexAttribDivisor(idx, div),
    vertexAttrib1f: (idx, x) => void s.glVertexAttrib1f(idx, x),
    vertexAttrib2f: (idx, x, y) => void s.glVertexAttrib2f(idx, x, y),
    vertexAttrib3f: (idx, x, y, z) => void s.glVertexAttrib3f(idx, x, y, z),
    vertexAttrib4f: (idx, x, y, z, w) => void s.glVertexAttrib4f(idx, x, y, z, w),
    createShader: (type) => s.glCreateShader(type) as number,
    deleteShader: (id) => void s.glDeleteShader(id),
    shaderSource: (id, source) => {
      const len = new Int32Array([encoder.encode(source).byteLength]);
      s.glShaderSource(id, 1, [source], len);
    },
    compileShader: (id) => void s.glCompileShader(id),
    getShaderiv: (id, pname) => {
      s.glGetShaderiv(id, pname, intScratch);
      return intScratch[0] ?? 0;
    },
    getShaderInfoLog: (id) => {
      s.glGetShaderiv(id, 0x8b84, intScratch);
      const maxLen = Math.max(0, intScratch[0] ?? 0);
      if (maxLen <= 1) return '';
      const buf = new Uint8Array(maxLen);
      const outLen = new Int32Array(1);
      s.glGetShaderInfoLog(id, maxLen, outLen, buf);
      return decoder.decode(buf.subarray(0, Math.max(0, outLen[0] ?? 0)));
    },
    createProgram: () => s.glCreateProgram() as number,
    deleteProgram: (id) => void s.glDeleteProgram(id),
    attachShader: (p, sh) => void s.glAttachShader(p, sh),
    detachShader: (p, sh) => void s.glDetachShader(p, sh),
    linkProgram: (p) => void s.glLinkProgram(p),
    validateProgram: (p) => void s.glValidateProgram(p),
    useProgram: (p) => void s.glUseProgram(p),
    getProgramiv: (p, pname) => {
      s.glGetProgramiv(p, pname, intScratch);
      return intScratch[0] ?? 0;
    },
    getProgramInfoLog: (p) => {
      s.glGetProgramiv(p, 0x8b84, intScratch);
      const maxLen = Math.max(0, intScratch[0] ?? 0);
      if (maxLen <= 1) return '';
      const buf = new Uint8Array(maxLen);
      const outLen = new Int32Array(1);
      s.glGetProgramInfoLog(p, maxLen, outLen, buf);
      return decoder.decode(buf.subarray(0, Math.max(0, outLen[0] ?? 0)));
    },
    getActiveAttrib: (p, idx) => {
      const len = new Int32Array(1);
      const size = new Int32Array(1);
      const type = new Uint32Array(1);
      const nameBuf = new Uint8Array(256);
      s.glGetActiveAttrib(p, idx, 256, len, size, type, nameBuf);
      const n = len[0] ?? 0;
      if (n <= 0) return null;
      return {
        name: decoder.decode(nameBuf.subarray(0, n)),
        size: size[0] ?? 1,
        type: type[0] ?? 0,
      };
    },
    getActiveUniform: (p, idx) => {
      const len = new Int32Array(1);
      const size = new Int32Array(1);
      const type = new Uint32Array(1);
      const nameBuf = new Uint8Array(256);
      s.glGetActiveUniform(p, idx, 256, len, size, type, nameBuf);
      const n = len[0] ?? 0;
      if (n <= 0) return null;
      return {
        name: decoder.decode(nameBuf.subarray(0, n)),
        size: size[0] ?? 1,
        type: type[0] ?? 0,
      };
    },
    getAttribLocation: (p, name) => s.glGetAttribLocation(p, name) as number,
    bindAttribLocation: (p, idx, name) => void s.glBindAttribLocation(p, idx, name),
    getUniformLocation: (p, name) => s.glGetUniformLocation(p, name) as number,
    getUniformBlockIndex: (p, name) => s.glGetUniformBlockIndex(p, name) as number,
    uniformBlockBinding: (p, idx, bp) => void s.glUniformBlockBinding(p, idx, bp),
    uniform1i: (loc, x) => void s.glUniform1i(loc, x | 0),
    uniform2i: (loc, x, y) => void s.glUniform2i(loc, x | 0, y | 0),
    uniform3i: (loc, x, y, z) => void s.glUniform3i(loc, x | 0, y | 0, z | 0),
    uniform4i: (loc, x, y, z, w) => void s.glUniform4i(loc, x | 0, y | 0, z | 0, w | 0),
    uniform1iv: (loc, count, v) => void s.glUniform1iv(loc, count, v),
    uniform2iv: (loc, count, v) => void s.glUniform2iv(loc, count, v),
    uniform3iv: (loc, count, v) => void s.glUniform3iv(loc, count, v),
    uniform4iv: (loc, count, v) => void s.glUniform4iv(loc, count, v),
    uniform1ui: (loc, x) => void s.glUniform1ui(loc, x >>> 0),
    uniform1uiv: (loc, count, v) => void s.glUniform1uiv(loc, count, v),
    uniform1f: (loc, x) => void s.glUniform1f(loc, x),
    uniform2f: (loc, x, y) => void s.glUniform2f(loc, x, y),
    uniform3f: (loc, x, y, z) => void s.glUniform3f(loc, x, y, z),
    uniform4f: (loc, x, y, z, w) => void s.glUniform4f(loc, x, y, z, w),
    uniform1fv: (loc, count, v) => void s.glUniform1fv(loc, count, v),
    uniform2fv: (loc, count, v) => void s.glUniform2fv(loc, count, v),
    uniform3fv: (loc, count, v) => void s.glUniform3fv(loc, count, v),
    uniform4fv: (loc, count, v) => void s.glUniform4fv(loc, count, v),
    uniformMatrix2fv: (loc, count, tr, v) => void s.glUniformMatrix2fv(loc, count, tr ? 1 : 0, v),
    uniformMatrix3fv: (loc, count, tr, v) => void s.glUniformMatrix3fv(loc, count, tr ? 1 : 0, v),
    uniformMatrix4fv: (loc, count, tr, v) => void s.glUniformMatrix4fv(loc, count, tr ? 1 : 0, v),
    genTexture: () => {
      s.glGenTextures(1, idScratch);
      return idScratch[0] ?? 0;
    },
    deleteTexture: (id) => {
      idScratch[0] = id;
      s.glDeleteTextures(1, idScratch);
    },
    activeTexture: (unit) => void s.glActiveTexture(unit),
    bindTexture: (target, id) => void s.glBindTexture(target, id),
    texParameteri: (target, pname, param) => void s.glTexParameteri(target, pname, param | 0),
    texParameterf: (target, pname, param) => void s.glTexParameterf(target, pname, param),
    generateMipmap: (target) => void s.glGenerateMipmap(target),
    texImage2D: (t, lvl, ifmt, w, h, b, fmt, typ, px) =>
      void s.glTexImage2D(t, lvl, ifmt, w, h, b, fmt, typ, px),
    texSubImage2D: (t, lvl, xo, yo, w, h, fmt, typ, px) =>
      void s.glTexSubImage2D(t, lvl, xo, yo, w, h, fmt, typ, px),
    copyTexImage2D: (t, lvl, ifmt, x, y, w, h, b) =>
      void s.glCopyTexImage2D(t, lvl, ifmt, x, y, w, h, b),
    copyTexSubImage2D: (t, lvl, xo, yo, x, y, w, h) =>
      void s.glCopyTexSubImage2D(t, lvl, xo, yo, x, y, w, h),
    texImage3D: (t, lvl, ifmt, w, h, d, b, fmt, typ, px) =>
      void s.glTexImage3D(t, lvl, ifmt, w, h, d, b, fmt, typ, px),
    texSubImage3D: (t, lvl, xo, yo, zo, w, h, d, fmt, typ, px) =>
      void s.glTexSubImage3D(t, lvl, xo, yo, zo, w, h, d, fmt, typ, px),
    texStorage2D: (t, lvls, ifmt, w, h) => {
      if (s.glTexStorage2D) {
        s.glTexStorage2D(t, lvls, ifmt, w, h);
        return;
      }
      const { format, type } = fallbackStorageFormat(ifmt);
      for (let i = 0; i < lvls; i++) {
        s.glTexImage2D(t, i, ifmt, Math.max(1, w >> i), Math.max(1, h >> i), 0, format, type, null);
      }
    },
    texStorage3D: (t, lvls, ifmt, w, h, d) => {
      if (s.glTexStorage3D) {
        s.glTexStorage3D(t, lvls, ifmt, w, h, d);
        return;
      }
      const { format, type } = fallbackStorageFormat(ifmt);
      for (let i = 0; i < lvls; i++) {
        const md = t === GL.TEXTURE_2D_ARRAY ? d : Math.max(1, d >> i);
        s.glTexImage3D(
          t,
          i,
          ifmt,
          Math.max(1, w >> i),
          Math.max(1, h >> i),
          md,
          0,
          format,
          type,
          null,
        );
      }
    },
    genSampler: () => {
      s.glGenSamplers(1, idScratch);
      return idScratch[0] ?? 0;
    },
    deleteSampler: (id) => {
      idScratch[0] = id;
      s.glDeleteSamplers(1, idScratch);
    },
    bindSampler: (unit, smp) => void s.glBindSampler(unit, smp),
    samplerParameteri: (smp, pname, param) => void s.glSamplerParameteri(smp, pname, param | 0),
    samplerParameterf: (smp, pname, param) => void s.glSamplerParameterf(smp, pname, param),
    genFramebuffer: () => {
      s.glGenFramebuffers(1, idScratch);
      return idScratch[0] ?? 0;
    },
    deleteFramebuffer: (id) => {
      idScratch[0] = id;
      s.glDeleteFramebuffers(1, idScratch);
    },
    bindFramebuffer: (t, id) => void s.glBindFramebuffer(t, id),
    framebufferTexture2D: (t, att, tt, tex, lvl) =>
      void s.glFramebufferTexture2D(t, att, tt, tex, lvl),
    framebufferTextureLayer: (t, att, tex, lvl, layer) =>
      void s.glFramebufferTextureLayer(t, att, tex, lvl, layer),
    framebufferRenderbuffer: (t, att, rbt, rb) => void s.glFramebufferRenderbuffer(t, att, rbt, rb),
    checkFramebufferStatus: (t) => s.glCheckFramebufferStatus(t) as number,
    blitFramebuffer: (sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) =>
      void s.glBlitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter),
    drawBuffers: (bufs) => void s.glDrawBuffers(bufs.length, bufs),
    readBuffer: (src) => void s.glReadBuffer(src),
    genRenderbuffer: () => {
      s.glGenRenderbuffers(1, idScratch);
      return idScratch[0] ?? 0;
    },
    deleteRenderbuffer: (id) => {
      idScratch[0] = id;
      s.glDeleteRenderbuffers(1, idScratch);
    },
    bindRenderbuffer: (t, id) => void s.glBindRenderbuffer(t, id),
    renderbufferStorage: (t, ifmt, w, h) => void s.glRenderbufferStorage(t, ifmt, w, h),
    renderbufferStorageMultisample: (t, samples, ifmt, w, h) =>
      void s.glRenderbufferStorageMultisample(t, samples, ifmt, w, h),
    drawArrays: (mode, first, count) => void s.glDrawArrays(mode, first | 0, count | 0),
    drawElements: (mode, count, type, offset) =>
      void s.glDrawElements(mode, count | 0, type, offset),
    drawArraysInstanced: (mode, first, count, ic) =>
      void s.glDrawArraysInstanced(mode, first | 0, count | 0, ic | 0),
    drawElementsInstanced: (mode, count, type, offset, ic) =>
      void s.glDrawElementsInstanced(mode, count | 0, type, offset, ic | 0),
    readPixelsRaw: (x, y, w, h, fmt, typ, dest) => void s.glReadPixels(x, y, w, h, fmt, typ, dest),
    readFramebufferBgraFlipped: (width, height, dest) => {
      const byteLen = width * height * 4;
      if (flipScratch.length < byteLen) flipScratch = new Uint8Array(byteLen);
      s.glPixelStorei(GL.PACK_ALIGNMENT, 4);
      s.glReadPixels(0, 0, width, height, GL.BGRA, GL.UNSIGNED_INT_8_8_8_8_REV, flipScratch);
      const rowBytes = width * 4;
      for (let y = 0; y < height; y++) {
        const srcStart = (height - 1 - y) * rowBytes;
        dest.set(flipScratch.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
      }
    },
  };
}
