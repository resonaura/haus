/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { float16Bits, float16Value, half, halfFma, halfMix, saturate } from './math';
import {
  generateIconDistanceField,
  nativeIconDistanceSettings,
  packIconDistanceField,
} from './distance';
import { ICON_RENDERING_PARAMETERS, type IconSizeClass } from './parameters';

const f = Math.fround;

export interface HighlightPassSettings {
  name: string;
  heightParameter: number;
  inset: number;
  spread: number;
  biasAmount: number;
  curvature: number;
  lightDirection: readonly [number, number];
  color: readonly [number, number, number, number];
  opacity: number;
  blend: string;
  sdfScale: number;
  sdfZero: number;
}

export interface ContourField {
  width: number;
  height: number;
  pixelFormat: 'rgb10a2' | 'rgba16float';
  pixels: Uint16Array | Uint32Array;
  sdfScale: number;
  sdfZero: number;
}

export interface RenderedContourLight {
  settings: HighlightPassSettings;
  pixels: Uint16Array;
  opacityApplied: boolean;
}

/** Evaluates one pixel of the half-precision contour-lighting shader. */
export function iconGlassHighlight(
  distanceInput: number,
  normal: readonly [number, number],
  derivativeWidth: number,
  settings: Pick<
    HighlightPassSettings,
    'heightParameter' | 'spread' | 'biasAmount' | 'curvature' | 'lightDirection' | 'color'
  >,
  { fragmentOpacity = 1 }: { fragmentOpacity?: number } = {},
): [number, number, number, number] {
  const height = f(settings.heightParameter);
  const spread = f(settings.spread);
  const bias = f(settings.biasAmount);
  const distance = half(distanceInput);
  const normalizedDistance = half(saturate(f(distance / height)));
  const aa = half(half(Math.min(2, Math.max(2 ** -10, half(derivativeWidth)))) * 0.8330078125);
  let curve = half(half(half(height) - 1) * 0.5);
  curve = saturate(curve);
  const amount = half(half(curve * curve) * half(settings.curvature));
  const curvature = half(amount * half(3 - half(curve * 2)));
  const intensity = halfMix(1, half(1 - normalizedDistance), curvature);
  const end = half(saturate(f(f(f(height - distance) / aa) + 0.5)));
  const start = half(saturate(half(half(distance / aa) + 0.5)));
  const coverage = half(start * end);
  const lx = half(settings.lightDirection[0]);
  const ly = half(settings.lightDirection[1]);
  const dot = halfFma(ly, half(normal[1]), half(lx * half(normal[0])));
  const denominator = half(Math.max(half(1 - half(spread)), 2 ** -10));
  const angular = half(f(saturate(f(f(dot - spread) / denominator)) * intensity));
  const biased = half(Math.max(half(f(f(1 - angular) * bias) + 1), 2 ** -10));
  const alpha = half(half(half(coverage * angular) * half(fragmentOpacity)) / biased);
  return [
    half(alpha * half(settings.color[0])),
    half(alpha * half(settings.color[1])),
    half(alpha * half(settings.color[2])),
    half(alpha * half(settings.color[3])),
  ];
}

/** Evaluates contour highlight across a pixel-addressed SDF + normal texture. */
export function renderIconGlassHighlight(
  sdf: Float32Array,
  width: number,
  height: number,
  settings: HighlightPassSettings,
  {
    quadOrigin = [0, 0] as readonly [number, number],
    fragmentOpacity = 1,
  }: { quadOrigin?: readonly [number, number]; fragmentOpacity?: number } = {},
): Uint16Array {
  const distance = new Float32Array(width * height);
  const normals: Array<[number, number]> = Array.from(
    { length: width * height },
    (): [number, number] => [0, 0],
  );
  for (let i = 0; i < distance.length; i += 1) {
    distance[i] = half(
      f(f(f(settings.sdfZero) - half(sdf[i * 4] ?? 0)) * f(settings.sdfScale)) - f(settings.inset),
    );
    normals[i] = [
      half(1 - half(half(sdf[i * 4 + 1] ?? 0) * 2)),
      half(1 - half(half(sdf[i * 4 + 2] ?? 0) * 2)),
    ];
  }
  const output = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = x + y * width;
      const x0 = ((x + quadOrigin[0]) & ~1) - quadOrigin[0];
      const y0 = ((y + quadOrigin[1]) & ~1) - quadOrigin[1];
      const dx = half(
        (distance[Math.min(width - 1, x0 + 1) + y * width] ?? 0) -
          (distance[Math.max(0, x0) + y * width] ?? 0),
      );
      const dy = half(
        (distance[x + Math.min(height - 1, y0 + 1) * width] ?? 0) -
          (distance[x + Math.max(0, y0) * width] ?? 0),
      );
      const derivative = half(Math.abs(dx) + Math.abs(dy));
      const color = iconGlassHighlight(distance[i] ?? 0, normals[i]!, derivative, settings, {
        fragmentOpacity,
      });
      for (let c = 0; c < 4; c += 1) output[i * 4 + c] = float16Bits(color[c] ?? 0);
    }
  }
  return output;
}

export interface ShapeAwareMaskSettings {
  sdfZero: number;
  sdfScale: number;
  borderWidth: number;
  opaqueEnd: readonly [number, number];
  lightDirection: readonly [number, number];
  length: number;
  minOpacity: number;
}

export function iconShapeAwareGradientMask(
  position: readonly [number, number],
  sdfValue: number,
  settings: ShapeAwareMaskSettings,
): number {
  const distance = half(f(f(f(settings.sdfZero) - half(sdfValue)) * f(settings.sdfScale)));
  const radial = half(saturate(f(distance / f(settings.borderWidth))));
  const d0 = f(f(settings.opaqueEnd[0]) - f(position[0]));
  const d1 = f(f(settings.opaqueEnd[1]) - f(position[1]));
  const dot = f(f(f(settings.lightDirection[0]) * d0) + f(f(settings.lightDirection[1]) * d1));
  const linear = half(saturate(f(dot / f(settings.length))));
  const blended = halfMix(half(1 - linear), linear, radial);
  const opacity = saturate(halfMix(1, half(settings.minOpacity), blended));
  return half(half(opacity * opacity) * half(3 - half(opacity * 2)));
}

export function iconRenderingSizeClass(size: number): IconSizeClass {
  const thresholds = ICON_RENDERING_PARAMETERS.thresholds;
  if (size >= Number(thresholds.minDisplaySize)) return 'display';
  if (size >= Number(thresholds.minLargeSize)) return 'large';
  if (size >= Number(thresholds.minMediumSize)) return 'medium';
  return 'small';
}

export function iconContourLightSettings(
  width: number,
  height: number,
  { semantic = true }: { semantic?: boolean } = {},
): HighlightPassSettings[] {
  const size = Math.min(width, height);
  const sizeClass = iconRenderingSizeClass(size);
  const source = semantic
    ? ICON_RENDERING_PARAMETERS.highlights.glyphsClear
    : ICON_RENDERING_PARAMETERS.highlights.glyphsDefault;
  const scale = size / 1024;
  const buildPass = (
    name: string,
    recipe: {
      bias: number;
      distance: Record<IconSizeClass, number>;
      minDistancePixels: Record<IconSizeClass, number>;
      opacity: Record<IconSizeClass, number>;
      outsetOpacity: Record<IconSizeClass, number> | null;
      spread: Record<IconSizeClass, { readonly radians: number }>;
    },
    direction: readonly [number, number],
    diffuse = false,
    dark = false,
  ): HighlightPassSettings => {
    const heightParameter = Math.fround(
      Math.max(recipe.distance[sizeClass] * scale, recipe.minDistancePixels[sizeClass]),
    );
    return {
      name,
      heightParameter,
      inset: dark ? -heightParameter : 0,
      spread: Math.fround(Math.cos(recipe.spread[sizeClass].radians)),
      biasAmount: Math.fround(1 / recipe.bias - 2),
      curvature: dark
        ? 0
        : diffuse
          ? 1
          : ICON_RENDERING_PARAMETERS.highlights.glyphHighlightCurvature[sizeClass],
      lightDirection: [Math.fround(direction[0]), Math.fround(direction[1])],
      color: semantic ? (dark ? [1, 0, 1, 1] : [1, 0, 0, 1]) : dark ? [0, 0, 0, 1] : [1, 1, 1, 1],
      opacity:
        dark && recipe.outsetOpacity ? recipe.outsetOpacity[sizeClass] : recipe.opacity[sizeClass],
      blend: semantic ? (dark ? 'multiply' : 'screen') : dark ? 'plus-darker' : 'plus-lighter',
      sdfScale: Math.fround(-size * 0.4),
      sdfZero: 0.5,
    };
  };
  return [
    buildPass('key-sharp', source.keySharp, [0, -1]),
    buildPass('fill-sharp', source.fillSharp.custom, [Math.sin(Math.PI), 1]),
    buildPass('key-diffuse', source.keyDiffuse, [0, -1], true),
    buildPass('fill-diffuse', source.keyDiffuse, [Math.sin(Math.PI), 1], true),
    buildPass('right-dark', source.dark, [1, -Math.cos(Math.PI / 2)], false, true),
    buildPass('left-dark', source.dark, [-1, -Math.cos(Math.PI / 2)], false, true),
  ];
}

export function iconContourLayerPixels(
  contour: ContourField,
  { border = 1 }: { border?: number } = {},
): Float32Array {
  const width = contour.width - border * 2;
  const height = contour.height - border * 2;
  const output = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = x + border + (y + border) * contour.width;
      const target = (x + y * width) * 4;
      if (contour.pixelFormat === 'rgb10a2') {
        const pixels = contour.pixels as Uint32Array;
        const word = pixels[source] ?? 0;
        for (let c = 0; c < 3; c += 1)
          output[target + c] = half(((word >>> (c * 10)) & 1023) / 1023);
        output[target + 3] = half((word >>> 30) / 3);
      } else {
        const pixels = contour.pixels as Uint16Array;
        for (let c = 0; c < 4; c += 1)
          output[target + c] = float16Value(pixels[source * 4 + c] ?? 0);
      }
    }
  }
  return output;
}

export function renderIconContourLights(
  contour: ContourField,
  options: { origin?: readonly [number, number]; applyOpacity?: boolean; semantic?: boolean } = {},
): RenderedContourLight[] {
  const width = contour.width - 2;
  const height = contour.height - 2;
  const { origin = [0, 0], applyOpacity = false, semantic = true } = options;
  const input = iconContourLayerPixels(contour, { border: 0 });
  return iconContourLightSettings(width, height, { semantic }).map((settings) => {
    const full = renderIconGlassHighlight(input, contour.width, contour.height, settings, {
      quadOrigin: [origin[0] - 1, origin[1] - 1],
      fragmentOpacity: applyOpacity ? settings.opacity : 1,
    });
    const pixels = new Uint16Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      pixels.set(
        full.subarray(((y + 1) * contour.width + 1) * 4, ((y + 1) * contour.width + 1 + width) * 4),
        y * width * 4,
      );
    }
    return { settings, pixels, opacityApplied: applyOpacity };
  });
}

export function createIconContourField(
  raster: Uint16Array,
  width: number,
  height: number,
  options: Partial<ReturnType<typeof nativeIconDistanceSettings>> = {},
): ContourField {
  const settings = { ...nativeIconDistanceSettings(width, height), ...options };
  const w = width + 2;
  const h = height + 2;
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = float16Value(raster[(x + y * width) * 4 + 3] ?? 0);
      if (settings.pixelFormat === 'rgb10a2') value = half(Math.round(value * 255) / 255);
      alpha[x + 1 + (y + 1) * w] = value;
    }
  }
  const field = generateIconDistanceField(null, w, h, {
    ...settings,
    alpha,
    padding: Math.ceil(Math.fround(settings.maxDistance)),
  });
  return {
    width: w,
    height: h,
    pixelFormat: settings.pixelFormat,
    pixels: settings.pixelFormat === 'rgb10a2' ? packIconDistanceField(field) : field,
    sdfScale: Math.fround(-2 * settings.maxDistance),
    sdfZero: 0.5,
  };
}
