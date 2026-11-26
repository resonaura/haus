/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { KoffiLib } from './types.js';

function optionalFunc(glLib: KoffiLib, signature: string) {
  try {
    return glLib.func(signature);
  } catch {
    return null;
  }
}

/** Binds all OpenGL Core Profile C entry points required by our native WebGL 2 context. */
export function bindNativeGlSymbols(glLib: KoffiLib) {
  const f = (sig: string) => glLib.func(sig);
  return {
    glGetError: f('uint32_t glGetError()'),
    glGetString: f('const char *glGetString(uint32_t name)'),
    glGetStringi: f('const char *glGetStringi(uint32_t name, uint32_t index)'),
    glGetIntegerv: f('void glGetIntegerv(uint32_t pname, _Out_ int32_t *data)'),
    glGetFloatv: f('void glGetFloatv(uint32_t pname, _Out_ float *data)'),
    glGetBooleanv: f('void glGetBooleanv(uint32_t pname, _Out_ uint8_t *data)'),
    glIsEnabled: f('uint8_t glIsEnabled(uint32_t cap)'),
    glEnable: f('void glEnable(uint32_t cap)'),
    glDisable: f('void glDisable(uint32_t cap)'),
    glViewport: f('void glViewport(int x, int y, int w, int h)'),
    glScissor: f('void glScissor(int x, int y, int w, int h)'),
    glClearColor: f('void glClearColor(float r, float g, float b, float a)'),
    glClearDepth: f('void glClearDepth(double d)'),
    glClearStencil: f('void glClearStencil(int s)'),
    glClear: f('void glClear(uint32_t mask)'),
    glClearBufferfv: f('void glClearBufferfv(uint32_t buf, int drawbuf, const float *v)'),
    glClearBufferiv: f('void glClearBufferiv(uint32_t buf, int drawbuf, const int32_t *v)'),
    glClearBufferuiv: f('void glClearBufferuiv(uint32_t buf, int drawbuf, const uint32_t *v)'),
    glClearBufferfi: f('void glClearBufferfi(uint32_t buf, int drawbuf, float d, int s)'),
    glColorMask: f('void glColorMask(uint8_t r, uint8_t g, uint8_t b, uint8_t a)'),
    glDepthMask: f('void glDepthMask(uint8_t flag)'),
    glDepthFunc: f('void glDepthFunc(uint32_t func)'),
    glDepthRange: f('void glDepthRange(double zNear, double zFar)'),
    glCullFace: f('void glCullFace(uint32_t mode)'),
    glFrontFace: f('void glFrontFace(uint32_t mode)'),
    glPolygonOffset: f('void glPolygonOffset(float factor, float units)'),
    glLineWidth: f('void glLineWidth(float width)'),
    glBlendColor: f('void glBlendColor(float r, float g, float b, float a)'),
    glBlendEquation: f('void glBlendEquation(uint32_t mode)'),
    glBlendEquationSeparate: f('void glBlendEquationSeparate(uint32_t mRgb, uint32_t mA)'),
    glBlendFunc: f('void glBlendFunc(uint32_t sf, uint32_t df)'),
    glBlendFuncSeparate: f(
      'void glBlendFuncSeparate(uint32_t sr, uint32_t dr, uint32_t sa, uint32_t da)',
    ),
    glStencilFunc: f('void glStencilFunc(uint32_t func, int ref, uint32_t mask)'),
    glStencilFuncSeparate: f(
      'void glStencilFuncSeparate(uint32_t face, uint32_t func, int ref, uint32_t mask)',
    ),
    glStencilMask: f('void glStencilMask(uint32_t mask)'),
    glStencilMaskSeparate: f('void glStencilMaskSeparate(uint32_t face, uint32_t mask)'),
    glStencilOp: f('void glStencilOp(uint32_t f, uint32_t zf, uint32_t zp)'),
    glStencilOpSeparate: f(
      'void glStencilOpSeparate(uint32_t face, uint32_t f, uint32_t zf, uint32_t zp)',
    ),
    glPixelStorei: f('void glPixelStorei(uint32_t pname, int param)'),
    glHint: f('void glHint(uint32_t target, uint32_t mode)'),
    glFlush: f('void glFlush()'),
    glFinish: f('void glFinish()'),
    glGenBuffers: f('void glGenBuffers(int n, _Out_ uint32_t *ids)'),
    glDeleteBuffers: f('void glDeleteBuffers(int n, const uint32_t *ids)'),
    glBindBuffer: f('void glBindBuffer(uint32_t target, uint32_t id)'),
    glBindBufferBase: f('void glBindBufferBase(uint32_t target, uint32_t idx, uint32_t id)'),
    glBindBufferRange: f(
      'void glBindBufferRange(uint32_t target, uint32_t idx, uint32_t id, intptr_t off, intptr_t sz)',
    ),
    glBufferData: f(
      'void glBufferData(uint32_t target, intptr_t size, const void *data, uint32_t usage)',
    ),
    glBufferSubData: f(
      'void glBufferSubData(uint32_t target, intptr_t off, intptr_t size, const void *data)',
    ),
    glCopyBufferSubData: f(
      'void glCopyBufferSubData(uint32_t rt, uint32_t wt, intptr_t ro, intptr_t wo, intptr_t sz)',
    ),
    glGenVertexArrays: f('void glGenVertexArrays(int n, _Out_ uint32_t *ids)'),
    glDeleteVertexArrays: f('void glDeleteVertexArrays(int n, const uint32_t *ids)'),
    glBindVertexArray: f('void glBindVertexArray(uint32_t id)'),
    glEnableVertexAttribArray: f('void glEnableVertexAttribArray(uint32_t idx)'),
    glDisableVertexAttribArray: f('void glDisableVertexAttribArray(uint32_t idx)'),
    glVertexAttribPointer: f(
      'void glVertexAttribPointer(uint32_t idx, int sz, uint32_t type, uint8_t norm, int stride, uintptr_t offset)',
    ),
    glVertexAttribIPointer: f(
      'void glVertexAttribIPointer(uint32_t idx, int sz, uint32_t type, int stride, uintptr_t offset)',
    ),
    glVertexAttribDivisor: f('void glVertexAttribDivisor(uint32_t idx, uint32_t div)'),
    glVertexAttrib1f: f('void glVertexAttrib1f(uint32_t idx, float x)'),
    glVertexAttrib2f: f('void glVertexAttrib2f(uint32_t idx, float x, float y)'),
    glVertexAttrib3f: f('void glVertexAttrib3f(uint32_t idx, float x, float y, float z)'),
    glVertexAttrib4f: f('void glVertexAttrib4f(uint32_t idx, float x, float y, float z, float w)'),
    glCreateShader: f('uint32_t glCreateShader(uint32_t type)'),
    glDeleteShader: f('void glDeleteShader(uint32_t id)'),
    glShaderSource: f(
      'void glShaderSource(uint32_t shader, int count, const char **str, const int *len)',
    ),
    glCompileShader: f('void glCompileShader(uint32_t id)'),
    glGetShaderiv: f('void glGetShaderiv(uint32_t id, uint32_t pname, _Out_ int32_t *params)'),
    glGetShaderInfoLog: f(
      'void glGetShaderInfoLog(uint32_t id, int maxLen, _Out_ int32_t *len, _Out_ uint8_t *log)',
    ),
    glCreateProgram: f('uint32_t glCreateProgram()'),
    glDeleteProgram: f('void glDeleteProgram(uint32_t id)'),
    glAttachShader: f('void glAttachShader(uint32_t prog, uint32_t shader)'),
    glDetachShader: f('void glDetachShader(uint32_t prog, uint32_t shader)'),
    glLinkProgram: f('void glLinkProgram(uint32_t prog)'),
    glValidateProgram: f('void glValidateProgram(uint32_t prog)'),
    glUseProgram: f('void glUseProgram(uint32_t prog)'),
    glGetProgramiv: f('void glGetProgramiv(uint32_t prog, uint32_t pname, _Out_ int32_t *params)'),
    glGetProgramInfoLog: f(
      'void glGetProgramInfoLog(uint32_t prog, int maxLen, _Out_ int32_t *len, _Out_ uint8_t *log)',
    ),
    glGetActiveAttrib: f(
      'void glGetActiveAttrib(uint32_t prog, uint32_t idx, int bufSize, _Out_ int32_t *len, _Out_ int32_t *size, _Out_ uint32_t *type, _Out_ uint8_t *name)',
    ),
    glGetActiveUniform: f(
      'void glGetActiveUniform(uint32_t prog, uint32_t idx, int bufSize, _Out_ int32_t *len, _Out_ int32_t *size, _Out_ uint32_t *type, _Out_ uint8_t *name)',
    ),
    glGetAttribLocation: f('int glGetAttribLocation(uint32_t prog, const char *name)'),
    glBindAttribLocation: f(
      'void glBindAttribLocation(uint32_t prog, uint32_t idx, const char *name)',
    ),
    glGetUniformLocation: f('int glGetUniformLocation(uint32_t prog, const char *name)'),
    glGetUniformBlockIndex: f('uint32_t glGetUniformBlockIndex(uint32_t prog, const char *name)'),
    glUniformBlockBinding: f(
      'void glUniformBlockBinding(uint32_t prog, uint32_t idx, uint32_t bp)',
    ),
    glUniform1i: f('void glUniform1i(int loc, int x)'),
    glUniform2i: f('void glUniform2i(int loc, int x, int y)'),
    glUniform3i: f('void glUniform3i(int loc, int x, int y, int z)'),
    glUniform4i: f('void glUniform4i(int loc, int x, int y, int z, int w)'),
    glUniform1iv: f('void glUniform1iv(int loc, int count, const int32_t *v)'),
    glUniform2iv: f('void glUniform2iv(int loc, int count, const int32_t *v)'),
    glUniform3iv: f('void glUniform3iv(int loc, int count, const int32_t *v)'),
    glUniform4iv: f('void glUniform4iv(int loc, int count, const int32_t *v)'),
    glUniform1ui: f('void glUniform1ui(int loc, uint32_t x)'),
    glUniform1uiv: f('void glUniform1uiv(int loc, int count, const uint32_t *v)'),
    glUniform1f: f('void glUniform1f(int loc, float x)'),
    glUniform2f: f('void glUniform2f(int loc, float x, float y)'),
    glUniform3f: f('void glUniform3f(int loc, float x, float y, float z)'),
    glUniform4f: f('void glUniform4f(int loc, float x, float y, float z, float w)'),
    glUniform1fv: f('void glUniform1fv(int loc, int count, const float *v)'),
    glUniform2fv: f('void glUniform2fv(int loc, int count, const float *v)'),
    glUniform3fv: f('void glUniform3fv(int loc, int count, const float *v)'),
    glUniform4fv: f('void glUniform4fv(int loc, int count, const float *v)'),
    glUniformMatrix2fv: f(
      'void glUniformMatrix2fv(int loc, int count, uint8_t tr, const float *v)',
    ),
    glUniformMatrix3fv: f(
      'void glUniformMatrix3fv(int loc, int count, uint8_t tr, const float *v)',
    ),
    glUniformMatrix4fv: f(
      'void glUniformMatrix4fv(int loc, int count, uint8_t tr, const float *v)',
    ),
    glGenTextures: f('void glGenTextures(int n, _Out_ uint32_t *ids)'),
    glDeleteTextures: f('void glDeleteTextures(int n, const uint32_t *ids)'),
    glActiveTexture: f('void glActiveTexture(uint32_t unit)'),
    glBindTexture: f('void glBindTexture(uint32_t target, uint32_t id)'),
    glTexParameteri: f('void glTexParameteri(uint32_t target, uint32_t pname, int param)'),
    glTexParameterf: f('void glTexParameterf(uint32_t target, uint32_t pname, float param)'),
    glGenerateMipmap: f('void glGenerateMipmap(uint32_t target)'),
    glTexImage2D: f(
      'void glTexImage2D(uint32_t t, int lvl, int ifmt, int w, int h, int b, uint32_t fmt, uint32_t typ, const void *px)',
    ),
    glTexSubImage2D: f(
      'void glTexSubImage2D(uint32_t t, int lvl, int xo, int yo, int w, int h, uint32_t fmt, uint32_t typ, const void *px)',
    ),
    glCopyTexImage2D: f(
      'void glCopyTexImage2D(uint32_t t, int lvl, uint32_t ifmt, int x, int y, int w, int h, int b)',
    ),
    glCopyTexSubImage2D: f(
      'void glCopyTexSubImage2D(uint32_t t, int lvl, int xo, int yo, int x, int y, int w, int h)',
    ),
    glTexImage3D: f(
      'void glTexImage3D(uint32_t t, int lvl, int ifmt, int w, int h, int d, int b, uint32_t fmt, uint32_t typ, const void *px)',
    ),
    glTexSubImage3D: f(
      'void glTexSubImage3D(uint32_t t, int lvl, int xo, int yo, int zo, int w, int h, int d, uint32_t fmt, uint32_t typ, const void *px)',
    ),
    glTexStorage2D: optionalFunc(
      glLib,
      'void glTexStorage2D(uint32_t t, int lvls, uint32_t ifmt, int w, int h)',
    ),
    glTexStorage3D: optionalFunc(
      glLib,
      'void glTexStorage3D(uint32_t t, int lvls, uint32_t ifmt, int w, int h, int d)',
    ),
    glGenSamplers: f('void glGenSamplers(int n, _Out_ uint32_t *ids)'),
    glDeleteSamplers: f('void glDeleteSamplers(int n, const uint32_t *ids)'),
    glBindSampler: f('void glBindSampler(uint32_t unit, uint32_t sampler)'),
    glSamplerParameteri: f('void glSamplerParameteri(uint32_t sampler, uint32_t pname, int param)'),
    glSamplerParameterf: f(
      'void glSamplerParameterf(uint32_t sampler, uint32_t pname, float param)',
    ),
    glGenFramebuffers: f('void glGenFramebuffers(int n, _Out_ uint32_t *ids)'),
    glDeleteFramebuffers: f('void glDeleteFramebuffers(int n, const uint32_t *ids)'),
    glBindFramebuffer: f('void glBindFramebuffer(uint32_t target, uint32_t id)'),
    glFramebufferTexture2D: f(
      'void glFramebufferTexture2D(uint32_t t, uint32_t att, uint32_t tt, uint32_t tex, int lvl)',
    ),
    glFramebufferTextureLayer: f(
      'void glFramebufferTextureLayer(uint32_t t, uint32_t att, uint32_t tex, int lvl, int layer)',
    ),
    glFramebufferRenderbuffer: f(
      'void glFramebufferRenderbuffer(uint32_t t, uint32_t att, uint32_t rbt, uint32_t rb)',
    ),
    glCheckFramebufferStatus: f('uint32_t glCheckFramebufferStatus(uint32_t target)'),
    glBlitFramebuffer: f(
      'void glBlitFramebuffer(int sx0, int sy0, int sx1, int sy1, int dx0, int dy0, int dx1, int dy1, uint32_t mask, uint32_t filter)',
    ),
    glDrawBuffers: f('void glDrawBuffers(int n, const uint32_t *bufs)'),
    glReadBuffer: f('void glReadBuffer(uint32_t src)'),
    glGenRenderbuffers: f('void glGenRenderbuffers(int n, _Out_ uint32_t *ids)'),
    glDeleteRenderbuffers: f('void glDeleteRenderbuffers(int n, const uint32_t *ids)'),
    glBindRenderbuffer: f('void glBindRenderbuffer(uint32_t target, uint32_t id)'),
    glRenderbufferStorage: f('void glRenderbufferStorage(uint32_t t, uint32_t ifmt, int w, int h)'),
    glRenderbufferStorageMultisample: f(
      'void glRenderbufferStorageMultisample(uint32_t t, int samples, uint32_t ifmt, int w, int h)',
    ),
    glDrawArrays: f('void glDrawArrays(uint32_t mode, int first, int count)'),
    glDrawElements: f(
      'void glDrawElements(uint32_t mode, int count, uint32_t type, uintptr_t offset)',
    ),
    glDrawArraysInstanced: f(
      'void glDrawArraysInstanced(uint32_t mode, int first, int count, int ic)',
    ),
    glDrawElementsInstanced: f(
      'void glDrawElementsInstanced(uint32_t mode, int count, uint32_t type, uintptr_t offset, int ic)',
    ),
    glReadPixels: f(
      'void glReadPixels(int x, int y, int w, int h, uint32_t fmt, uint32_t typ, _Out_ uint8_t *px)',
    ),
  };
}
