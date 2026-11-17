/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { APP_ICON_METRICS, ENCLOSURE_RIM, ICON_RENDERING_PARAMETERS } from './parameters';
import { iconRenderingSizeClass } from './contour';
import { iconMipmap2x2 } from './resampling';
import { generateLegacyIconLayers } from './layers';
import { createLegacyColorPresentation } from './presentation';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const srgbToLinear = (value: number): number => {
  const c = clamp01(value);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (value: number): number => {
  const c = clamp01(value);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

export interface EnclosureSdfSample {
  distance: number;
  normalX: number;
  normalY: number;
}

/** Analytical continuous-corner supercircle signed distance and radial normal. */
export function evaluateEnclosureSdf(
  pointX: number,
  pointY: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): EnclosureSdfSample {
  const r = Math.max(Math.min(Math.abs(radius), Math.min(halfWidth, halfHeight)), 0.0001);
  const extent = r * 1.5286649465560913;
  const blendX = clamp01((halfWidth / r - 1.52866) / -0.52866);
  const blendY = clamp01((halfHeight / r - 1.52866) / -0.52866);
  const normalExtent = mix(extent, r, Math.max(blendX, blendY));
  const absX = Math.abs(pointX);
  const absY = Math.abs(pointY);
  const cornerX = absX - halfWidth + normalExtent;
  const cornerY = absY - halfHeight + normalExtent;
  const qx = Math.max((absX - halfWidth + extent) / extent, 0);
  const qy = Math.max((absY - halfHeight + extent) / extent, 0);
  const major = Math.max(qx, qy);
  const minor = Math.min(qx, qy);
  const t = major > 0 ? clamp01(minor / major) : 0;
  const polynomial =
    (((3.1560099124908447 - t * 0.9260540008544922) * t - 3.6412200927734375) * t +
      1.268030047416687) *
      t +
    0.2685309946537018;
  const magnitude = Math.hypot(qx, qy);
  const continuous = magnitude + 1 - 1 / (1 - t * t * clamp01(magnitude) * polynomial);
  const circX = Math.max(qx * 1.5286649465560913 - 0.5286650061607361, 0);
  const circY = Math.max(qy * 1.5286649465560913 - 0.5286650061607361, 0);
  const circular = Math.hypot(circX, circY) * 0.6541655659675598 + 0.3458344340324402;
  const orientation = qy > qx ? 1 : -1;
  const weight = clamp01(0.5 - orientation + orientation * t);
  const distX = mix(continuous, circular, blendX);
  const distY = mix(continuous, circular, blendY);
  const distance =
    (mix(distX, distY, weight) - 1) * extent + Math.min(Math.max(cornerX, cornerY), 0);

  let nx = Math.max(cornerX, 0);
  let ny = Math.max(cornerY, 0);
  const normalLen = Math.hypot(nx, ny);
  if (normalLen > 0) {
    nx /= normalLen;
    ny /= normalLen;
  } else if (cornerX > cornerY) {
    nx = 1;
    ny = 0;
  } else {
    nx = 0;
    ny = 1;
  }
  const signX = pointX > 0 ? 1 : pointX < 0 ? -1 : 0;
  const signY = pointY > 0 ? 1 : pointY < 0 ? -1 : 0;
  return { distance, normalX: nx * signX, normalY: ny * signY };
}

function enclosureRimBand(
  distanceInside: number,
  height: number,
  curvature: number,
  angular: number,
  amount: number,
  aaWidth: number,
): number {
  const x = clamp01(distanceInside / height);
  const falloff = mix(x < 1 ? 1 : 0, 1 - x, curvature);
  const coverage =
    clamp01(distanceInside / aaWidth + 0.5) * clamp01((height - distanceInside) / aaWidth + 0.5);
  const a = falloff * coverage * angular;
  const bias = 1 / amount - 2;
  return a / Math.max(1 + bias * (1 - a), 0.0001);
}

/** Dual-opposing specular + diffuse rim highlight intensity along enclosure border. */
export function enclosureGlassRim(
  distanceInside: number,
  outwardNormalY: number,
  aaWidth: number,
): number {
  const facing = Math.abs(outwardNormalY);
  const spread = Math.cos(ENCLOSURE_RIM.spread);
  const diffuseSpread = Math.cos(ENCLOSURE_RIM.spread * ENCLOSURE_RIM.diffuseSpreadScale);
  const angular = clamp01((facing - spread) / (1 - spread));
  const diffuseAngular = clamp01((facing - diffuseSpread) / (1 - diffuseSpread));
  const aa = Math.max(aaWidth, 0.0001);
  return (
    enclosureRimBand(
      distanceInside,
      ENCLOSURE_RIM.height,
      ENCLOSURE_RIM.curvature,
      angular,
      ENCLOSURE_RIM.amount,
      aa,
    ) +
    enclosureRimBand(
      distanceInside,
      ENCLOSURE_RIM.height * ENCLOSURE_RIM.diffuseHeightScale,
      1,
      diffuseAngular,
      ENCLOSURE_RIM.amount * ENCLOSURE_RIM.diffuseAmountScale,
      aa,
    )
  );
}

/** Vibrancy-aware color matrix composite for enclosure glass rim. */
export function enclosureRimComposite(
  r: number,
  g: number,
  b: number,
  intensity: number,
  isDark: boolean,
): [number, number, number] {
  const darkR = r * 1.09375 + g * -0.357666015625 + b * -0.0360107421875 + 0.25;
  const darkG = r * -0.1063232421875 + g * 0.84228515625 + b * -0.036102294921875 + 0.25;
  const darkB = r * -0.10638427734375 + g * -0.357421875 + b * 1.1640625 + 0.25;

  const lightR = r * 1.2626953125 + g * -0.238525390625 + b * -0.0240020751953125 + 0.199951171875;
  const lightG = r * -0.07080078125 + g * 1.0947265625 + b * -0.0240936279296875 + 0.199951171875;
  const lightB = r * -0.0709228515625 + g * -0.23828125 + b * 1.3095703125 + 0.199951171875;

  const t = isDark ? 1 : 0;
  const clampHdr = (v: number) => Math.min(1, Math.max(-0.75, v));
  const rimR = clampHdr(mix(lightR, darkR, t));
  const rimG = clampHdr(mix(lightG, darkG, t));
  const rimB = clampHdr(mix(lightB, darkB, t));
  return [
    clamp01(mix(r, rimR, intensity)),
    clamp01(mix(g, rimG, intensity)),
    clamp01(mix(b, rimB, intensity)),
  ];
}

/** End-to-end CPU rasterizer producing continuous-corner glass enclosure RGBA bytes. */
export function renderEnclosureTileToRgba(
  sourceRgba: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  {
    targetSize = 80,
    displaySize = 40,
    appearance = 'default',
  }: { targetSize?: number; displaySize?: number; appearance?: 'default' | 'dark' } = {},
): { rgba: Uint8ClampedArray; width: number; height: number; layout: 'fill' | 'inset' } {
  const maxAnalysisDim = 256;
  let analysisSource: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } = {
    rgba: sourceRgba,
    width: sourceWidth,
    height: sourceHeight,
  };
  while (
    (analysisSource.width > maxAnalysisDim || analysisSource.height > maxAnalysisDim) &&
    analysisSource.width >= 4 &&
    analysisSource.height >= 4
  ) {
    analysisSource = iconMipmap2x2(
      analysisSource.rgba,
      analysisSource.width,
      analysisSource.height,
    );
  }

  const layers = generateLegacyIconLayers(
    analysisSource.rgba,
    analysisSource.width,
    analysisSource.height,
    { continuousContour: true },
  );
  const superFactor = targetSize <= 128 ? 2 : 1;
  const renderSize = targetSize * superFactor;
  const presented = createLegacyColorPresentation(layers, renderSize, renderSize, appearance, {
    tileFraction: APP_ICON_METRICS.tileFraction,
    referenceSize: displaySize,
    superFactor,
  });

  const isDark = appearance === 'dark';
  const sizeClass = iconRenderingSizeClass(displaySize);
  const subpixelScale = Math.max(1, renderSize / Math.max(1, displaySize));
  const tileSize = renderSize * APP_ICON_METRICS.tileFraction;
  const cornerRadius = (ICON_RENDERING_PARAMETERS.defaultEnclosureCornerRadius / 1024) * tileSize;
  const halfExtent = tileSize * 0.5;
  const center = renderSize * 0.5;
  const edgeAa = superFactor === 2 ? 1.15 : 1.0;
  const outlineWidth = ICON_RENDERING_PARAMETERS.outlines.lineWidth[sizeClass] * subpixelScale;
  const brightOpacity = ICON_RENDERING_PARAMETERS.outlines.lineOpacityOnBright[sizeClass];
  const dimOpacity = ICON_RENDERING_PARAMETERS.outlines.lineOpacityOnDim[sizeClass];

  const evaluateSubpixel = (rx: number, ry: number): readonly [number, number, number, number] => {
    const sdf = evaluateEnclosureSdf(
      rx + 0.5 - center,
      ry + 0.5 - center,
      halfExtent,
      halfExtent,
      cornerRadius,
    );
    const coverage = clamp01(0.5 - sdf.distance / edgeAa);
    if (coverage <= 0) return [0, 0, 0, 0];

    const idx = (rx + ry * renderSize) * 4;
    const distInside = Math.max(0, -sdf.distance);
    const distanceInsidePts = distInside / subpixelScale;
    const rim = enclosureGlassRim(distanceInsidePts, sdf.normalY, 1 / subpixelScale);
    const baseR = presented.floatRgba[idx] ?? 0;
    const baseG = presented.floatRgba[idx + 1] ?? 0;
    const baseB = presented.floatRgba[idx + 2] ?? 0;
    let [r, g, b] = enclosureRimComposite(baseR, baseG, baseB, rim, isDark);

    const outlineCoverage =
      clamp01(-sdf.distance / edgeAa + 0.5) * clamp01((outlineWidth - distInside) / edgeAa + 0.5);
    if (outlineCoverage > 0) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const strokeAlpha = outlineCoverage * mix(dimOpacity, brightOpacity, clamp01(luma));
      const strokeColor = isDark || luma < 0.45 ? 1 : 0;
      r = mix(r, strokeColor, strokeAlpha);
      g = mix(g, strokeColor, strokeAlpha);
      b = mix(b, strokeColor, strokeAlpha);
    }

    return [r, g, b, coverage];
  };

  const output = new Uint8ClampedArray(targetSize * targetSize * 4);
  const subpixelCount = superFactor * superFactor;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const idx = (x + y * targetSize) * 4;
      if (superFactor === 1) {
        const [r, g, b, coverage] = evaluateSubpixel(x, y);
        if (coverage <= 0) continue;
        output[idx] = Math.round(clamp01(r) * 255);
        output[idx + 1] = Math.round(clamp01(g) * 255);
        output[idx + 2] = Math.round(clamp01(b) * 255);
        output[idx + 3] = Math.round(clamp01(coverage) * 255);
        continue;
      }
      let linR = 0;
      let linG = 0;
      let linB = 0;
      let sumA = 0;
      for (let sy = 0; sy < superFactor; sy += 1) {
        for (let sx = 0; sx < superFactor; sx += 1) {
          const [r, g, b, coverage] = evaluateSubpixel(x * superFactor + sx, y * superFactor + sy);
          if (coverage <= 0) continue;
          linR += srgbToLinear(r) * coverage;
          linG += srgbToLinear(g) * coverage;
          linB += srgbToLinear(b) * coverage;
          sumA += coverage;
        }
      }
      const avgA = sumA / subpixelCount;
      if (avgA <= 0) continue;
      const invA = 1 / sumA;
      output[idx] = Math.round(linearToSrgb(linR * invA) * 255);
      output[idx + 1] = Math.round(linearToSrgb(linG * invA) * 255);
      output[idx + 2] = Math.round(linearToSrgb(linB * invA) * 255);
      output[idx + 3] = Math.round(clamp01(avgA) * 255);
    }
  }

  return {
    rgba: output,
    width: targetSize,
    height: targetSize,
    layout: layers.kind === 'fill' ? 'fill' : 'inset',
  };
}
