/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WEBGL2_CONSTANTS as GL } from './constants.js';
import {
  asUint8Bytes,
  sliceFloat32,
  sliceInt32,
  sliceUint32,
  type OffscreenFramebuffer,
  type PixelUnpackState,
} from './framebuffer.js';
import {
  NativeGlHandle,
  unwrapHandle,
  type NativeGlContext,
  type NativeWebGLContextAttributes,
} from './types.js';

export interface WebGlInternalState {
  readonly gl: NativeGlContext;
  readonly fbo: OffscreenFramebuffer;
  readonly attrs: Required<NativeWebGLContextAttributes>;
  readonly unpack: PixelUnpackState;
  readonly defaultVao: number;
  boundVao: number;
  boundDrawFbo: number;
  boundReadFbo: number;
  dirty: boolean;
  disposed: boolean;
  markDirty(): void;
  presentNow(): void;
  dispose(): void;
}

const SUPPORTED_EXTENSIONS = [
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'EXT_texture_filter_anisotropic',
  'OES_texture_float_linear',
  'OES_texture_half_float_linear',
  'WEBGL_debug_renderer_info',
  'WEBGL_lose_context',
] as const;

function sliceBufferData(
  srcData: ArrayBuffer | ArrayBufferView,
  srcOffset: number,
  length: number,
): Uint8Array {
  const bytes = asUint8Bytes(srcData);
  if (!ArrayBuffer.isView(srcData) || (srcOffset === 0 && length === 0)) return bytes;
  const bpe = 'BYTES_PER_ELEMENT' in srcData ? Number(srcData.BYTES_PER_ELEMENT) : 1;
  const start = srcOffset * bpe;
  const end = length > 0 ? start + length * bpe : bytes.byteLength;
  return bytes.subarray(start, end);
}

export function createStateMethods(st: WebGlInternalState) {
  const { gl } = st;
  return {
    isContextLost: (): boolean => st.disposed,
    getContextAttributes: (): Required<NativeWebGLContextAttributes> => ({ ...st.attrs }),
    getSupportedExtensions: (): string[] => [...SUPPORTED_EXTENSIONS],
    getExtension: (name: string): Record<string, unknown> | null => {
      if (
        name === 'EXT_texture_filter_anisotropic' ||
        name === 'WEBKIT_EXT_texture_filter_anisotropic'
      ) {
        return {
          TEXTURE_MAX_ANISOTROPY_EXT: GL.TEXTURE_MAX_ANISOTROPY_EXT,
          MAX_TEXTURE_MAX_ANISOTROPY_EXT: GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
        };
      }
      if (name === 'WEBGL_debug_renderer_info') {
        return {
          UNMASKED_VENDOR_WEBGL: GL.UNMASKED_VENDOR_WEBGL,
          UNMASKED_RENDERER_WEBGL: GL.UNMASKED_RENDERER_WEBGL,
        };
      }
      if (name === 'WEBGL_lose_context') {
        return { loseContext: () => st.dispose(), restoreContext: () => undefined };
      }
      return (SUPPORTED_EXTENSIONS as readonly string[]).includes(name) ? {} : null;
    },
    getShaderPrecisionFormat: (_shaderType: number, precisionType: number) => {
      if (
        precisionType === GL.HIGH_INT ||
        precisionType === GL.MEDIUM_INT ||
        precisionType === GL.LOW_INT
      ) {
        return { rangeMin: 31, rangeMax: 30, precision: 0 };
      }
      if (precisionType === GL.MEDIUM_FLOAT || precisionType === GL.LOW_FLOAT) {
        return { rangeMin: 15, rangeMax: 15, precision: 10 };
      }
      return { rangeMin: 127, rangeMax: 127, precision: 23 };
    },
    getError: (): number => {
      gl.makeCurrent();
      return gl.getError();
    },
    getParameter: (pname: number): unknown => {
      gl.makeCurrent();
      switch (pname) {
        case GL.VERSION:
          return `WebGL 2.0 (Haus ${gl.getString(GL.VERSION)})`;
        case GL.SHADING_LANGUAGE_VERSION:
          return 'WebGL GLSL ES 3.00';
        case GL.VENDOR:
        case GL.UNMASKED_VENDOR_WEBGL:
          return gl.getString(GL.VENDOR);
        case GL.RENDERER:
        case GL.UNMASKED_RENDERER_WEBGL:
          return gl.getString(GL.RENDERER);
        case GL.VIEWPORT:
        case GL.SCISSOR_BOX:
          return gl.getIntegers(pname, 4);
        case GL.MAX_VIEWPORT_DIMS:
          return gl.getIntegers(pname, 2);
        case GL.COLOR_CLEAR_VALUE:
        case GL.BLEND_COLOR:
          return gl.getFloats(pname, 4);
        case GL.ALIASED_LINE_WIDTH_RANGE:
        case GL.ALIASED_POINT_SIZE_RANGE:
        case GL.DEPTH_RANGE:
          return gl.getFloats(pname, 2);
        case GL.COLOR_WRITEMASK:
          return gl.getBooleans(pname, 4);
        case GL.DEPTH_WRITEMASK:
          return gl.getBoolean(pname);
        case GL.COMPRESSED_TEXTURE_FORMATS:
          return new Uint32Array(0);
        case GL.MAX_VERTEX_UNIFORM_VECTORS:
          return Math.max(256, Math.floor(gl.getInteger(GL.MAX_VERTEX_UNIFORM_COMPONENTS) / 4));
        case GL.MAX_FRAGMENT_UNIFORM_VECTORS:
          return Math.max(256, Math.floor(gl.getInteger(GL.MAX_FRAGMENT_UNIFORM_COMPONENTS) / 4));
        case GL.MAX_VARYING_VECTORS:
          return Math.max(15, Math.floor(gl.getInteger(GL.MAX_VERTEX_OUTPUT_COMPONENTS) / 4));
        case GL.SAMPLES:
          return st.fbo.sampleCount;
        case GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT:
          return gl.getFloat(pname) || 16;
        case GL.DEPTH_CLEAR_VALUE:
        case GL.LINE_WIDTH:
        case GL.POLYGON_OFFSET_FACTOR:
        case GL.POLYGON_OFFSET_UNITS:
          return gl.getFloat(pname);
        default:
          return gl.getInteger(pname);
      }
    },
    isEnabled: (cap: number): boolean => {
      gl.makeCurrent();
      return gl.isEnabled(cap);
    },
    enable: (cap: number): void => {
      gl.makeCurrent();
      gl.enable(cap);
    },
    disable: (cap: number): void => {
      gl.makeCurrent();
      gl.disable(cap);
    },
    viewport: (x: number, y: number, w: number, h: number): void => {
      gl.makeCurrent();
      gl.viewport(x, y, w, h);
    },
    scissor: (x: number, y: number, w: number, h: number): void => {
      gl.makeCurrent();
      gl.scissor(x, y, w, h);
    },
    clearColor: (r: number, g: number, b: number, a: number): void => {
      gl.makeCurrent();
      gl.clearColor(r, g, b, a);
    },
    clearDepth: (d: number): void => {
      gl.makeCurrent();
      gl.clearDepth(d);
    },
    clearStencil: (s: number): void => {
      gl.makeCurrent();
      gl.clearStencil(s);
    },
    clear: (mask: number): void => {
      gl.makeCurrent();
      gl.clear(mask);
      st.markDirty();
    },
    clearBufferfv: (buf: number, db: number, values: Float32List, srcOffset = 0): void => {
      gl.makeCurrent();
      gl.clearBufferfv(buf, db, sliceFloat32(values, srcOffset));
      st.markDirty();
    },
    clearBufferiv: (buf: number, db: number, values: Int32List, srcOffset = 0): void => {
      gl.makeCurrent();
      gl.clearBufferiv(buf, db, sliceInt32(values, srcOffset));
      st.markDirty();
    },
    clearBufferuiv: (buf: number, db: number, values: Uint32List, srcOffset = 0): void => {
      gl.makeCurrent();
      gl.clearBufferuiv(buf, db, sliceUint32(values, srcOffset));
      st.markDirty();
    },
    clearBufferfi: (buf: number, db: number, depth: number, stencil: number): void => {
      gl.makeCurrent();
      gl.clearBufferfi(buf, db, depth, stencil);
      st.markDirty();
    },
    colorMask: (r: boolean, g: boolean, b: boolean, a: boolean): void => {
      gl.makeCurrent();
      gl.colorMask(r, g, b, a);
    },
    depthMask: (flag: boolean): void => {
      gl.makeCurrent();
      gl.depthMask(flag);
    },
    depthFunc: (func: number): void => {
      gl.makeCurrent();
      gl.depthFunc(func);
    },
    depthRange: (zNear: number, zFar: number): void => {
      gl.makeCurrent();
      gl.depthRange(zNear, zFar);
    },
    cullFace: (mode: number): void => {
      gl.makeCurrent();
      gl.cullFace(mode);
    },
    frontFace: (mode: number): void => {
      gl.makeCurrent();
      gl.frontFace(mode);
    },
    polygonOffset: (factor: number, units: number): void => {
      gl.makeCurrent();
      gl.polygonOffset(factor, units);
    },
    lineWidth: (width: number): void => {
      gl.makeCurrent();
      gl.lineWidth(width);
    },
    blendColor: (r: number, g: number, b: number, a: number): void => {
      gl.makeCurrent();
      gl.blendColor(r, g, b, a);
    },
    blendEquation: (mode: number): void => {
      gl.makeCurrent();
      gl.blendEquation(mode);
    },
    blendEquationSeparate: (mRgb: number, mA: number): void => {
      gl.makeCurrent();
      gl.blendEquationSeparate(mRgb, mA);
    },
    blendFunc: (sf: number, df: number): void => {
      gl.makeCurrent();
      gl.blendFunc(sf, df);
    },
    blendFuncSeparate: (sr: number, dr: number, sa: number, da: number): void => {
      gl.makeCurrent();
      gl.blendFuncSeparate(sr, dr, sa, da);
    },
    stencilFunc: (func: number, ref: number, mask: number): void => {
      gl.makeCurrent();
      gl.stencilFunc(func, ref, mask);
    },
    stencilFuncSeparate: (face: number, func: number, ref: number, mask: number): void => {
      gl.makeCurrent();
      gl.stencilFuncSeparate(face, func, ref, mask);
    },
    stencilMask: (mask: number): void => {
      gl.makeCurrent();
      gl.stencilMask(mask);
    },
    stencilMaskSeparate: (face: number, mask: number): void => {
      gl.makeCurrent();
      gl.stencilMaskSeparate(face, mask);
    },
    stencilOp: (fail: number, zfail: number, zpass: number): void => {
      gl.makeCurrent();
      gl.stencilOp(fail, zfail, zpass);
    },
    stencilOpSeparate: (face: number, fail: number, zfail: number, zpass: number): void => {
      gl.makeCurrent();
      gl.stencilOpSeparate(face, fail, zfail, zpass);
    },
    pixelStorei: (pname: number, param: number | boolean): void => {
      if (pname === GL.UNPACK_FLIP_Y_WEBGL) {
        st.unpack.flipY = Boolean(param);
        return;
      }
      if (pname === GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL) {
        st.unpack.premultiplyAlpha = Boolean(param);
        return;
      }
      if (pname === GL.UNPACK_COLORSPACE_CONVERSION_WEBGL) return;
      gl.makeCurrent();
      gl.pixelStorei(pname, Number(param));
    },
    hint: (target: number, mode: number): void => {
      gl.makeCurrent();
      gl.hint(target, mode);
    },
    flush: (): void => {
      gl.makeCurrent();
      gl.flush();
      if (st.dirty) st.presentNow();
    },
    finish: (): void => {
      gl.makeCurrent();
      gl.finish();
      if (st.dirty) st.presentNow();
    },
    createBuffer: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.genBuffer());
    },
    deleteBuffer: (buf: NativeGlHandle | null): void => {
      if (!buf) return;
      gl.makeCurrent();
      gl.deleteBuffer(buf.id);
    },
    bindBuffer: (target: number, buf: NativeGlHandle | null): void => {
      gl.makeCurrent();
      gl.bindBuffer(target, unwrapHandle(buf));
    },
    bindBufferBase: (target: number, index: number, buf: NativeGlHandle | null): void => {
      gl.makeCurrent();
      gl.bindBufferBase(target, index, unwrapHandle(buf));
    },
    bindBufferRange: (
      target: number,
      index: number,
      buf: NativeGlHandle | null,
      offset: number,
      size: number,
    ): void => {
      gl.makeCurrent();
      gl.bindBufferRange(target, index, unwrapHandle(buf), offset, size);
    },
    bufferData: (
      target: number,
      srcData: number | ArrayBuffer | ArrayBufferView | null,
      usage: number,
      srcOffset = 0,
      length = 0,
    ): void => {
      gl.makeCurrent();
      if (typeof srcData === 'number') {
        gl.bufferData(target, srcData, null, usage);
        return;
      }
      if (!srcData) {
        gl.bufferData(target, 0, null, usage);
        return;
      }
      const bytes = sliceBufferData(srcData, srcOffset, length);
      gl.bufferData(target, bytes.byteLength, bytes, usage);
    },
    bufferSubData: (
      target: number,
      dstByteOffset: number,
      srcData: ArrayBuffer | ArrayBufferView,
      srcOffset = 0,
      length = 0,
    ): void => {
      gl.makeCurrent();
      const bytes = sliceBufferData(srcData, srcOffset, length);
      gl.bufferSubData(target, dstByteOffset, bytes.byteLength, bytes);
    },
    copyBufferSubData: (rt: number, wt: number, ro: number, wo: number, size: number): void => {
      gl.makeCurrent();
      gl.copyBufferSubData(rt, wt, ro, wo, size);
    },
    createVertexArray: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.genVertexArray());
    },
    deleteVertexArray: (vao: NativeGlHandle | null): void => {
      if (!vao) return;
      gl.makeCurrent();
      if (st.boundVao === vao.id) {
        st.boundVao = 0;
        gl.bindVertexArray(st.defaultVao);
      }
      gl.deleteVertexArray(vao.id);
    },
    bindVertexArray: (vao: NativeGlHandle | null): void => {
      gl.makeCurrent();
      st.boundVao = unwrapHandle(vao);
      gl.bindVertexArray(st.boundVao || st.defaultVao);
    },
    enableVertexAttribArray: (index: number): void => {
      gl.makeCurrent();
      gl.enableVertexAttribArray(index);
    },
    disableVertexAttribArray: (index: number): void => {
      gl.makeCurrent();
      gl.disableVertexAttribArray(index);
    },
    vertexAttribPointer: (
      index: number,
      size: number,
      type: number,
      normalized: boolean,
      stride: number,
      offset: number,
    ): void => {
      gl.makeCurrent();
      gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
    },
    vertexAttribIPointer: (
      index: number,
      size: number,
      type: number,
      stride: number,
      offset: number,
    ): void => {
      gl.makeCurrent();
      gl.vertexAttribIPointer(index, size, type, stride, offset);
    },
    vertexAttribDivisor: (index: number, divisor: number): void => {
      gl.makeCurrent();
      gl.vertexAttribDivisor(index, divisor);
    },
    vertexAttrib1f: (i: number, x: number): void => {
      gl.makeCurrent();
      gl.vertexAttrib1f(i, x);
    },
    vertexAttrib2f: (i: number, x: number, y: number): void => {
      gl.makeCurrent();
      gl.vertexAttrib2f(i, x, y);
    },
    vertexAttrib3f: (i: number, x: number, y: number, z: number): void => {
      gl.makeCurrent();
      gl.vertexAttrib3f(i, x, y, z);
    },
    vertexAttrib4f: (i: number, x: number, y: number, z: number, w: number): void => {
      gl.makeCurrent();
      gl.vertexAttrib4f(i, x, y, z, w);
    },
    vertexAttrib4fv: (i: number, v: Float32List): void => {
      const a = sliceFloat32(v);
      gl.makeCurrent();
      gl.vertexAttrib4f(i, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1);
    },
  };
}
