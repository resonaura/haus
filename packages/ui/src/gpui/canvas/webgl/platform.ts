/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import koffi from 'koffi';
import type { KoffiLib, KoffiModule, PlatformContextHandle } from './types.js';

function loadKoffi(): KoffiModule {
  return {
    load(path: string): KoffiLib {
      const lib = koffi.load(path);
      return {
        func(signature: string) {
          const fn = lib.func(signature);
          return (...args: unknown[]) => fn(...args);
        },
      };
    },
  };
}

function runtimePlatform(): string {
  const proc = (globalThis as { readonly process?: { readonly platform?: string } }).process;
  return proc?.platform ?? '';
}

function createMacOsContext(koffi: KoffiModule): PlatformContextHandle {
  const glLib = koffi.load('/System/Library/Frameworks/OpenGL.framework/OpenGL');
  const choose = glLib.func(
    'int CGLChoosePixelFormat(const int *attribs, _Out_ void **pix, _Out_ int *npix)',
  );
  const create = glLib.func('int CGLCreateContext(void *pix, void *share, _Out_ void **ctx)');
  const setCurrent = glLib.func('int CGLSetCurrentContext(void *ctx)');
  const destroyPix = glLib.func('int CGLDestroyPixelFormat(void *pix)');
  const destroyCtx = glLib.func('int CGLDestroyContext(void *ctx)');

  // kCGLPFAOpenGLProfile(99)=GL4_Core(0x4100), kCGLPFAAccelerated(73), kCGLPFAAllowOfflineRenderers(96)
  const attribs = new Int32Array([99, 0x4100, 73, 96, 0]);
  const pixOut: unknown[] = [null];
  const npixOut = new Int32Array(1);
  const err1 = choose(attribs, pixOut, npixOut) as number;
  if (err1 !== 0 || !pixOut[0]) {
    throw new Error(`macOS CGLChoosePixelFormat failed (${err1})`);
  }
  const ctxOut: unknown[] = [null];
  const err2 = create(pixOut[0], null, ctxOut) as number;
  destroyPix(pixOut[0]);
  if (err2 !== 0 || !ctxOut[0]) {
    throw new Error(`macOS CGLCreateContext failed (${err2})`);
  }
  const ctxHandle = ctxOut[0];
  setCurrent(ctxHandle);
  let disposed = false;
  return {
    glLib,
    targetGlslVersion: 410,
    makeCurrent: () => {
      if (!disposed) setCurrent(ctxHandle);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      setCurrent(null);
      destroyCtx(ctxHandle);
    },
  };
}

function createLinuxEglContext(koffi: KoffiModule): PlatformContextHandle {
  const egl = koffi.load('libEGL.so.1');
  const glLib = koffi.load('libGL.so.1');
  const getDisplay = egl.func('void *eglGetDisplay(void *displayId)');
  const init = egl.func('uint32_t eglInitialize(void *dpy, _Out_ int *major, _Out_ int *minor)');
  const bindApi = egl.func('uint32_t eglBindAPI(uint32_t api)');
  const chooseConfig = egl.func(
    'uint32_t eglChooseConfig(void *dpy, const int *attribs, _Out_ void **configs, int configSize, _Out_ int *numConfig)',
  );
  const createPbuffer = egl.func(
    'void *eglCreatePbufferSurface(void *dpy, void *config, const int *attribs)',
  );
  const createContext = egl.func(
    'void *eglCreateContext(void *dpy, void *config, void *share, const int *attribs)',
  );
  const makeCurrent = egl.func(
    'uint32_t eglMakeCurrent(void *dpy, void *draw, void *read, void *ctx)',
  );
  const destroyContext = egl.func('uint32_t eglDestroyContext(void *dpy, void *ctx)');
  const destroySurface = egl.func('uint32_t eglDestroySurface(void *dpy, void *surface)');

  const dpy = getDisplay(null);
  if (!dpy) throw new Error('Linux eglGetDisplay returned null');
  const major = new Int32Array(1);
  const minor = new Int32Array(1);
  if (!init(dpy, major, minor)) throw new Error('Linux eglInitialize failed');
  bindApi(0x30a2); // EGL_OPENGL_API
  const cfgAttribs = new Int32Array([0x3033, 0x0001, 0x3040, 0x0008, 0x3038]);
  const configs: unknown[] = [null];
  const numCfg = new Int32Array(1);
  if (!chooseConfig(dpy, cfgAttribs, configs, 1, numCfg) || !configs[0]) {
    throw new Error('Linux eglChooseConfig failed');
  }
  const surface = createPbuffer(dpy, configs[0], new Int32Array([0x3057, 16, 0x3056, 16, 0x3038]));
  const ctxAttribs = new Int32Array([0x3098, 3, 0x30fb, 3, 0x30fd, 0x0001, 0x3038]);
  const ctx = createContext(dpy, configs[0], null, ctxAttribs);
  if (!ctx) throw new Error('Linux eglCreateContext failed');
  makeCurrent(dpy, surface, surface, ctx);
  let disposed = false;
  return {
    glLib,
    targetGlslVersion: 330,
    makeCurrent: () => {
      if (!disposed) makeCurrent(dpy, surface, surface, ctx);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      makeCurrent(dpy, null, null, null);
      destroyContext(dpy, ctx);
      if (surface) destroySurface(dpy, surface);
    },
  };
}

/** Creates an offscreen OS hardware OpenGL Core Profile context (macOS CGL 4.1 / Linux EGL 3.3). */
export function createPlatformGlContext(): PlatformContextHandle {
  const koffi = loadKoffi();
  const platform = runtimePlatform();
  if (platform === 'darwin') return createMacOsContext(koffi);
  if (platform === 'linux') return createLinuxEglContext(koffi);
  throw new Error(`Native offscreen WebGL2 is not yet configured for ${platform}`);
}
