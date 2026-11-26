/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface KoffiLib {
  func(signature: string): (...args: unknown[]) => unknown;
}

export interface KoffiModule {
  load(path: string): KoffiLib;
}

export interface PlatformContextHandle {
  readonly glLib: KoffiLib;
  readonly targetGlslVersion: 410 | 330;
  makeCurrent(): void;
  dispose(): void;
}

export interface NativeGlActiveInfo {
  readonly name: string;
  readonly size: number;
  readonly type: number;
}

export class NativeGlHandle {
  constructor(readonly id: number) {}
}

export class NativeWebGLShader extends NativeGlHandle {
  constructor(
    id: number,
    readonly type: number,
  ) {
    super(id);
  }
}

export class NativeWebGLUniformLocation {
  constructor(readonly location: number) {}
}

export function unwrapHandle(handle: NativeGlHandle | null | undefined): number {
  return handle ? handle.id : 0;
}

export interface NativeWebGLContextAttributes {
  readonly alpha?: boolean;
  readonly depth?: boolean;
  readonly stencil?: boolean;
  readonly antialias?: boolean;
  readonly premultipliedAlpha?: boolean;
  readonly preserveDrawingBuffer?: boolean;
  readonly powerPreference?: string;
}

export type WebGlFramePresentCallback = (width: number, height: number, bgra: Uint8Array) => void;

export interface NativeGlContext {
  readonly targetGlslVersion: 410 | 330;
  makeCurrent(): void;
  dispose(): void;
  getError(): number;
  getString(name: number): string;
  getStringi(name: number, index: number): string;
  getInteger(pname: number): number;
  getIntegers(pname: number, count: number): Int32Array;
  getFloat(pname: number): number;
  getFloats(pname: number, count: number): Float32Array;
  getBoolean(pname: number): boolean;
  getBooleans(pname: number, count: number): boolean[];
  isEnabled(cap: number): boolean;
  enable(cap: number): void;
  disable(cap: number): void;
  viewport(x: number, y: number, w: number, h: number): void;
  scissor(x: number, y: number, w: number, h: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clearDepth(d: number): void;
  clearStencil(s: number): void;
  clear(mask: number): void;
  clearBufferfv(buffer: number, drawbuffer: number, values: Float32Array): void;
  clearBufferiv(buffer: number, drawbuffer: number, values: Int32Array): void;
  clearBufferuiv(buffer: number, drawbuffer: number, values: Uint32Array): void;
  clearBufferfi(buffer: number, drawbuffer: number, depth: number, stencil: number): void;
  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void;
  depthMask(flag: boolean): void;
  depthFunc(func: number): void;
  depthRange(zNear: number, zFar: number): void;
  cullFace(mode: number): void;
  frontFace(mode: number): void;
  polygonOffset(factor: number, units: number): void;
  lineWidth(width: number): void;
  blendColor(r: number, g: number, b: number, a: number): void;
  blendEquation(mode: number): void;
  blendEquationSeparate(modeRGB: number, modeAlpha: number): void;
  blendFunc(sfactor: number, dfactor: number): void;
  blendFuncSeparate(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void;
  stencilFunc(func: number, ref: number, mask: number): void;
  stencilFuncSeparate(face: number, func: number, ref: number, mask: number): void;
  stencilMask(mask: number): void;
  stencilMaskSeparate(face: number, mask: number): void;
  stencilOp(fail: number, zfail: number, zpass: number): void;
  stencilOpSeparate(face: number, fail: number, zfail: number, zpass: number): void;
  pixelStorei(pname: number, param: number): void;
  hint(target: number, mode: number): void;
  flush(): void;
  finish(): void;
  genBuffer(): number;
  deleteBuffer(id: number): void;
  bindBuffer(target: number, id: number): void;
  bindBufferBase(target: number, index: number, id: number): void;
  bindBufferRange(target: number, index: number, id: number, offset: number, size: number): void;
  bufferData(target: number, size: number, data: Uint8Array | null, usage: number): void;
  bufferSubData(target: number, offset: number, size: number, data: Uint8Array): void;
  copyBufferSubData(
    readTarget: number,
    writeTarget: number,
    readOffset: number,
    writeOffset: number,
    size: number,
  ): void;
  genVertexArray(): number;
  deleteVertexArray(id: number): void;
  bindVertexArray(id: number): void;
  enableVertexAttribArray(index: number): void;
  disableVertexAttribArray(index: number): void;
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void;
  vertexAttribIPointer(
    index: number,
    size: number,
    type: number,
    stride: number,
    offset: number,
  ): void;
  vertexAttribDivisor(index: number, divisor: number): void;
  vertexAttrib1f(index: number, x: number): void;
  vertexAttrib2f(index: number, x: number, y: number): void;
  vertexAttrib3f(index: number, x: number, y: number, z: number): void;
  vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void;
  createShader(type: number): number;
  deleteShader(id: number): void;
  shaderSource(id: number, source: string): void;
  compileShader(id: number): void;
  getShaderiv(id: number, pname: number): number;
  getShaderInfoLog(id: number): string;
  createProgram(): number;
  deleteProgram(id: number): void;
  attachShader(program: number, shader: number): void;
  detachShader(program: number, shader: number): void;
  linkProgram(program: number): void;
  validateProgram(program: number): void;
  useProgram(program: number): void;
  getProgramiv(program: number, pname: number): number;
  getProgramInfoLog(program: number): string;
  getActiveAttrib(program: number, index: number): NativeGlActiveInfo | null;
  getActiveUniform(program: number, index: number): NativeGlActiveInfo | null;
  getAttribLocation(program: number, name: string): number;
  bindAttribLocation(program: number, index: number, name: string): void;
  getUniformLocation(program: number, name: string): number;
  getUniformBlockIndex(program: number, name: string): number;
  uniformBlockBinding(program: number, blockIndex: number, bindingPoint: number): void;
  uniform1i(loc: number, x: number): void;
  uniform2i(loc: number, x: number, y: number): void;
  uniform3i(loc: number, x: number, y: number, z: number): void;
  uniform4i(loc: number, x: number, y: number, z: number, w: number): void;
  uniform1iv(loc: number, count: number, v: Int32Array): void;
  uniform2iv(loc: number, count: number, v: Int32Array): void;
  uniform3iv(loc: number, count: number, v: Int32Array): void;
  uniform4iv(loc: number, count: number, v: Int32Array): void;
  uniform1ui(loc: number, x: number): void;
  uniform1uiv(loc: number, count: number, v: Uint32Array): void;
  uniform1f(loc: number, x: number): void;
  uniform2f(loc: number, x: number, y: number): void;
  uniform3f(loc: number, x: number, y: number, z: number): void;
  uniform4f(loc: number, x: number, y: number, z: number, w: number): void;
  uniform1fv(loc: number, count: number, v: Float32Array): void;
  uniform2fv(loc: number, count: number, v: Float32Array): void;
  uniform3fv(loc: number, count: number, v: Float32Array): void;
  uniform4fv(loc: number, count: number, v: Float32Array): void;
  uniformMatrix2fv(loc: number, count: number, transpose: boolean, v: Float32Array): void;
  uniformMatrix3fv(loc: number, count: number, transpose: boolean, v: Float32Array): void;
  uniformMatrix4fv(loc: number, count: number, transpose: boolean, v: Float32Array): void;
  genTexture(): number;
  deleteTexture(id: number): void;
  activeTexture(unit: number): void;
  bindTexture(target: number, id: number): void;
  texParameteri(target: number, pname: number, param: number): void;
  texParameterf(target: number, pname: number, param: number): void;
  generateMipmap(target: number): void;
  texImage2D(
    target: number,
    level: number,
    internalFormat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: Uint8Array | null,
  ): void;
  texSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void;
  copyTexImage2D(
    target: number,
    level: number,
    internalFormat: number,
    x: number,
    y: number,
    width: number,
    height: number,
    border: number,
  ): void;
  copyTexSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  texImage3D(
    target: number,
    level: number,
    internalFormat: number,
    width: number,
    height: number,
    depth: number,
    border: number,
    format: number,
    type: number,
    pixels: Uint8Array | null,
  ): void;
  texSubImage3D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    zoffset: number,
    width: number,
    height: number,
    depth: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void;
  texStorage2D(target: number, levels: number, internalFormat: number, w: number, h: number): void;
  texStorage3D(
    target: number,
    levels: number,
    internalFormat: number,
    w: number,
    h: number,
    d: number,
  ): void;
  genSampler(): number;
  deleteSampler(id: number): void;
  bindSampler(unit: number, sampler: number): void;
  samplerParameteri(sampler: number, pname: number, param: number): void;
  samplerParameterf(sampler: number, pname: number, param: number): void;
  genFramebuffer(): number;
  deleteFramebuffer(id: number): void;
  bindFramebuffer(target: number, id: number): void;
  framebufferTexture2D(
    target: number,
    attachment: number,
    textarget: number,
    texture: number,
    level: number,
  ): void;
  framebufferTextureLayer(
    target: number,
    attachment: number,
    texture: number,
    level: number,
    layer: number,
  ): void;
  framebufferRenderbuffer(target: number, attachment: number, rbTarget: number, rb: number): void;
  checkFramebufferStatus(target: number): number;
  blitFramebuffer(
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
  ): void;
  drawBuffers(buffers: Uint32Array): void;
  readBuffer(src: number): void;
  genRenderbuffer(): number;
  deleteRenderbuffer(id: number): void;
  bindRenderbuffer(target: number, id: number): void;
  renderbufferStorage(target: number, internalFormat: number, w: number, h: number): void;
  renderbufferStorageMultisample(
    target: number,
    samples: number,
    internalFormat: number,
    w: number,
    h: number,
  ): void;
  drawArrays(mode: number, first: number, count: number): void;
  drawElements(mode: number, count: number, type: number, offset: number): void;
  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void;
  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
  ): void;
  readPixelsRaw(
    x: number,
    y: number,
    w: number,
    h: number,
    format: number,
    type: number,
    dest: Uint8Array,
  ): void;
  readFramebufferBgraFlipped(width: number, height: number, dest: Uint8Array): void;
}
