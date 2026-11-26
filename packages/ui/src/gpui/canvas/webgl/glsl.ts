/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const VERTEX_SHADER = 0x8b31;

export interface TranspiledShader {
  readonly source: string;
  readonly isEs300: boolean;
}

/**
 * Translates WebGL 2 (`#version 300 es`) and WebGL 1 (`#version 100` / unversioned) GLSL ES
 * shaders into Desktop OpenGL Core Profile GLSL (`#version 410 core` on macOS, `330 core` on Linux).
 */
export function transpileWebGlShader(
  rawSource: string,
  shaderType: number,
  targetVersion: 410 | 330 = 410,
): TranspiledShader {
  const normalized = rawSource.replace(/\r\n/g, '\n');
  const isEs300 = /^\s*#version\s+300\s+es\b/m.test(normalized);
  const isVertex = shaderType === VERTEX_SHADER;
  const header = `#version ${targetVersion} core\n`;

  let body = normalized
    .replace(/^\s*#version\s+[^\n]*\n?/m, '')
    // Strip WebGL ES-only precision declarations (macOS OpenGL 4.1 rejects sampler/int precision lines).
    .replace(/^\s*precision\s+(?:lowp|mediump|highp)\s+\w+\s*;\s*$/gm, '')
    // Strip WebGL ES extension directives that are core in OpenGL 3.3+/4.1+.
    .replace(/^\s*#extension\s+GL_(?:OES|EXT|WEBGL|ANGLE)_[^\n]*$/gm, '');

  if (isEs300) {
    return { source: `${header}${body}`, isEs300: true };
  }

  // WebGL 1 (GLSL ES 1.00) -> Desktop Core Profile 330/410
  if (isVertex) {
    body = body
      .replace(/\battribute\s+/g, 'in ')
      .replace(/\bvarying\s+/g, 'out ')
      .replace(/\btexture2D\s*\(/g, 'texture(')
      .replace(/\btextureCube\s*\(/g, 'texture(')
      .replace(/\btexture2DLodEXT\s*\(/g, 'textureLod(')
      .replace(/\btextureCubeLodEXT\s*\(/g, 'textureLod(');
    return { source: `${header}${body}`, isEs300: false };
  }

  const usesFragColor = /\bgl_FragColor\b/.test(body);
  const usesFragData = /\bgl_FragData\b/.test(body);
  body = body
    .replace(/\bvarying\s+/g, 'in ')
    .replace(/\btexture2D\s*\(/g, 'texture(')
    .replace(/\btextureCube\s*\(/g, 'texture(')
    .replace(/\btexture2DProj\s*\(/g, 'textureProj(')
    .replace(/\btexture2DLodEXT\s*\(/g, 'textureLod(')
    .replace(/\btextureCubeLodEXT\s*\(/g, 'textureLod(')
    .replace(/\btexture2DGradEXT\s*\(/g, 'textureGrad(')
    .replace(/\btextureCubeGradEXT\s*\(/g, 'textureGrad(');

  let fragDecl = '';
  if (usesFragColor) {
    fragDecl = 'out vec4 _hausFragColor;\n';
    body = body.replace(/\bgl_FragColor\b/g, '_hausFragColor');
  } else if (usesFragData) {
    fragDecl = 'out vec4 _hausFragData[4];\n';
    body = body.replace(/\bgl_FragData\b/g, '_hausFragData');
  }

  return { source: `${header}${fragDecl}${body}`, isEs300: false };
}
