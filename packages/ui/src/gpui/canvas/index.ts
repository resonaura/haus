/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export { NativeCanvas2dSurface, type Canvas2dPresentCallback } from './canvas-2d.js';
export {
  createNativeCanvas,
  GpuiCanvasElement,
  installGpuiCanvasGlobals,
  type GpuiCanvasContextKind,
  type GpuiCanvasRect,
} from './element.js';
export { GpuiCanvas, type GpuiCanvasProps } from './surface.js';
export { createNativeWebGL2Context, type NativeWebGL2Context } from './webgl/context.js';
export { transpileWebGlShader, type TranspiledShader } from './webgl/glsl.js';
export type { NativeWebGLContextAttributes, WebGlFramePresentCallback } from './webgl/types.js';
