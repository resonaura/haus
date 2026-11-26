/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  COMPILED_GLASS_RIM_WGSL,
  GLASS_RIM_PRESETS,
  GlassRim,
  HausUiProvider,
  LiquidGlassMaterial,
  createDefaultShaderRegistry,
  createHausUiTheme,
  evaluateGlassRimIntensity,
  evaluateGlassRimSdf,
  mixColor,
  renderGlassRimNineSlice,
  resolveColorToSrgb,
  rgba,
  transparentColor,
} from '../src/index.js';
import { GpuiGlassRim } from '../src/gpui/glass-rim.js';
import { styleFor } from '../src/gpui/style.js';
import type { RenderContext } from '../src/renderers/contract.js';

function testRenderContext(overrides: Partial<RenderContext['viewport']> = {}): RenderContext {
  return {
    theme: createHausUiTheme('dark'),
    viewport: {
      width: 1280,
      height: 800,
      dpr: 2,
      reducedMotion: false,
      reducedTransparency: false,
      highContrast: false,
      ...overrides,
    },
    shaderRegistry: createDefaultShaderRegistry(),
  };
}

describe('shared analytical Glass Rim lighting engine', () => {
  it('evaluates supercircle SDF and dual-band specular + diffuse intensity', () => {
    const inside = evaluateGlassRimSdf(0, -19.5, 40, 20, 12);
    expect(inside.distance).toBeLessThan(0);
    expect(Math.abs(inside.normalY)).toBeGreaterThan(0.95);
    const crest = evaluateGlassRimIntensity(0.5, inside.normalY, 0.5);
    const diffuse = evaluateGlassRimIntensity(4.0, inside.normalY, 0.5);
    const deep = evaluateGlassRimIntensity(12.0, inside.normalY, 0.5);
    expect(crest).toBeGreaterThan(diffuse);
    expect(diffuse).toBeGreaterThan(0);
    expect(deep).toBe(0);
  });

  it('rasterizes symmetric 9-slice rim textures across all 7 presets', () => {
    expect(GLASS_RIM_PRESETS).toHaveLength(7);
    const raster = renderGlassRimNineSlice({ radius: 25, scale: 2, isDark: true });
    const midX = Math.floor(raster.width / 2);
    const topAlpha = raster.pixels[midX * 4 + 3] ?? 0;
    const bottomAlpha = raster.pixels[((raster.height - 1) * raster.width + midX) * 4 + 3] ?? 0;
    const centerAlpha =
      raster.pixels[(Math.floor(raster.height / 2) * raster.width + midX) * 4 + 3] ?? 0;
    expect(topAlpha).toBeGreaterThan(60);
    expect(bottomAlpha).toBe(topAlpha);
    expect(centerAlpha).toBe(0);
  });

  it('renders DOM GlassRim for neutral, tinted, multi-color effects and suppresses under reducedTransparency', () => {
    const neutral = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(GlassRim, { preset: 'card', opacity: 0.56 }),
      ),
    );
    expect(neutral).toContain('data-haus-glass-rim="card"');
    expect(neutral).toContain('data-rim-mode="neutral"');
    expect(neutral).toContain('var(--glass-rim-card)');

    const tinted = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(GlassRim, {
          preset: 'card',
          opacity: 0.76,
          tintColor: rgba(255, 204, 46),
        }),
      ),
    );
    expect(tinted).toContain('data-rim-mode="tint"');
    expect(tinted).toContain('mix-blend-mode:screen');

    const effect = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(GlassRim, {
          preset: 'card',
          opacity: 0.82,
          effectColors: [rgba(0, 229, 160), rgba(56, 189, 248), rgba(168, 85, 247)],
          effectMotion: 'aurora',
        }),
      ),
    );
    expect(effect).toContain('data-rim-mode="effect"');

    const suppressed = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark', reducedTransparency: true },
        React.createElement(GlassRim, { preset: 'card' }),
      ),
    );
    expect(suppressed).not.toContain('data-haus-glass-rim');
  });

  it('packs GPUIX glass-rim.wgsl uniforms and animated flag cleanly', () => {
    expect(COMPILED_GLASS_RIM_WGSL).toContain('fn shade(input: ShaderInput)');
    const ctx = testRenderContext();
    const neutralEl = GpuiGlassRim({ props: { preset: 'card', opacity: 0.56 }, context: ctx });
    expect(neutralEl).not.toBeNull();
    if (!neutralEl) throw new Error('expected neutral element');
    const neutralShader = (
      neutralEl.props as {
        style: { shader: { animated: boolean; samplesBackdrop: boolean; params: number[] } };
      }
    ).style.shader;
    expect(neutralShader.samplesBackdrop).toBe(false);
    expect(neutralShader.animated).toBe(false);
    expect(neutralShader.params[5]).toBe(0);

    const fxEl = GpuiGlassRim({
      props: {
        preset: 'card',
        opacity: 0.82,
        effectColors: [rgba(255, 100, 50), rgba(50, 200, 255), rgba(180, 90, 255)],
        effectMotion: 'rainbow',
      },
      context: ctx,
    });
    if (!fxEl) throw new Error('expected fx element');
    const fxShader = (
      fxEl.props as { style: { shader: { animated: boolean; params: number[]; colors: string[] } } }
    ).style.shader;
    expect(fxShader.animated).toBe(true);
    expect(fxShader.params[5]).toBe(2);
    expect(fxShader.params[6]).toBe(3);
    expect(fxShader.colors).toHaveLength(3);

    const reducedCtx = testRenderContext({ reducedMotion: true });
    const reducedEl = GpuiGlassRim({
      props: {
        preset: 'card',
        effectColors: [rgba(255, 100, 50), rgba(50, 200, 255), rgba(180, 90, 255)],
        effectMotion: 'rainbow',
      },
      context: reducedCtx,
    });
    if (!reducedEl) throw new Error('expected reduced element');
    const reducedShader = (
      reducedEl.props as { style: { shader: { animated: boolean; params: number[] } } }
    ).style.shader;
    expect(reducedShader.animated).toBe(false);
    expect(reducedShader.params[9]).toBe(1);
  });

  it('disables shader-embedded Liquid Glass rim when rimPreset is none so explicit GlassRim never doubles', () => {
    const ctx = testRenderContext();
    const managedGlass = new LiquidGlassMaterial({
      blurRadius: 16,
      refractionStrength: 16,
      chromaticDispersion: 0.55,
      rimPreset: 'none',
    });
    expect(managedGlass.toIR().rimLighting).toBeUndefined();
    const managedStyle = styleFor({ material: managedGlass }, ctx);
    expect(managedStyle.liquidGlass?.nativeRim).toBe(false);
    expect(managedStyle.liquidGlass?.specularDial).toBe(0);
    expect(managedStyle.liquidGlass?.edgeHighlight).toBe(0);
    expect(managedStyle.liquidGlass?.darkenedEdge).toBe(0);

    const standaloneGlass = new LiquidGlassMaterial({
      blurRadius: 16,
      refractionStrength: 16,
      rimPreset: 'card',
    });
    expect(standaloneGlass.toIR().rimLighting?.preset).toBe('card');
    const standaloneStyle = styleFor({ material: standaloneGlass }, ctx);
    expect(standaloneStyle.liquidGlass?.nativeRim).toBe(true);
    expect(standaloneStyle.liquidGlass?.specularDial).toBeGreaterThan(0);
    expect(standaloneStyle.liquidGlass?.edgeHighlight).toBeGreaterThan(0);
  });

  it('mixes colors with transparent using CSS Color 5 premultiplied alpha', () => {
    const theme = createHausUiTheme('dark');
    expect(
      resolveColorToSrgb(mixColor(transparentColor, rgba(255, 204, 46, 1), 0.25), theme),
    ).toEqual([255, 204, 46, 0.25]);
    expect(
      resolveColorToSrgb(mixColor(transparentColor, rgba(245, 245, 245, 1), 0.09), theme),
    ).toEqual([245, 245, 245, 0.09]);
  });
});
