/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  hexColorToRgb,
  resolveEffectiveColorPresentation,
  type IconAppearance,
  type ResolvedIconVariation,
} from '../appearance.js';
import { APP_ICON_METRICS, ICON_RENDERING_PARAMETERS } from './parameters.js';
import { iconMipmap2x2 } from './resampling.js';
import { generateLegacyIconLayers, type GeneratedLegacyIconLayers } from './layers.js';
import { createLegacyColorPresentation, createSemanticGlyphPresentation } from './presentation.js';
import {
  clamp01,
  enclosureGlassRim,
  enclosureRimComposite,
  evaluateEnclosureSdf,
  linearToSrgb,
  srgbToLinear,
  type EnclosureSdfSample,
} from './sdf.js';

export { enclosureGlassRim, enclosureRimComposite, evaluateEnclosureSdf, type EnclosureSdfSample };

function evaluateSupersampledCoverage(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  halfExtent: number,
  cornerRadius: number,
): number {
  const centerSdf = evaluateEnclosureSdf(
    x + 0.5 - centerX,
    y + 0.5 - centerY,
    halfExtent,
    halfExtent,
    cornerRadius,
  );
  if (centerSdf.distance <= -1.2) return 1;
  if (centerSdf.distance >= 1.2) return 0;

  let inside = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    const py = y + (sy + 0.5) * 0.25 - centerY;
    for (let sx = 0; sx < 4; sx += 1) {
      const px = x + (sx + 0.5) * 0.25 - centerX;
      if (evaluateEnclosureSdf(px, py, halfExtent, halfExtent, cornerRadius).distance <= 0) {
        inside += 1;
      }
    }
  }
  return inside / 16;
}

/**
 * Masks an opaque Default or Dark body presentation onto the continuous-corner
 * supercircle enclosure using exact 1:1 pixel alignment (zero interior bilinear blur)
 * and 4x4 geometric MSAA along the outer supercircle boundary.
 */
export function maskOpaqueColorPresentation(
  bodyFloatRgba: Float32Array,
  bodySize: number,
  targetSize: number,
  { tileFraction = APP_ICON_METRICS.tileFraction }: { tileFraction?: number } = {},
): Uint8ClampedArray {
  const effectiveTile = bodySize > 0 ? bodySize : Math.round(targetSize * tileFraction);
  const halfExtent = effectiveTile * 0.5;
  const cornerRadius =
    (ICON_RENDERING_PARAMETERS.defaultEnclosureCornerRadius / 1024) * effectiveTile;
  const center = targetSize * 0.5;
  const offset = Math.round((targetSize - bodySize) * 0.5);
  const maxBody = Math.max(0, bodySize - 1);

  const output = new Uint8ClampedArray(targetSize * targetSize * 4);

  for (let y = 0; y < targetSize; y += 1) {
    const by = Math.min(maxBody, Math.max(0, y - offset));
    for (let x = 0; x < targetSize; x += 1) {
      const cov = evaluateSupersampledCoverage(x, y, center, center, halfExtent, cornerRadius);
      if (cov <= 0) continue;

      const bx = Math.min(maxBody, Math.max(0, x - offset));
      const bIdx = (bx + by * bodySize) * 4;
      const idx = (x + y * targetSize) * 4;
      output[idx] = Math.round(clamp01(bodyFloatRgba[bIdx] ?? 0) * 255);
      output[idx + 1] = Math.round(clamp01(bodyFloatRgba[bIdx + 1] ?? 0) * 255);
      output[idx + 2] = Math.round(clamp01(bodyFloatRgba[bIdx + 2] ?? 0) * 255);
      output[idx + 3] = Math.round(clamp01(cov) * 255);
    }
  }

  return output;
}

/**
 * Composites a cached semantic glyph (`clear` or `tinted`) with the exact GNOME
 * Liquid Glass / Tinted backing tile, `macosGlassRim` specular crest, and
 * lighten-first semantic glyph shader (1:1 pixel lookup, 4x4 boundary AA).
 */
export function compositeSemanticPresentation(
  semanticRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  {
    appearance,
    variation,
    tintHex = '#0a84ff',
    tileFraction = APP_ICON_METRICS.tileFraction,
    displaySize = 44,
  }: {
    appearance: 'clear' | 'tinted';
    variation: ResolvedIconVariation;
    tintHex?: string;
    tileFraction?: number;
    displaySize?: number;
  },
): Uint8ClampedArray {
  const isDark = variation === 'dark';
  const [accentR, accentG, accentB] = hexColorToRgb(tintHex);
  const darkTint = ICON_RENDERING_PARAMETERS.mitigatedEnclosureDarkTint;
  const darkClear = ICON_RENDERING_PARAMETERS.mitigatedEnclosureDarkClear;
  const lightClear = ICON_RENDERING_PARAMETERS.mitigatedEnclosureLightClear;

  let plateR: number;
  let plateG: number;
  let plateB: number;
  let plateAlpha: number;
  if (appearance === 'tinted') {
    plateAlpha = 1.0;
    if (isDark) {
      plateR = darkTint.red;
      plateG = darkTint.green;
      plateB = darkTint.blue;
    } else {
      plateR = accentR;
      plateG = accentG;
      plateB = accentB;
    }
  } else if (isDark) {
    plateR = darkClear.red;
    plateG = darkClear.green;
    plateB = darkClear.blue;
    plateAlpha = 0.72;
  } else {
    plateR = lightClear.red;
    plateG = lightClear.green;
    plateB = lightClear.blue;
    plateAlpha = 0.42;
  }

  const side = Math.min(width, height);
  const bodySize = Math.max(16, Math.round((side * tileFraction) / 2) * 2);
  const halfExtent = bodySize * 0.5;
  const cornerRadius = (ICON_RENDERING_PARAMETERS.defaultEnclosureCornerRadius / 1024) * bodySize;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const pixelScale = Math.max(1, side / Math.max(1, displaySize));
  const semMinX = Math.floor((width - bodySize) / 2);
  const semMinY = Math.floor((height - bodySize) / 2);
  const semMaxX = Math.min(width - 1, semMinX + bodySize - 1);
  const semMaxY = Math.min(height - 1, semMinY + bodySize - 1);

  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(semMaxY, Math.max(semMinY, y));
    for (let x = 0; x < width; x += 1) {
      const centerSdf = evaluateEnclosureSdf(
        x + 0.5 - centerX,
        y + 0.5 - centerY,
        halfExtent,
        halfExtent,
        cornerRadius,
      );
      if (centerSdf.distance >= 1.2) continue;

      // Exact 1:1 semantic glyph sample — zero interior bilinear softening.
      const sx = Math.min(semMaxX, Math.max(semMinX, x));
      const semIdx = (sx + sy * width) * 4;
      const semR = (semanticRgba[semIdx] ?? 0) / 255;
      const semG = (semanticRgba[semIdx + 1] ?? 0) / 255;
      const semB = (semanticRgba[semIdx + 2] ?? 0) / 255;
      const semA = (semanticRgba[semIdx + 3] ?? 0) / 255;

      const light = clamp01(semR);
      const dark = clamp01((semA - semG) * 0.3);
      const fgAlpha = clamp01(light + dark * (1 - light));
      let lightR = light;
      let lightG = light;
      let lightB = light;
      if (appearance === 'tinted' && isDark) {
        const content = Math.min(light, semB);
        lightR = accentR * content + (light - content);
        lightG = accentG * content + (light - content);
        lightB = accentB * content + (light - content);
      }
      const fgPremulR = lightR * (1 - dark);
      const fgPremulG = lightG * (1 - dark);
      const fgPremulB = lightB * (1 - dark);

      const isRimOrBoundary = centerSdf.distance > -(pixelScale * 4 + 2);
      if (!isRimOrBoundary) {
        const outA = clamp01(fgAlpha + plateAlpha * (1 - fgAlpha));
        const premulR = clamp01(fgPremulR + plateR * plateAlpha * (1 - fgAlpha));
        const premulG = clamp01(fgPremulG + plateG * plateAlpha * (1 - fgAlpha));
        const premulB = clamp01(fgPremulB + plateB * plateAlpha * (1 - fgAlpha));
        if (outA <= 0) continue;
        const invOutA = outA > 1e-5 ? 1 / outA : 0;
        const idx = (x + y * width) * 4;
        output[idx] = Math.round(clamp01(premulR * invOutA) * 255);
        output[idx + 1] = Math.round(clamp01(premulG * invOutA) * 255);
        output[idx + 2] = Math.round(clamp01(premulB * invOutA) * 255);
        output[idx + 3] = Math.round(outA * 255);
        continue;
      }

      const subFactor = centerSdf.distance > -1.2 ? 4 : 2;
      const subStep = 1 / subFactor;
      const subCount = subFactor * subFactor;
      let linR = 0;
      let linG = 0;
      let linB = 0;
      let sumA = 0;

      for (let subY = 0; subY < subFactor; subY += 1) {
        const py = y + (subY + 0.5) * subStep - centerY;
        for (let subX = 0; subX < subFactor; subX += 1) {
          const px = x + (subX + 0.5) * subStep - centerX;
          const sdf = evaluateEnclosureSdf(px, py, halfExtent, halfExtent, cornerRadius);
          if (sdf.distance > 0) continue;

          const distInsidePts = Math.max(0, -sdf.distance) / pixelScale;
          const rim = enclosureGlassRim(distInsidePts, sdf.normalY, 1 / pixelScale);
          const [bgR, bgG, bgB] = enclosureRimComposite(plateR, plateG, plateB, rim, isDark);
          const bgA = clamp01(plateAlpha + (1 - plateAlpha) * clamp01(rim * 0.65));

          const outA = clamp01(fgAlpha + bgA * (1 - fgAlpha));
          const premulR = clamp01(fgPremulR + bgR * bgA * (1 - fgAlpha));
          const premulG = clamp01(fgPremulG + bgG * bgA * (1 - fgAlpha));
          const premulB = clamp01(fgPremulB + bgB * bgA * (1 - fgAlpha));
          if (outA <= 0) continue;

          const invOutA = outA > 1e-5 ? 1 / outA : 0;
          linR += srgbToLinear(premulR * invOutA) * outA;
          linG += srgbToLinear(premulG * invOutA) * outA;
          linB += srgbToLinear(premulB * invOutA) * outA;
          sumA += outA;
        }
      }

      const avgA = sumA / subCount;
      if (avgA <= 0) continue;
      const idx = (x + y * width) * 4;
      const invA = 1 / sumA;
      output[idx] = Math.round(linearToSrgb(linR * invA) * 255);
      output[idx + 1] = Math.round(linearToSrgb(linG * invA) * 255);
      output[idx + 2] = Math.round(linearToSrgb(linB * invA) * 255);
      output[idx + 3] = Math.round(clamp01(avgA) * 255);
    }
  }

  return output;
}

function downsampleForAnalysis(
  sourceRgba: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  maxAnalysisDim = 512,
): { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } {
  let current: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } = {
    rgba: sourceRgba,
    width: sourceWidth,
    height: sourceHeight,
  };
  while (
    (current.width > maxAnalysisDim || current.height > maxAnalysisDim) &&
    current.width >= 4 &&
    current.height >= 4
  ) {
    current = iconMipmap2x2(current.rgba, current.width, current.height);
  }
  return current;
}

export interface RenderedAllBaseLayers {
  readonly width: number;
  readonly height: number;
  readonly bodySize: number;
  readonly tileFraction: number;
  readonly layout: 'fill' | 'inset';
  readonly segmented: boolean;
  readonly branch: string | null;
  readonly defaultRgba: Uint8ClampedArray;
  readonly darkRgba: Uint8ClampedArray;
  readonly clearSemanticRgba: Uint8Array;
  readonly tintedSemanticRgba: Uint8Array;
}

/**
 * Runs segmentation ONCE per source image and emits all four cacheable base layers:
 * `default`, `dark`, `clear-semantic`, and `tinted-semantic`.
 */
export function renderAllBaseLayers(
  sourceRgba: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  {
    targetSize = 256,
    tileFraction = APP_ICON_METRICS.tileFraction,
  }: { targetSize?: number; tileFraction?: number } = {},
): RenderedAllBaseLayers {
  const analysis = downsampleForAnalysis(sourceRgba, sourceWidth, sourceHeight, 512);
  const layers: GeneratedLegacyIconLayers = generateLegacyIconLayers(
    analysis.rgba,
    analysis.width,
    analysis.height,
    { continuousContour: true },
  );
  const bodySize = Math.max(16, Math.round((targetSize * tileFraction) / 2) * 2);
  const effectiveTileFraction = bodySize / targetSize;

  const defaultBody = createLegacyColorPresentation(layers, bodySize, bodySize, 'default');
  const darkBody = createLegacyColorPresentation(layers, bodySize, bodySize, 'dark');
  const defaultRgba = maskOpaqueColorPresentation(defaultBody.floatRgba, bodySize, targetSize, {
    tileFraction: effectiveTileFraction,
  });
  const darkRgba = maskOpaqueColorPresentation(darkBody.floatRgba, bodySize, targetSize, {
    tileFraction: effectiveTileFraction,
  });

  const clearSemantic = createSemanticGlyphPresentation(layers, targetSize, 'clear', {
    tileFraction: effectiveTileFraction,
  });
  const tintedSemantic =
    layers.segmented && layers.highlightMask && layers.highlightMask !== layers.foreground
      ? createSemanticGlyphPresentation(layers, targetSize, 'tinted', {
          tileFraction: effectiveTileFraction,
        })
      : clearSemantic;

  return {
    width: targetSize,
    height: targetSize,
    bodySize,
    tileFraction: effectiveTileFraction,
    layout: layers.kind === 'scale-down' ? 'inset' : 'fill',
    segmented: layers.segmented,
    branch: layers.branch ?? null,
    defaultRgba,
    darkRgba,
    clearSemanticRgba: clearSemantic.rgba,
    tintedSemanticRgba: tintedSemantic.rgba,
  };
}

/**
 * End-to-end single-variant rasterizer supporting all 4 GNOME appearances
 * (`default`, `dark`, `clear`, `tinted`) × `variation` (`light`, `dark`) × `tintHex`.
 */
export function renderEnclosureTileToRgba(
  sourceRgba: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  {
    targetSize = 256,
    displaySize = 44,
    appearance = 'default',
    variation = 'light',
    tintHex = '#0a84ff',
  }: {
    targetSize?: number;
    displaySize?: number;
    appearance?: IconAppearance;
    variation?: ResolvedIconVariation;
    tintHex?: string;
  } = {},
): { rgba: Uint8ClampedArray; width: number; height: number; layout: 'fill' | 'inset' } {
  const analysis = downsampleForAnalysis(sourceRgba, sourceWidth, sourceHeight, 512);
  const layers = generateLegacyIconLayers(analysis.rgba, analysis.width, analysis.height, {
    continuousContour: true,
  });
  const bodySize = Math.max(16, Math.round((targetSize * APP_ICON_METRICS.tileFraction) / 2) * 2);
  const effectiveTileFraction = bodySize / targetSize;

  if (appearance === 'default' || appearance === 'dark') {
    const effective = resolveEffectiveColorPresentation(appearance, variation);
    const presented = createLegacyColorPresentation(layers, bodySize, bodySize, effective);
    const rgba = maskOpaqueColorPresentation(presented.floatRgba, bodySize, targetSize, {
      tileFraction: effectiveTileFraction,
    });
    return {
      rgba,
      width: targetSize,
      height: targetSize,
      layout: layers.kind === 'scale-down' ? 'inset' : 'fill',
    };
  }

  const semantic = createSemanticGlyphPresentation(layers, targetSize, appearance, {
    tileFraction: effectiveTileFraction,
  });
  const rgba = compositeSemanticPresentation(semantic.rgba, targetSize, targetSize, {
    appearance,
    variation,
    tintHex,
    tileFraction: effectiveTileFraction,
    displaySize,
  });
  return {
    rgba,
    width: targetSize,
    height: targetSize,
    layout: layers.kind === 'scale-down' ? 'inset' : 'fill',
  };
}
