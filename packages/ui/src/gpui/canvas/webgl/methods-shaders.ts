/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WEBGL2_CONSTANTS as GL } from './constants.js';
import { sliceFloat32, sliceInt32, sliceUint32 } from './framebuffer.js';
import { transpileWebGlShader } from './glsl.js';
import type { WebGlInternalState } from './methods-state.js';
import {
  NativeGlHandle,
  NativeWebGLShader,
  NativeWebGLUniformLocation,
  unwrapHandle,
} from './types.js';

export function createShaderMethods(st: WebGlInternalState) {
  const { gl } = st;
  return {
    createShader: (type: number): NativeWebGLShader => {
      gl.makeCurrent();
      return new NativeWebGLShader(gl.createShader(type), type);
    },
    deleteShader: (shader: NativeWebGLShader | null): void => {
      if (!shader) return;
      gl.makeCurrent();
      gl.deleteShader(shader.id);
    },
    shaderSource: (shader: NativeWebGLShader, source: string): void => {
      gl.makeCurrent();
      const translated = transpileWebGlShader(source, shader.type, gl.targetGlslVersion);
      gl.shaderSource(shader.id, translated.source);
    },
    compileShader: (shader: NativeWebGLShader): void => {
      gl.makeCurrent();
      gl.compileShader(shader.id);
    },
    getShaderParameter: (shader: NativeWebGLShader, pname: number): unknown => {
      gl.makeCurrent();
      const val = gl.getShaderiv(shader.id, pname);
      return pname === GL.COMPILE_STATUS || pname === GL.DELETE_STATUS ? val !== 0 : val;
    },
    getShaderInfoLog: (shader: NativeWebGLShader): string => {
      gl.makeCurrent();
      return gl.getShaderInfoLog(shader.id);
    },
    createProgram: (): NativeGlHandle => {
      gl.makeCurrent();
      return new NativeGlHandle(gl.createProgram());
    },
    deleteProgram: (prog: NativeGlHandle | null): void => {
      if (!prog) return;
      gl.makeCurrent();
      gl.deleteProgram(prog.id);
    },
    attachShader: (prog: NativeGlHandle, shader: NativeWebGLShader): void => {
      gl.makeCurrent();
      gl.attachShader(prog.id, shader.id);
    },
    detachShader: (prog: NativeGlHandle, shader: NativeWebGLShader): void => {
      gl.makeCurrent();
      gl.detachShader(prog.id, shader.id);
    },
    linkProgram: (prog: NativeGlHandle): void => {
      gl.makeCurrent();
      gl.linkProgram(prog.id);
    },
    validateProgram: (prog: NativeGlHandle): void => {
      gl.makeCurrent();
      gl.validateProgram(prog.id);
    },
    useProgram: (prog: NativeGlHandle | null): void => {
      gl.makeCurrent();
      gl.useProgram(unwrapHandle(prog));
    },
    getProgramParameter: (prog: NativeGlHandle, pname: number): unknown => {
      gl.makeCurrent();
      const val = gl.getProgramiv(prog.id, pname);
      return pname === GL.LINK_STATUS || pname === GL.VALIDATE_STATUS || pname === GL.DELETE_STATUS
        ? val !== 0
        : val;
    },
    getProgramInfoLog: (prog: NativeGlHandle): string => {
      gl.makeCurrent();
      return gl.getProgramInfoLog(prog.id);
    },
    getActiveAttrib: (prog: NativeGlHandle, index: number) => {
      gl.makeCurrent();
      return gl.getActiveAttrib(prog.id, index);
    },
    getActiveUniform: (prog: NativeGlHandle, index: number) => {
      gl.makeCurrent();
      return gl.getActiveUniform(prog.id, index);
    },
    getAttribLocation: (prog: NativeGlHandle, name: string): number => {
      gl.makeCurrent();
      return gl.getAttribLocation(prog.id, name);
    },
    bindAttribLocation: (prog: NativeGlHandle, index: number, name: string): void => {
      gl.makeCurrent();
      gl.bindAttribLocation(prog.id, index, name);
    },
    getUniformLocation: (prog: NativeGlHandle, name: string): NativeWebGLUniformLocation | null => {
      gl.makeCurrent();
      const loc = gl.getUniformLocation(prog.id, name);
      return loc >= 0 ? new NativeWebGLUniformLocation(loc) : null;
    },
    getUniformBlockIndex: (prog: NativeGlHandle, name: string): number => {
      gl.makeCurrent();
      return gl.getUniformBlockIndex(prog.id, name);
    },
    uniformBlockBinding: (prog: NativeGlHandle, blockIndex: number, bindingPoint: number): void => {
      gl.makeCurrent();
      gl.uniformBlockBinding(prog.id, blockIndex, bindingPoint);
    },
    uniform1i: (loc: NativeWebGLUniformLocation | null, x: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform1i(loc.location, x);
    },
    uniform2i: (loc: NativeWebGLUniformLocation | null, x: number, y: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform2i(loc.location, x, y);
    },
    uniform3i: (loc: NativeWebGLUniformLocation | null, x: number, y: number, z: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform3i(loc.location, x, y, z);
    },
    uniform4i: (
      loc: NativeWebGLUniformLocation | null,
      x: number,
      y: number,
      z: number,
      w: number,
    ): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform4i(loc.location, x, y, z, w);
    },
    uniform1iv: (
      loc: NativeWebGLUniformLocation | null,
      v: Int32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceInt32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform1iv(loc.location, arr.length, arr);
    },
    uniform2iv: (
      loc: NativeWebGLUniformLocation | null,
      v: Int32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceInt32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform2iv(loc.location, arr.length >> 1, arr);
    },
    uniform3iv: (
      loc: NativeWebGLUniformLocation | null,
      v: Int32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceInt32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform3iv(loc.location, Math.floor(arr.length / 3), arr);
    },
    uniform4iv: (
      loc: NativeWebGLUniformLocation | null,
      v: Int32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceInt32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform4iv(loc.location, arr.length >> 2, arr);
    },
    uniform1ui: (loc: NativeWebGLUniformLocation | null, x: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform1ui(loc.location, x);
    },
    uniform1uiv: (
      loc: NativeWebGLUniformLocation | null,
      v: Uint32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceUint32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform1uiv(loc.location, arr.length, arr);
    },
    uniform1f: (loc: NativeWebGLUniformLocation | null, x: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform1f(loc.location, x);
    },
    uniform2f: (loc: NativeWebGLUniformLocation | null, x: number, y: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform2f(loc.location, x, y);
    },
    uniform3f: (loc: NativeWebGLUniformLocation | null, x: number, y: number, z: number): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform3f(loc.location, x, y, z);
    },
    uniform4f: (
      loc: NativeWebGLUniformLocation | null,
      x: number,
      y: number,
      z: number,
      w: number,
    ): void => {
      if (!loc) return;
      gl.makeCurrent();
      gl.uniform4f(loc.location, x, y, z, w);
    },
    uniform1fv: (
      loc: NativeWebGLUniformLocation | null,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform1fv(loc.location, arr.length, arr);
    },
    uniform2fv: (
      loc: NativeWebGLUniformLocation | null,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform2fv(loc.location, arr.length >> 1, arr);
    },
    uniform3fv: (
      loc: NativeWebGLUniformLocation | null,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform3fv(loc.location, Math.floor(arr.length / 3), arr);
    },
    uniform4fv: (
      loc: NativeWebGLUniformLocation | null,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniform4fv(loc.location, arr.length >> 2, arr);
    },
    uniformMatrix2fv: (
      loc: NativeWebGLUniformLocation | null,
      tr: boolean,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniformMatrix2fv(loc.location, arr.length >> 2, tr, arr);
    },
    uniformMatrix3fv: (
      loc: NativeWebGLUniformLocation | null,
      tr: boolean,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniformMatrix3fv(loc.location, Math.floor(arr.length / 9), tr, arr);
    },
    uniformMatrix4fv: (
      loc: NativeWebGLUniformLocation | null,
      tr: boolean,
      v: Float32List,
      srcOffset = 0,
      srcLength = 0,
    ): void => {
      if (!loc) return;
      const arr = sliceFloat32(v, srcOffset, srcLength);
      gl.makeCurrent();
      gl.uniformMatrix4fv(loc.location, arr.length >> 4, tr, arr);
    },
  };
}
