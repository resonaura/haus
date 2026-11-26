/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  createNativeCanvas,
  encodeBracketedPaste,
  encodeTerminalKeyEvent,
  GpuiXtermEngine,
  transpileWebGlShader,
} from '../src/gpui/index.js';

const VERTEX_SHADER = 0x8b31;
const FRAGMENT_SHADER = 0x8b30;

describe('GPUI WebGL GLSL transpiler', () => {
  it('translates WebGL2 GLSL ES 3.00 and strips ES precision lines for desktop Core Profile', () => {
    const src = [
      '#version 300 es',
      'precision highp float;',
      'precision highp sampler2DArray;',
      '#extension GL_EXT_color_buffer_float : require',
      'in vec3 position;',
      'void main() { gl_Position = vec4(position, 1.0); }',
    ].join('\n');
    const out = transpileWebGlShader(src, VERTEX_SHADER, 410);
    expect(out.isEs300).toBe(true);
    expect(out.source.startsWith('#version 410 core\n')).toBe(true);
    expect(out.source).not.toContain('precision highp');
    expect(out.source).not.toContain('GL_EXT_color_buffer_float');
    expect(out.source).toContain('in vec3 position;');
  });

  it('translates legacy WebGL1 GLSL ES 1.00 fragment shaders to Core Profile outputs', () => {
    const src = [
      'precision mediump float;',
      'varying vec2 vUv;',
      'uniform sampler2D uTex;',
      'void main() { gl_FragColor = texture2D(uTex, vUv); }',
    ].join('\n');
    const out = transpileWebGlShader(src, FRAGMENT_SHADER, 330);
    expect(out.isEs300).toBe(false);
    expect(out.source.startsWith('#version 330 core\nout vec4 _hausFragColor;\n')).toBe(true);
    expect(out.source).toContain('in vec2 vUv;');
    expect(out.source).toContain('_hausFragColor = texture(uTex, vUv);');
  });
});

describe('GPUI xterm VT100 keymap encoder', () => {
  const baseModes = {
    applicationCursorKeysMode: false,
    hasSelection: false,
    isMac: true,
  };

  it('encodes Ctrl control sequences, arrows, and application cursor mode', () => {
    expect(
      encodeTerminalKeyEvent(
        { key: 'c', ctrl: true, alt: false, shift: false, cmd: false },
        baseModes,
      ),
    ).toEqual({ kind: 'data', data: '\x03' });

    expect(
      encodeTerminalKeyEvent(
        { key: 'up', ctrl: false, alt: false, shift: false, cmd: false },
        baseModes,
      ),
    ).toEqual({ kind: 'data', data: '\x1b[A' });

    expect(
      encodeTerminalKeyEvent(
        { key: 'up', ctrl: false, alt: false, shift: false, cmd: false },
        { ...baseModes, applicationCursorKeysMode: true },
      ),
    ).toEqual({ kind: 'data', data: '\x1bOA' });

    expect(
      encodeTerminalKeyEvent(
        { key: 'tab', ctrl: false, alt: false, shift: true, cmd: false },
        baseModes,
      ),
    ).toEqual({ kind: 'data', data: '\x1b[Z' });

    expect(
      encodeTerminalKeyEvent(
        { key: 'f5', ctrl: false, alt: false, shift: false, cmd: false },
        baseModes,
      ),
    ).toEqual({ kind: 'data', data: '\x1b[15~' });
  });

  it('routes Cmd shortcuts and preserves Unicode keyChar + bracketed paste', () => {
    expect(
      encodeTerminalKeyEvent(
        { key: 'f', ctrl: false, alt: false, shift: false, cmd: true },
        baseModes,
      ),
    ).toEqual({ kind: 'action', action: 'search' });

    expect(
      encodeTerminalKeyEvent(
        { key: 'k', ctrl: false, alt: false, shift: false, cmd: true },
        baseModes,
      ),
    ).toEqual({ kind: 'action', action: 'clear' });

    expect(
      encodeTerminalKeyEvent(
        { key: 'p', keyChar: 'п', ctrl: false, alt: false, shift: false, cmd: false },
        baseModes,
      ),
    ).toEqual({ kind: 'data', data: 'п' });

    expect(encodeBracketedPaste('echo 1\necho 2', true)).toBe('\x1b[200~echo 1\recho 2\x1b[201~');
    expect(encodeBracketedPaste('echo 1\necho 2', false)).toBe('echo 1\recho 2');
  });
});

describe('GPUI xterm engine & Canvas 2D surface', () => {
  it('renders ANSI 16/256/truecolor output onto Skia Canvas 2D and supports search + selection', async () => {
    const canvas = createNativeCanvas(640, 320);
    const engine = new GpuiXtermEngine({ readOnly: false, themeMode: 'dark' });
    engine.attachCanvas(canvas);
    engine.fitToPixels(640, 320);

    await new Promise<void>((resolve) => {
      engine.write(
        '\x1b[1;32mops@willow\x1b[0m:~$ \x1b[38;2;90;200;250mdocker ps\x1b[0m\r\n' +
          'zigbee2mqtt  \x1b[32mUp 9 days (healthy)\x1b[0m\r\n' +
          'mosquitto    \x1b[33mUp 14 days\x1b[0m\r\n',
        resolve,
      );
    });
    engine.renderNow();

    const plain = engine.getPlainText();
    expect(plain).toContain('ops@willow:~$ docker ps');
    expect(plain).toContain('zigbee2mqtt');

    const found = engine.search('Up', { caseSensitive: true, wholeWord: true, regex: false });
    expect(found.resultCount).toBe(2);
    expect(found.resultIndex).toBe(0);
    expect(engine.findStep(false).resultIndex).toBe(1);
    expect(engine.findStep(false).resultIndex).toBe(0);

    engine.selectLine(1);
    expect(engine.getSelection()).toContain('zigbee2mqtt');

    const pixels = canvas.__readRgbaPixels();
    expect(pixels).not.toBeNull();
    expect(pixels!.width).toBe(1280);
    expect(pixels!.height).toBe(640);
    // Verify non-black colored glyph pixels were painted onto the black terminal surface.
    let nonBlackPixels = 0;
    for (let i = 0; i < pixels!.pixels.length; i += 4) {
      if (
        (pixels!.pixels[i] ?? 0) > 20 ||
        (pixels!.pixels[i + 1] ?? 0) > 20 ||
        (pixels!.pixels[i + 2] ?? 0) > 20
      ) {
        nonBlackPixels += 1;
      }
    }
    expect(nonBlackPixels).toBeGreaterThan(200);

    engine.dispose();
    canvas.dispose();
  });
});
