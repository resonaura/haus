/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { float16Value, half, halfFma, saturate } from './math';
import { sampleIconHalfLinear, sampleIconUnormLinear, resampleIconCubic } from './resampling';
import { iconDistanceBlurKernel, type BlurKernelSpec } from './distance';
import { type ContourField } from './contour';
import { ICON_RENDERING_PARAMETERS } from './parameters';

const f = Math.fround;
const roundEven = (value: number) => {
  const low = Math.floor(value);
  return value - low === 0.5 ? low + (low & 1) : Math.round(value);
};
const store8 = (value: number) => roundEven(saturate(value) * 255);

function rectangleCoverage(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number {
  const edge = Math.min(x + 0.5 - left, right - x - 0.5, y + 0.5 - top, bottom - y - 0.5);
  const coverage = half(saturate(edge + 0.5));
  return half(half(coverage * coverage) * halfFma(coverage, -2, 3));
}

export interface ShadowAlphaSurface {
  alpha: Uint8Array;
  width: number;
  height: number;
  bounds: readonly [number, number, number, number];
}

export function createIconShadowBandInput(
  contour: ContourField,
  { offsetPixels = null }: { offsetPixels?: readonly [number, number] | null } = {},
): ShadowAlphaSurface {
  const size = Math.min(contour.width - 2, contour.height - 2);
  const offset =
    offsetPixels ??
    ([
      (ICON_RENDERING_PARAMETERS.shadow.offsetX * size) / 1024,
      (ICON_RENDERING_PARAMETERS.shadow.offsetY * size) / 1024,
    ] as const);
  const left = f(offset[0] - 1);
  const top = f(offset[1] - 1);
  const boundsX = Math.floor(left);
  const boundsY = Math.floor(top);
  const width = Math.ceil(left + contour.width) - boundsX;
  const height = Math.ceil(top + contour.height) - boundsY;
  const localX = f(left - boundsX);
  const localY = f(top - boundsY);
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color =
        contour.pixelFormat === 'rgba16float'
          ? sampleIconHalfLinear(
              {
                width: contour.width,
                height: contour.height,
                pixels: contour.pixels as Uint16Array,
              },
              f(x + 0.5 - localX),
              f(y + 0.5 - localY),
            )
          : sampleIconUnormLinear(
              {
                width: contour.width,
                height: contour.height,
                pixelFormat: 'rgb10a2',
                pixels: contour.pixels as Uint32Array,
              },
              f(x + 0.5 - localX),
              f(y + 0.5 - localY),
            );
      const coverage = rectangleCoverage(
        x,
        y,
        localX + 1,
        localY + 1,
        localX + contour.width - 1,
        localY + contour.height - 1,
      );
      const red = half(store8(half(color[0] * coverage)) / 255);
      const a = half(store8(half(color[3] * coverage)) / 255);
      alpha[x + y * width] = a > float16Value(0x1419) ? store8(half(red / a)) : 0;
    }
  }
  return { alpha, width, height, bounds: [boundsX, boundsY, width, height] };
}

export function createIconShadowBand(
  alpha: Uint8Array,
  width: number,
  height: number,
  {
    scale = 25.6,
    offset = -12.8,
    origin = [0, 0] as readonly [number, number],
  }: { scale?: number; offset?: number; origin?: readonly [number, number] } = {},
): Uint8Array {
  if (alpha.length !== width * height) throw new Error('Invalid shadow band dimensions');
  const nativeScale = f(scale);
  const nativeOffset = f(offset);
  const position = Float32Array.from(alpha, (value) =>
    half(f(half(value / 255) * nativeScale + nativeOffset)),
  );
  const at = (x: number, y: number) =>
    position[Math.max(0, Math.min(width - 1, x)) + Math.max(0, Math.min(height - 1, y)) * width] ??
    0;
  const output = new Uint8Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = ((x + origin[0]) & ~1) - origin[0];
      const y0 = ((y + origin[1]) & ~1) - origin[1];
      const dx = half(at(x0 + 1, y) - at(x0, y));
      const dy = half(at(x, y0 + 1) - at(x, y0));
      const derivative = half(Math.max(half(Math.abs(dx) + Math.abs(dy)), float16Value(0x1419)));
      const inverse = half(1 / derivative);
      const p = at(x, y);
      const start = saturate(halfFma(p, inverse, 0.5));
      const end = saturate(halfFma(half(p - 1), inverse, 0.5));
      output[x + y * width] = roundEven(saturate(halfFma(end, -start, start)) * 255);
    }
  }
  return output;
}

export function clipIconShadowBand(
  source: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number },
  band: ShadowAlphaSurface,
  visibleWidth: number,
  visibleHeight: number,
  {
    offsetPixels = [0, 0] as readonly [number, number],
    bounds,
  }: {
    offsetPixels?: readonly [number, number];
    bounds: readonly [number, number, number, number];
  },
): ShadowAlphaSurface {
  const [left, top, width, height] = bounds;
  const scale: [number, number] = [source.width / visibleWidth, source.height / visibleHeight];
  const imageX = offsetPixels[0] - left;
  const imageY = offsetPixels[1] - top;
  const sampled = resampleIconCubic(source.rgba, source.width, source.height, width, height, {
    sourceScale: scale,
    sourceOffset: [-imageX * scale[0], -imageY * scale[1]],
  });
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coverage = rectangleCoverage(
        x,
        y,
        imageX,
        imageY,
        imageX + visibleWidth,
        imageY + visibleHeight,
      );
      const foreground = half(
        store8(half(float16Value(sampled[(x + y * width) * 4 + 3] ?? 0) * coverage)) / 255,
      );
      const bx = x + left - band.bounds[0];
      const by = y + top - band.bounds[1];
      const mask =
        bx < 0 || by < 0 || bx >= band.width || by >= band.height
          ? 0
          : half((band.alpha[bx + by * band.width] ?? 0) / 255);
      alpha[x + y * width] = store8(half(foreground * mask));
    }
  }
  return { alpha, width, height, bounds };
}

export function blurIconShadowPass(
  input: ShadowAlphaSurface,
  kernel: BlurKernelSpec,
  vertical = false,
): ShadowAlphaSurface {
  const { width, height } = input;
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < input.alpha.length; i += 1) pixels[i * 4 + 3] = input.alpha[i] ?? 0;
  const texture = { width, height, pixelFormat: 'rgba8' as const, pixels };
  const alpha = new Uint8Array(input.alpha.length);
  const count = kernel.shader === 7 ? 8 : kernel.shader === 6 ? 6 : kernel.shader === 5 ? 4 : 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let i = 0; i < count; i += 1) {
        const offset = kernel.offsets[i] ?? 0;
        const weight = kernel.weights[i] ?? 0;
        const dx = vertical ? 0 : offset;
        const dy = vertical ? offset : 0;
        const a = sampleIconUnormLinear(texture, x + 0.5 - dx, y + 0.5 - dy)[3];
        const b = sampleIconUnormLinear(texture, x + 0.5 + dx, y + 0.5 + dy)[3];
        sum = f(a * weight + sum);
        sum = f(b * weight + sum);
      }
      alpha[x + y * width] = store8(half(sum));
    }
  }
  return { ...input, alpha };
}

export function createIconGlyphShadow(
  source: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number },
  contour: ContourField,
  {
    bounds,
    offsetPixels = null,
    radius = null,
  }: {
    bounds: readonly [number, number, number, number];
    offsetPixels?: readonly [number, number] | null;
    radius?: number | null;
  },
) {
  const width = contour.width - 2;
  const height = contour.height - 2;
  const size = Math.min(width, height);
  const offset =
    offsetPixels ??
    ([
      (ICON_RENDERING_PARAMETERS.shadow.offsetX * size) / 1024,
      (ICON_RENDERING_PARAMETERS.shadow.offsetY * size) / 1024,
    ] as const);
  const resolvedRadius =
    radius ??
    f(
      (ICON_RENDERING_PARAMETERS.blurStrengthMax *
        ICON_RENDERING_PARAMETERS.shadow.radius.small *
        size) /
        1024,
    );
  const variance = f(f(resolvedRadius * resolvedRadius) - f(0.001));
  if (variance <= 0) throw new Error('Shadow radius below minimum blur range');
  const kernel = iconDistanceBlurKernel(variance);
  const input = createIconShadowBandInput(contour, { offsetPixels: offset });
  const band: ShadowAlphaSurface = {
    ...input,
    alpha: createIconShadowBand(input.alpha, input.width, input.height),
  };
  const clipped = clipIconShadowBand(source, band, width, height, {
    bounds,
    offsetPixels: offset,
  });
  const horizontal = blurIconShadowPass(clipped, kernel);
  const vertical = blurIconShadowPass(horizontal, kernel, true);
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      alpha[x + y * width] = vertical.alpha[x - bounds[0] + (y - bounds[1]) * vertical.width] ?? 0;
    }
  }
  return { alpha, width, height, input, band, clipped, horizontal, vertical, kernel };
}
