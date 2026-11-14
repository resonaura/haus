/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { float16Bits, float16Value, half, halfFma } from './math';
import {
  DARK_BACKGROUND,
  chooseDarkIconColor,
  createIconMonochromeRaster,
  iconContrastRatio,
  iconGlyphTranslucencyStops,
  iconSmoothGradientCoefficients,
  lightenIconColorOverDarkBackground,
  premultiplyIconGradientStops,
  sampleIconSmoothGradient,
} from './color';
import { createIconMip, resampleIconCubic, resampleIconRectilinear } from './resampling';
import { createIconContourField, renderIconContourLights, type ContourField } from './contour';
import { createIconGlyphShadow } from './shadow';
import { ICON_RENDERING_PARAMETERS } from './parameters';
import type { GeneratedLegacyIconLayers } from './layers';

const coverageMix = (destination: number, blended: number, coverage: number) =>
  halfFma(blended, coverage, halfFma(-coverage, destination, destination));

export function fitIconSource(
  source: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number },
  width: number,
  height: number,
  scale = 1,
): { rgba: Uint8Array; width: number; height: number } {
  const side = Math.max(source.width, source.height);
  const w = Math.max(1, Math.round(((width * source.width) / side) * scale));
  const h = Math.max(1, Math.round(((height * source.height) / side) * scale));
  const resized = resampleIconRectilinear(source.rgba, source.width, source.height, w, h);
  const rgba = new Uint8Array(width * height * 4);
  const left = Math.floor((width - w) / 2);
  const top = Math.floor((height - h) / 2);
  for (let y = 0; y < h; y += 1) {
    rgba.set(resized.rgba.subarray(y * w * 4, (y + 1) * w * 4), ((y + top) * width + left) * 4);
  }
  return { rgba, width, height };
}

export function createClearGlyphBase(
  monochrome: Uint8Array,
  shadow: Uint8Array,
  width: number,
  height: number,
  {
    translucency = 0.3,
    shadowOpacity = 0.1875,
    contentLightening = ICON_RENDERING_PARAMETERS.clearMode.contentLighteningStrength,
  }: { translucency?: number; shadowOpacity?: number; contentLightening?: number } = {},
): Uint16Array {
  if (monochrome.length !== width * height * 2 || shadow.length !== width * height) {
    throw new Error('Invalid clear glyph surface dimensions');
  }
  const gradient = iconSmoothGradientCoefficients(
    premultiplyIconGradientStops(iconGlyphTranslucencyStops(translucency)),
  );
  const output = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const coverage = sampleIconSmoothGradient(gradient, Math.fround((y + 0.5) / height))[3];
    for (let x = 0; x < width; x += 1) {
      const i = x + y * width;
      const source = half(half((monochrome[i * 2] ?? 0) / 255) * half(contentLightening));
      const alpha = half((monochrome[i * 2 + 1] ?? 0) / 255);
      const background = half(1 - half(half((shadow[i] ?? 0) / 255) * half(shadowOpacity)));
      const green = halfFma(background, half(1 - alpha), alpha);
      output[i * 4] = float16Bits(half(source * coverage));
      output[i * 4 + 1] = float16Bits(coverageMix(background, green, coverage));
      output[i * 4 + 3] = 0x3c00;
    }
  }
  return output;
}

export function applyClearGlyphShadowOverdraw(
  base: Uint16Array,
  monochrome: Uint8Array,
  shadow: Uint8Array,
  width: number,
  height: number,
  {
    translucency = 0.3,
    shadowOpacity = 0.1875,
    overdrawOpacity = 0.2,
  }: { translucency?: number; shadowOpacity?: number; overdrawOpacity?: number } = {},
): Uint16Array {
  if (
    base.length !== width * height * 4 ||
    monochrome.length !== width * height * 2 ||
    shadow.length !== width * height
  ) {
    throw new Error('Invalid clear shadow surface dimensions');
  }
  const gradient = iconSmoothGradientCoefficients(
    premultiplyIconGradientStops(iconGlyphTranslucencyStops(translucency)),
  );
  const output = Uint16Array.from(base);
  for (let y = 0; y < height; y += 1) {
    const translucencyAlpha = sampleIconSmoothGradient(
      gradient,
      Math.fround((y + 0.5) / height),
    )[3];
    for (let x = 0; x < width; x += 1) {
      const i = x + y * width;
      const coverage = half(
        half(half((monochrome[i * 2 + 1] ?? 0) / 255) * half(overdrawOpacity)) * translucencyAlpha,
      );
      const sourceAlpha = half(half((shadow[i] ?? 0) / 255) * half(shadowOpacity));
      for (let c = 0; c < 3; c += 1) {
        const destination = float16Value(base[i * 4 + c] ?? 0);
        const blended = half(destination * half(1 - sourceAlpha));
        output[i * 4 + c] = float16Bits(coverageMix(destination, blended, coverage));
      }
    }
  }
  return output;
}

export function applyClearGlyphContourLights(
  base: Uint16Array,
  contour: ContourField,
  { origin = [0, 0] as readonly [number, number] }: { origin?: readonly [number, number] } = {},
): Uint16Array {
  const count = (contour.width - 2) * (contour.height - 2);
  if (base.length !== count * 4) throw new Error('Invalid clear contour surface dimensions');
  const output = Uint16Array.from(base);
  for (const light of renderIconContourLights(contour, { origin, applyOpacity: true })) {
    for (let i = 0; i < count; i += 1) {
      const alpha = float16Value(light.pixels[i * 4 + 3] ?? 0);
      for (let c = 0; c < 3; c += 1) {
        const source = float16Value(light.pixels[i * 4 + c] ?? 0);
        const destination = float16Value(output[i * 4 + c] ?? 0);
        const value =
          light.settings.blend === 'screen'
            ? halfFma(destination, half(1 - source), source)
            : half(destination * half(source + half(1 - alpha)));
        output[i * 4 + c] = float16Bits(value);
      }
    }
  }
  return output;
}

export function createClearGlyphMaterial(
  source: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number },
  width: number,
  height: number,
  {
    mipLevel = Math.max(
      0,
      Math.ceil(Math.log2(Math.max(source.width / width, source.height / height))) - 1,
    ),
    shadowBounds,
    lightOrigin = [0, 0] as readonly [number, number],
    translucency = 0.3,
    shadowOpacity = 0.1875,
    overdrawOpacity = 0.2,
  }: {
    mipLevel?: number;
    shadowBounds: readonly [number, number, number, number];
    lightOrigin?: readonly [number, number];
    translucency?: number;
    shadowOpacity?: number;
    overdrawOpacity?: number;
  },
) {
  const mip = createIconMip(source.rgba, source.width, source.height, mipLevel);
  const raster = resampleIconCubic(mip.rgba, mip.width, mip.height, width, height);
  const contour = createIconContourField(raster, width, height);
  const shadow = createIconGlyphShadow(mip, contour, { bounds: shadowBounds });
  const monochrome = createIconMonochromeRaster(raster, width, height);
  const settings = { translucency, shadowOpacity, overdrawOpacity };
  const base = createClearGlyphBase(monochrome, shadow.alpha, width, height, settings);
  const shadowed = applyClearGlyphShadowOverdraw(
    base,
    monochrome,
    shadow.alpha,
    width,
    height,
    settings,
  );
  const pixels = applyClearGlyphContourLights(shadowed, contour, { origin: lightOrigin });
  return { pixels, width, height, mip, raster, contour, shadow, monochrome, base, shadowed };
}

function adjustLowContrastUnsegmentedForeground(
  source: Uint8Array | Uint8ClampedArray,
): Uint8Array {
  let weight = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3] ?? 0;
    if (alpha < 24) continue;
    const a = alpha / 255;
    weight += a;
    rSum += (source[i] ?? 0) / 255;
    gSum += (source[i + 1] ?? 0) / 255;
    bSum += (source[i + 2] ?? 0) / 255;
  }
  if (weight <= 0) return Uint8Array.from(source);
  const meanRgb = [rSum / weight, gSum / weight, bSum / weight];
  if (iconContrastRatio(meanRgb, DARK_BACKGROUND) >= 2.8) return Uint8Array.from(source);
  const output = new Uint8Array(source.length);
  const cache = new Map<string, number[]>();
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3] ?? 0;
    if (!alpha) continue;
    const straight = [
      (source[i] ?? 0) / alpha,
      (source[i + 1] ?? 0) / alpha,
      (source[i + 2] ?? 0) / alpha,
    ];
    const key = straight.map((c) => Math.round(c * 255)).join(':');
    let adjusted = cache.get(key);
    if (!adjusted) {
      adjusted = lightenIconColorOverDarkBackground(straight).color;
      cache.set(key, adjusted);
    }
    output[i] = Math.round((adjusted[0] ?? 0) * alpha);
    output[i + 1] = Math.round((adjusted[1] ?? 0) * alpha);
    output[i + 2] = Math.round((adjusted[2] ?? 0) * alpha);
    output[i + 3] = alpha;
  }
  return output;
}

export function createLegacyColorPresentation(
  generated: GeneratedLegacyIconLayers,
  width: number,
  height: number,
  appearance: 'default' | 'dark' = 'default',
) {
  let source: Uint8Array | Uint8ClampedArray = generated.rgba;
  let darkGenerated = false;
  if (
    appearance === 'dark' &&
    generated.segmented &&
    generated.foreground &&
    generated.foregroundColor &&
    generated.backgroundColor
  ) {
    const selected = chooseDarkIconColor(generated.foregroundColor, generated.backgroundColor);
    if (selected.success) {
      darkGenerated = true;
      const adjusted = new Uint8Array(generated.foreground.length);
      const colors = new Map<string, number[]>();
      for (let i = 0; i < adjusted.length; i += 4) {
        const alpha = generated.foreground[i + 3] ?? 0;
        if (!alpha) continue;
        const straight = [
          (generated.foreground[i] ?? 0) / alpha,
          (generated.foreground[i + 1] ?? 0) / alpha,
          (generated.foreground[i + 2] ?? 0) / alpha,
        ];
        const key = straight.map((c) => Math.round(c * 255)).join(':');
        let color = colors.get(key);
        if (!color) {
          color = generated.branch?.startsWith('single-')
            ? selected.color
            : lightenIconColorOverDarkBackground(straight).color;
          colors.set(key, color);
        }
        adjusted[i] = Math.round((color[0] ?? 0) * alpha);
        adjusted[i + 1] = Math.round((color[1] ?? 0) * alpha);
        adjusted[i + 2] = Math.round((color[2] ?? 0) * alpha);
        adjusted[i + 3] = alpha;
      }
      source = adjusted;
    }
  } else if (appearance === 'dark' && generated.kind !== 'fill') {
    source = adjustLowContrastUnsegmentedForeground(source);
  }

  const fitted = fitIconSource(
    { rgba: source, width: generated.width, height: generated.height },
    width,
    height,
    generated.scale,
  );
  const raster = resampleIconCubic(fitted.rgba, width, height, width, height);
  const contour = createIconContourField(raster, width, height);
  const gradient =
    ICON_RENDERING_PARAMETERS.fills[
      appearance === 'dark' ? 'systemDarkGradient' : 'systemLightGradient'
    ].stops;
  const composed = new Float32Array(raster.length);
  const stop0 = gradient[0]!.color;
  const stop1 = gradient[1]!.color;
  for (let y = 0; y < height; y += 1) {
    const t = (y + 0.5) / height;
    const bgR = stop0.red * (1 - t) + stop1.red * t;
    const bgG = stop0.green * (1 - t) + stop1.green * t;
    const bgB = stop0.blue * (1 - t) + stop1.blue * t;
    for (let x = 0; x < width; x += 1) {
      const i = (x + y * width) * 4;
      const alpha = float16Value(raster[i + 3] ?? 0);
      composed[i] = half(float16Value(raster[i] ?? 0) + bgR * (1 - alpha));
      composed[i + 1] = half(float16Value(raster[i + 1] ?? 0) + bgG * (1 - alpha));
      composed[i + 2] = half(float16Value(raster[i + 2] ?? 0) + bgB * (1 - alpha));
      composed[i + 3] = 1;
    }
  }
  for (const light of renderIconContourLights(contour, { semantic: false, applyOpacity: true })) {
    for (let i = 0; i < composed.length; i += 4) {
      const isPlusLighter = light.settings.blend === 'plus-lighter';
      const darkDelta = -float16Value(light.pixels[i + 3] ?? 0);
      for (let c = 0; c < 3; c += 1) {
        const delta = isPlusLighter ? float16Value(light.pixels[i + c] ?? 0) : darkDelta;
        composed[i + c] = half(Math.max(0, Math.min(1, (composed[i + c] ?? 0) + delta)));
      }
    }
  }
  const rgba = Uint8Array.from(composed, (value) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255),
  );
  return {
    rgba,
    width,
    height,
    darkGenerated,
    opaque: true,
    lighting: 'six-contour-passes' as const,
  };
}
