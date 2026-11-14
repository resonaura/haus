/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { pixelColor, premultipliedIconPixels, type TaggedPixels } from './math';
import { foregroundMask, representativeColorSamples, segmentationFlags } from './segmentation';
import {
  categorizeIconShape,
  cropIconPixels,
  detectIconShape,
  outpaintIconCorners,
  removeIconShadow,
  standardIconCornerRadius,
  type DetectedIconShape,
} from './shape';
import {
  colorClusters,
  colorCovariance,
  colorDistance,
  dot3,
  extendColorConfidence,
  grayscaleConversion,
  meanColor,
  shadowSegmentation,
} from './generation-helpers';
import { multipleForegroundSolidLayers } from './solid-layers';
import {
  gradientForegroundSolidLayers,
  periodicForeground,
  rgbHSV,
  singleForegroundGradientClassification,
  singleForegroundGradientLayers,
} from './gradient-layers';

const f = Math.fround;

export function generateForegroundLayers(
  rgba: TaggedPixels,
  width: number,
  height: number,
  { generateHighlightMask = true }: { generateHighlightMask?: boolean } = {},
) {
  const attempts: Array<{ strict: boolean; reason: string }> = [];
  for (const strict of [true, false]) {
    const segmented = foregroundMask(rgba, width, height, strict);
    if (!segmented.success || !segmented.mask) {
      attempts.push({ strict, reason: 'foreground-mask' });
      continue;
    }
    const flags = segmentationFlags(rgba, segmented.mask, width, height);
    if (periodicForeground(flags, width, height)) {
      attempts.push({ strict, reason: 'periodic-foreground' });
      continue;
    }
    const samples = representativeColorSamples(rgba, flags, width, height);
    if (samples.foreground.length < 10 || samples.background.length < 10) {
      attempts.push({ strict, reason: 'too-few-color-samples' });
      continue;
    }
    const foregroundMean = meanColor(samples.foreground);
    const background = meanColor(samples.background);
    const foregroundCovariance = colorCovariance(samples.foreground, foregroundMean);
    const backgroundCovariance = colorCovariance(samples.background, background);
    const trace = (cov: Float32Array) => f(f((cov[0] ?? 0) + (cov[4] ?? 0)) + (cov[8] ?? 0));
    const foregroundSolid = trace(foregroundCovariance) <= 0.0004;
    const backgroundSolid = trace(backgroundCovariance) <= 0.0004;
    if (!backgroundSolid) {
      if (!foregroundSolid) {
        attempts.push({ strict, reason: 'both-foreground-and-background-complex' });
        continue;
      }
      const classification = singleForegroundGradientClassification(
        rgba,
        width,
        height,
        flags,
        foregroundMean,
        samples.background,
      );
      if (!classification.success) {
        attempts.push({ strict, reason: classification.reason });
        continue;
      }
      return {
        ...singleForegroundGradientLayers(rgba, foregroundMean, samples.background),
        success: true as const,
        strict,
        branch: 'single-gradient' as const,
        bilinear: classification.bilinear,
        attempts,
        backgroundColor: background,
        foregroundColor: foregroundMean,
      };
    }
    if (foregroundSolid) {
      const result = multipleForegroundSolidLayers(
        rgba,
        width,
        height,
        [foregroundMean],
        background,
        flags,
        [0, 0, 0],
        { generateHighlightMask },
      );
      if (result.success) {
        return {
          ...result,
          strict,
          branch: 'single-solid' as const,
          attempts,
          backgroundColor: background,
          foregroundColor: foregroundMean,
        };
      }
      attempts.push({ strict, reason: result.reason });
      continue;
    }
    const shadow = shadowSegmentation(rgba, width, height, flags, background);
    const hsv = rgbHSV(background);
    const contrastThreshold =
      hsv.value < 0.5 ? f(27 / 255) : hsv.saturation < 0.5 ? f(37 / 255) : f(25 / 255);
    const grayscale = grayscaleConversion(samples.foreground);
    if (shadow.minimum >= 0.92) {
      const palette = colorClusters(samples.foreground);
      const covariances = palette.colors.map((mean, k) =>
        colorCovariance(
          samples.foreground.filter((_, i) => palette.labels[i] === k),
          mean,
        ),
      );
      if (
        palette.clusters > 0 &&
        palette.noise < Math.floor(samples.foreground.length / 10) &&
        palette.colors.every((color) => colorDistance(color, background) >= contrastThreshold) &&
        covariances.every((value) => trace(value) <= 0.0004)
      ) {
        if (palette.clusters > 1) extendColorConfidence(flags, width, height);
        const result = multipleForegroundSolidLayers(
          rgba,
          width,
          height,
          palette.colors,
          background,
          flags,
          grayscale,
          { generateHighlightMask },
        );
        if (result.success) {
          return {
            ...result,
            strict,
            branch: 'multiple-solid' as const,
            colors: palette.colors,
            attempts,
            backgroundColor: background,
            foregroundColor: foregroundMean,
          };
        }
        attempts.push({ strict, reason: result.reason });
        continue;
      }
      extendColorConfidence(flags, width, height, false);
      extendColorConfidence(flags, width, height, true);
    } else {
      attempts.push({ strict, reason: 'gradient-shadow-classification' });
      continue;
    }
    const getColor = (x: number, y: number) => pixelColor(rgba, x + y * width);
    const additional = new Uint8Array(flags.length);
    let minDistance = 3.4028234663852886e38;
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const i = x + y * width;
        const color = getColor(x, y);
        if (!((flags[i] ?? 0) & 1)) continue;
        if ((flags[i] ?? 0) & 4)
          minDistance = Math.min(minDistance, colorDistance(color, background));
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
            if (colorDistance(color, getColor(xx, yy)) > 50 / 255) additional[i] = 1;
          }
        }
      }
    }
    if (minDistance < contrastThreshold) {
      attempts.push({ strict, reason: 'insufficient-foreground-contrast' });
      continue;
    }
    let curved = 0;
    for (let x = 1; x < width - 1; x += 1) {
      for (let y = 1; y < height - 1; y += 1) {
        const i = x + y * width;
        if (
          [i, i - 1, i + 1, i - width, i + width].some(
            (j) => ((flags[j] ?? 0) & 3) !== 3 || ((additional[j] ?? 0) & 1) !== 0,
          )
        ) {
          continue;
        }
        const color = getColor(x, y);
        const left = getColor(x - 1, y);
        const right = getColor(x + 1, y);
        const up = getColor(x, y - 1);
        const down = getColor(x, y + 1);
        const horizontal = color.map((v, c) => f(v * -2 + f((left[c] ?? 0) + (right[c] ?? 0))));
        const vertical = color.map((v, c) => f(v * -2 + f((up[c] ?? 0) + (down[c] ?? 0))));
        if (
          f(f(dot3(horizontal, horizontal) + dot3(vertical, vertical)) * 0.25) >
          f(0.0027450979687273502)
        ) {
          curved += 1;
        }
      }
    }
    if (curved > Math.floor((width * height) / 2000)) {
      attempts.push({ strict, reason: 'non-continuous-foreground' });
      continue;
    }
    const result = gradientForegroundSolidLayers(rgba, width, height, background, flags, grayscale);
    if (result.success) {
      return {
        ...result,
        strict,
        branch: 'gradient-solid' as const,
        attempts,
        backgroundColor: background,
        foregroundColor: foregroundMean,
      };
    }
    attempts.push({ strict, reason: result.reason });
  }
  return { success: false as const, attempts };
}

export interface PreparedLegacyIcon {
  rgba: TaggedPixels;
  width: number;
  height: number;
  kind: 'scale-down' | 'fill' | 'segment';
  scale: number;
  shape: DetectedIconShape;
  category: number;
  shadowRemoved?: boolean;
  shadowReason?: string;
  outpainted?: boolean;
}

export function prepareLegacyIcon(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  { continuousContour = true }: { continuousContour?: boolean } = {},
): PreparedLegacyIcon {
  const shape = detectIconShape(rgba, width, height);
  const category = categorizeIconShape(
    shape.bounds[2],
    shape.bounds[3],
    shape.radius,
    continuousContour,
  );
  if (!shape.detected) {
    const shadow = removeIconShadow(rgba, width, height);
    return {
      rgba: shadow.success
        ? premultipliedIconPixels(Uint8ClampedArray.from(shadow.rgba))
        : premultipliedIconPixels(Uint8ClampedArray.from(rgba)),
      width,
      height,
      kind: 'scale-down',
      scale: continuousContour ? 0.84 : 0.875,
      shape,
      category,
      shadowRemoved: shadow.success,
      shadowReason: shadow.success ? undefined : shadow.reason,
    };
  }
  const [x, y, w, h] = shape.bounds;
  if (!x && !y && w === width && h === height && !shape.radius) {
    return {
      rgba: premultipliedIconPixels(Uint8ClampedArray.from(rgba)),
      width,
      height,
      kind: 'fill',
      scale: 1,
      shape,
      category,
    };
  }
  if (category === 2 || category === 3 || category === 4) {
    const size = Math.min(w, h);
    const crop = cropIconPixels(rgba, width, height, [
      x + Math.trunc((w - size) / 2),
      y + Math.trunc((h - size) / 2),
      size,
      size,
    ]);
    let extended = crop.rgba;
    if (category === 2) {
      extended = outpaintIconCorners(
        extended,
        size,
        size,
        shape.radius,
        Math.ceil(Math.fround(standardIconCornerRadius(size, continuousContour))),
      );
    }
    return {
      rgba: premultipliedIconPixels(new Uint8ClampedArray(extended)),
      width: size,
      height: size,
      kind: 'segment',
      scale: 1,
      shape,
      category,
      outpainted: category === 2,
    };
  }
  const crop = cropIconPixels(rgba, width, height, shape.bounds);
  const croppedCategory = categorizeIconShape(
    crop.width,
    crop.height,
    shape.radius,
    continuousContour,
  );
  return {
    ...crop,
    rgba: premultipliedIconPixels(Uint8ClampedArray.from(crop.rgba)),
    kind: 'scale-down',
    scale:
      croppedCategory === 0 ? (continuousContour ? 0.73 : 0.75) : continuousContour ? 0.68 : 0.7,
    shape,
    category,
    shadowRemoved: false,
  };
}

export type GeneratedLegacyIconLayers = PreparedLegacyIcon & {
  segmented: boolean;
  branch?: 'single-gradient' | 'single-solid' | 'multiple-solid' | 'gradient-solid';
  foreground?: Uint8Array;
  highlightMask?: Uint8Array;
  foregroundColor?: readonly [number, number, number];
  backgroundColor?: readonly [number, number, number];
};

export function generateLegacyIconLayers(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: { continuousContour?: boolean } = {},
): GeneratedLegacyIconLayers {
  const prepared = prepareLegacyIcon(rgba, width, height, options);
  if (prepared.kind !== 'segment') return { ...prepared, segmented: false };
  const layers = generateForegroundLayers(prepared.rgba, prepared.width, prepared.height);
  if (!layers.success) return { ...prepared, segmented: false };
  return {
    ...prepared,
    segmented: true,
    branch: layers.branch,
    foreground: layers.foreground,
    highlightMask: layers.highlightMask,
    foregroundColor: layers.foregroundColor,
    backgroundColor: layers.backgroundColor,
  };
}
