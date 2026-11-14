/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { SEGMENTATION_CHI2_CDF } from './chi2-table';
import { decodeBase64Bytes } from './decode-lut';
import { chooseDarkIconColor, DARK_BACKGROUND, iconContrastRatio, iconSRGBTransfer } from './color';
import { iconContourLightSettings, iconGlassHighlight } from './contour';
import {
  enclosureGlassRim,
  enclosureRimComposite,
  evaluateEnclosureSdf,
  renderEnclosureTileToRgba,
} from './enclosure';
import { generateLegacyIconLayers, prepareLegacyIcon } from './layers';
import { ICON_CUBIC_WEIGHTS, ICON_DISTANCE_LUT_BITS, ICON_DITHER_NOISE_RGB } from './luts';
import { float16Bits, float16Value, half, halfFma, premultipliedIconPixels } from './math';
import { createLegacyColorPresentation } from './presentation';
import { categorizeIconShape, detectIconShape, standardIconCornerRadius } from './shape';
import { ICON_COLOR_TRANSFER_BITS } from './transfer-table';

function makeRoundedGlyphRgba(
  size: number,
  rgb: readonly [number, number, number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const c = size * 0.5;
  const r = size * 0.28;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      if (dx * dx + dy * dy <= r * r) {
        const i = (x + y * size) * 4;
        rgba[i] = rgb[0];
        rgba[i + 1] = rgb[1];
        rgba[i + 2] = rgb[2];
        rgba[i + 3] = 255;
      }
    }
  }
  return premultipliedIconPixels(rgba);
}

function makeFullSquareRgba(
  size: number,
  rgb: readonly [number, number, number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (x + y * size) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
    }
  }
  return premultipliedIconPixels(rgba);
}

describe('brand icon rendering engine', () => {
  it('decodes bit-exact LUT tables with expected cardinalities and boundaries', () => {
    expect(ICON_COLOR_TRANSFER_BITS.length).toBe(8192);
    expect(float16Value(ICON_COLOR_TRANSFER_BITS[0]!)).toBe(0);
    expect(float16Value(ICON_COLOR_TRANSFER_BITS[1920]!)).toBe(1);
    expect(float16Value(ICON_COLOR_TRANSFER_BITS[6016]!)).toBe(1);
    expect(Number.isNaN(float16Value(ICON_COLOR_TRANSFER_BITS[8191]!))).toBe(true);
    expect(iconSRGBTransfer(1, true)).toBe(1);

    expect(SEGMENTATION_CHI2_CDF.length).toBe(4001);
    expect(SEGMENTATION_CHI2_CDF[0]).toBe(0);
    expect(SEGMENTATION_CHI2_CDF[4000]).toBeLessThanOrEqual(1);
    expect(SEGMENTATION_CHI2_CDF[4000]).toBeGreaterThan(0.99);

    expect(ICON_DISTANCE_LUT_BITS.length).toBe(256);
    expect(float16Value(ICON_DISTANCE_LUT_BITS[0]!)).toBeCloseTo(0.4685, 3);
    expect(float16Value(ICON_DISTANCE_LUT_BITS[255]!)).toBeCloseTo(-0.5303, 3);
    expect(ICON_CUBIC_WEIGHTS.length).toBe(1028);
    expect(ICON_CUBIC_WEIGHTS[1027]).toBe(0);
    expect(ICON_DITHER_NOISE_RGB.length).toBe(1024);

    // Ensure padded/unpadded base64 decoder matches Node Buffer byte-for-byte
    for (const sample of ['a', 'ab', 'abc', 'abcd', 'haus-brand-engine']) {
      const b64 = Buffer.from(sample, 'utf8').toString('base64');
      expect(Buffer.from(decodeBase64Bytes(b64))).toEqual(Buffer.from(sample, 'utf8'));
    }
  });

  it('evaluates IEEE-754 float16 arithmetic, FMA, sRGB transfer, and contrast math accurately', () => {
    expect(float16Bits(1)).toBe(0x3c00);
    expect(float16Value(0x3c00)).toBe(1);
    expect(half(0.3)).toBeCloseTo(0.300048828125, 6);
    expect(halfFma(0.5, 0.5, 0.25)).toBe(0.5);

    expect(iconSRGBTransfer(0.5, true)).toBeLessThan(0.25);
    expect(iconSRGBTransfer(0.214, false)).toBeGreaterThan(0.49);

    const blackContrast = iconContrastRatio([0.05, 0.05, 0.05], DARK_BACKGROUND);
    expect(blackContrast).toBeLessThan(2);
    const chosen = chooseDarkIconColor([0.05, 0.05, 0.05], [0.95, 0.95, 0.95], true);
    expect(chosen.success).toBe(true);
    expect(chosen.color[0]!).toBeGreaterThan(0.2);

    const settings = iconContourLightSettings(44, 44, { semantic: false });
    expect(settings.length).toBeGreaterThan(0);
    const hl = iconGlassHighlight(0.25, [0, -1], 0.5, settings[0]!);
    expect(hl[3]).toBeGreaterThan(0);
  });

  it('detects inset vs full-bleed shapes and generates structured foreground/background layers', () => {
    const insetSrc = makeRoundedGlyphRgba(48, [16, 132, 255]);
    const insetShape = detectIconShape(insetSrc, 48, 48);
    expect(
      categorizeIconShape(insetShape.bounds[2], insetShape.bounds[3], insetShape.radius, true),
    ).not.toBe(6);

    const fullSrc = makeFullSquareRgba(48, [40, 120, 210]);
    const fullShape = detectIconShape(fullSrc, 48, 48);
    expect(
      categorizeIconShape(fullShape.bounds[2], fullShape.bounds[3], fullShape.radius, true),
    ).toBe(6);
    expect(standardIconCornerRadius(48, true)).toBeGreaterThan(10);

    const prepared = prepareLegacyIcon(insetSrc, 48, 48, { continuousContour: true });
    expect(prepared.width).toBeGreaterThan(0);
    const layers = generateLegacyIconLayers(insetSrc, 48, 48, { continuousContour: true });
    expect(layers.width).toBeGreaterThan(0);
  });

  it('lightens low-contrast dark logos over dark enclosure fill and renders continuous-corner glass rim', () => {
    const darkGlyph = makeRoundedGlyphRgba(64, [15, 18, 22]);
    const layers = generateLegacyIconLayers(darkGlyph, 64, 64, { continuousContour: true });
    const darkPresented = createLegacyColorPresentation(layers, 64, 64, 'dark');

    // Center pixel of dark glyph must be lightened well above dark charcoal enclosure background
    const centerIdx = (32 + 32 * 64) * 4;
    const centerLuma =
      0.2126 * (darkPresented.rgba[centerIdx] ?? 0) +
      0.7152 * (darkPresented.rgba[centerIdx + 1] ?? 0) +
      0.0722 * (darkPresented.rgba[centerIdx + 2] ?? 0);
    expect(centerLuma).toBeGreaterThan(45);

    const cornerSdf = evaluateEnclosureSdf(-39.5, -39.5, 39.5, 39.5, 20.8);
    expect(cornerSdf.distance).toBeGreaterThan(2);
    const centerSdf = evaluateEnclosureSdf(0, 0, 39.5, 39.5, 20.8);
    expect(centerSdf.distance).toBeLessThan(-10);

    const rimTop = enclosureGlassRim(0.2, -1, 0.5);
    const rimSide = enclosureGlassRim(0.2, 0, 0.5);
    expect(rimTop).not.toBe(rimSide);
    const lit = enclosureRimComposite(0.2, 0.25, 0.3, rimTop, true);
    expect(lit[0]).toBeGreaterThan(0.2);

    const tile = renderEnclosureTileToRgba(darkGlyph, 64, 64, {
      targetSize: 64,
      displaySize: 40,
      appearance: 'dark',
    });
    expect(tile.width).toBe(64);
    expect(tile.height).toBe(64);
    // Extreme corner must be transparent while center of continuous enclosure is opaque
    expect(tile.rgba[3]).toBe(0);
    expect(tile.rgba[(32 + 32 * 64) * 4 + 3]).toBe(255);

    const lightTile = renderEnclosureTileToRgba(makeFullSquareRgba(64, [24, 118, 232]), 64, 64, {
      targetSize: 64,
      displaySize: 40,
      appearance: 'default',
    });
    expect(lightTile.layout).toBe('fill');
    expect(lightTile.rgba[3]).toBe(0);
    expect(lightTile.rgba[(32 + 32 * 64) * 4 + 3]).toBe(255);
  });
});
