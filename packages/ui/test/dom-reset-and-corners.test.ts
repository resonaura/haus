/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { createHausUiTheme } from '../src/generated/index.js';
import { styleFor } from '../src/gpui/style.js';
import { buildGpuiSvgSource } from '../src/gpui/vector.js';
import { corners, superellipseToContinuousRadiusRatio } from '../src/ir/geometry.js';
import { createDefaultShaderRegistry } from '../src/ir/materials.js';
import type { RenderContext } from '../src/renderers/contract.js';
import { HAUS_DOM_RESET_CSS } from '../src/renderers/dom-reset.js';
import { compileStyleToReactCss } from '../src/renderers/react-dom.js';

function makeContext(): RenderContext {
  return {
    theme: createHausUiTheme('dark'),
    viewport: {
      width: 1440,
      height: 900,
      dpr: 2,
      reducedMotion: false,
      reducedTransparency: false,
      highContrast: false,
    },
    shaderRegistry: createDefaultShaderRegistry(),
  };
}

describe('DOM CSS reset and cross-renderer corner parity', () => {
  it('provides a zero-specificity :where(...) reset covering all semantic HTML tags', () => {
    expect(HAUS_DOM_RESET_CSS).toContain(':where(*, *::before, *::after)');
    expect(HAUS_DOM_RESET_CSS).toContain(':where(button, input, select, textarea)');
    expect(HAUS_DOM_RESET_CSS).toContain(':where(h1, h2, h3, h4, h5, h6');
    expect(HAUS_DOM_RESET_CSS).toContain(':where(ul, ol)');
    expect(HAUS_DOM_RESET_CSS).toContain(':where(img, svg, video, canvas');
    expect(HAUS_DOM_RESET_CSS).toContain(':where(table)');
    expect(HAUS_DOM_RESET_CSS).toContain('box-sizing: border-box');
    expect(HAUS_DOM_RESET_CSS).toContain('appearance: none');
  });

  it('aligns GPUI continuous corner diagonal inset to CSS superellipse(1.4) within 0.05px', () => {
    const ctx = makeContext();
    const radius = 26;
    const domStyle = compileStyleToReactCss({ corners: corners(radius) }, ctx).style as Record<
      string,
      unknown
    >;
    const gpuiStyle = styleFor({ corners: corners(radius) }, ctx);

    expect(domStyle.borderTopLeftRadius).toBe('26px');
    expect(domStyle.cornerShape).toBe('superellipse(1.4)');

    const expectedRatio = superellipseToContinuousRadiusRatio(1.4);
    expect(gpuiStyle.cornerSmoothing).toBe(1);
    expect(gpuiStyle.borderTopLeftRadius).toBeCloseTo(radius * expectedRatio, 1);

    // Diagonal inset of CSS superellipse(1.4) equals GPUI's continuous corner diagonal inset.
    const cssDiagonalInset = radius * (1 - 2 ** (-1 / 2 ** 1.4));
    const gpuiDiagonalInset = Number(gpuiStyle.borderTopLeftRadius) * (1 - Math.SQRT1_2);
    expect(Math.abs(cssDiagonalInset - gpuiDiagonalInset)).toBeLessThan(0.05);
  });

  it('keeps pills and round corners unscaled with cornerSmoothing 0 on GPUI and round on DOM', () => {
    const ctx = makeContext();
    const domPill = compileStyleToReactCss({ corners: corners(999) }, ctx).style as Record<
      string,
      unknown
    >;
    const gpuiPill = styleFor({ corners: corners(999) }, ctx);
    const gpuiRound = styleFor({ corners: corners(16, 'round') }, ctx);

    expect(domPill.cornerShape).toBe('round');
    expect(gpuiPill.cornerSmoothing).toBe(0);
    expect(gpuiPill.borderTopLeftRadius).toBe(999);
    expect(gpuiRound.cornerSmoothing).toBe(0);
    expect(gpuiRound.borderTopLeftRadius).toBe(16);
  });

  it('serializes structured VectorGraphic paths and circles into GPUI SVG markup', () => {
    const markup = buildGpuiSvgSource({
      viewWidth: 200,
      viewHeight: 42,
      paths: [{ d: 'M0,20 L100,10', stroke: 'currentColor', strokeWidth: 1.6 }],
      circles: [{ cx: 16, cy: 16, r: 2, fill: 'currentColor', opacity: 0.7 }],
    });
    expect(markup).toBeDefined();
    expect(markup).toContain('viewBox="0 0 200 42"');
    expect(markup).toContain('d="M0,20 L100,10"');
    expect(markup).toContain('stroke="#000"');
    expect(markup).toContain('<circle cx="16" cy="16" r="2" fill="#000"');
  });

  it('auto-applies display:flex for flex layout properties without overriding grid layouts', () => {
    const ctx = makeContext();
    const rowCss = compileStyleToReactCss(
      { layout: { direction: 'row', alignItems: 'center', justifyContent: 'between' } },
      ctx,
    ).style;
    expect(rowCss.display).toBe('flex');
    expect(rowCss.flexDirection).toBe('row');
    expect(rowCss.justifyContent).toBe('space-between');

    const gridCss = compileStyleToReactCss(
      { layout: { gridColumns: 3, alignItems: 'center' } },
      ctx,
    ).style;
    expect(gridCss.display).toBe('grid');
  });
});
