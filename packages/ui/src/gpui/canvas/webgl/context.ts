/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { WEBGL2_CONSTANTS as GL } from './constants.js';
import { OffscreenFramebuffer } from './framebuffer.js';
import { createShaderMethods } from './methods-shaders.js';
import { createStateMethods, type WebGlInternalState } from './methods-state.js';
import { createTextureAndDrawMethods } from './methods-textures.js';
import { createNativeGlContext } from './native.js';
import type { NativeWebGLContextAttributes, WebGlFramePresentCallback } from './types.js';

/**
 * Creates a hardware-accelerated WebGL 2 context backed by OS OpenGL Core Profile
 * (Metal-backed OpenGL 4.1 on macOS, EGL/OpenGL 3.3 on Linux). Compatible with Three.js
 * (`THREE.WebGLRenderer`) and custom WebGL 1/2 shaders.
 */
export function createNativeWebGL2Context(
  canvas: { width: number; height: number },
  attrs: NativeWebGLContextAttributes | undefined,
  onPresent: WebGlFramePresentCallback,
) {
  const gl = createNativeGlContext();
  const resolvedAttrs: Required<NativeWebGLContextAttributes> = {
    alpha: attrs?.alpha ?? true,
    depth: attrs?.depth ?? true,
    stencil: attrs?.stencil ?? true,
    antialias: attrs?.antialias ?? true,
    premultipliedAlpha: attrs?.premultipliedAlpha ?? true,
    preserveDrawingBuffer: attrs?.preserveDrawingBuffer ?? false,
    powerPreference: attrs?.powerPreference ?? 'default',
  };
  const fbo = new OffscreenFramebuffer(gl, resolvedAttrs.antialias);
  const defaultVao = gl.genVertexArray();
  gl.bindVertexArray(defaultVao);
  fbo.ensureSize(canvas.width || 300, canvas.height || 150);
  gl.viewport(0, 0, fbo.width, fbo.height);

  let presentScheduled = false;

  const state: WebGlInternalState = {
    gl,
    fbo,
    attrs: resolvedAttrs,
    unpack: { flipY: false, premultiplyAlpha: false },
    defaultVao,
    boundVao: 0,
    boundDrawFbo: 0,
    boundReadFbo: 0,
    dirty: false,
    disposed: false,
    markDirty() {
      if (state.disposed || state.boundDrawFbo !== 0) return;
      state.dirty = true;
      if (!presentScheduled) {
        presentScheduled = true;
        queueMicrotask(() => {
          presentScheduled = false;
          if (state.dirty && !state.disposed) state.presentNow();
        });
      }
    },
    presentNow() {
      if (state.disposed) return;
      state.dirty = false;
      fbo.ensureSize(canvas.width || 1, canvas.height || 1);
      const bgra = fbo.readBgraPixels(state.boundDrawFbo, state.boundReadFbo);
      onPresent(fbo.width, fbo.height, bgra);
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      gl.makeCurrent();
      if (defaultVao) gl.deleteVertexArray(defaultVao);
      fbo.releaseResources();
      gl.dispose();
    },
  };

  const ctx = {
    ...GL,
    canvas,
    get drawingBufferWidth(): number {
      return fbo.width;
    },
    get drawingBufferHeight(): number {
      return fbo.height;
    },
    resize(width: number, height: number): void {
      if (state.disposed) return;
      gl.makeCurrent();
      fbo.ensureSize(width, height);
      if (state.boundDrawFbo === 0) gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, fbo.drawFramebufferId);
      if (state.boundReadFbo === 0) gl.bindFramebuffer(GL.READ_FRAMEBUFFER, fbo.readFramebufferId);
    },
    presentNow: () => state.presentNow(),
    readCurrentBgra(): {
      readonly width: number;
      readonly height: number;
      readonly bgra: Uint8Array;
    } {
      fbo.ensureSize(canvas.width || 1, canvas.height || 1);
      return {
        width: fbo.width,
        height: fbo.height,
        bgra: fbo.readBgraPixels(state.boundDrawFbo, state.boundReadFbo),
      };
    },
    dispose: () => state.dispose(),
    ...createStateMethods(state),
    ...createShaderMethods(state),
    ...createTextureAndDrawMethods(state),
  };

  return ctx;
}

export type NativeWebGL2Context = ReturnType<typeof createNativeWebGL2Context>;
