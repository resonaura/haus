/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ENCLOSURE_RIM, ICON_RENDERING_PARAMETERS } from './parameters';
import { iconRenderingSizeClass } from './contour';
import { resampleIconRectilinear } from './resampling';
import { generateLegacyIconLayers } from './layers';
import { createLegacyColorPresentation } from './presentation';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

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
  const maxAnalysisDim = 128;
  const analysisSource =
    sourceWidth > maxAnalysisDim || sourceHeight > maxAnalysisDim
      ? resampleIconRectilinear(
          sourceRgba,
          sourceWidth,
          sourceHeight,
          Math.min(sourceWidth, maxAnalysisDim),
          Math.min(sourceHeight, maxAnalysisDim),
        )
      : { rgba: sourceRgba, width: sourceWidth, height: sourceHeight };

  const layers = generateLegacyIconLayers(
    analysisSource.rgba,
    analysisSource.width,
    analysisSource.height,
    { continuousContour: true },
  );
  const presented = createLegacyColorPresentation(layers, targetSize, targetSize, appearance);

  const isDark = appearance === 'dark';
  const sizeClass = iconRenderingSizeClass(displaySize);
  const pixelScale = Math.max(1, targetSize / Math.max(1, displaySize));
  const cornerRadius = (ICON_RENDERING_PARAMETERS.defaultEnclosureCornerRadius / 1024) * targetSize;
  const halfExtent = targetSize * 0.5 - 0.5;
  const center = targetSize * 0.5;
  const outlineWidth = ICON_RENDERING_PARAMETERS.outlines.lineWidth[sizeClass] * pixelScale;
  const brightOpacity = ICON_RENDERING_PARAMETERS.outlines.lineOpacityOnBright[sizeClass];
  const dimOpacity = ICON_RENDERING_PARAMETERS.outlines.lineOpacityOnDim[sizeClass];

  const output = new Uint8ClampedArray(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const idx = (x + y * targetSize) * 4;
      const sdf = evaluateEnclosureSdf(
        x + 0.5 - center,
        y + 0.5 - center,
        halfExtent,
        halfExtent,
        cornerRadius,
      );
      const coverage = clamp01(0.5 - sdf.distance);
      if (coverage <= 0) continue;

      const distanceInsidePts = Math.max(0, -sdf.distance / pixelScale);
      const rim = enclosureGlassRim(distanceInsidePts, sdf.normalY, 1 / pixelScale);
      const baseR = (presented.rgba[idx] ?? 0) / 255;
      const baseG = (presented.rgba[idx + 1] ?? 0) / 255;
      const baseB = (presented.rgba[idx + 2] ?? 0) / 255;
      let [r, g, b] = enclosureRimComposite(baseR, baseG, baseB, rim, isDark);

      const outlineCoverage =
        clamp01(Math.max(0, -sdf.distance) + 0.5) *
        clamp01(outlineWidth - Math.max(0, -sdf.distance) + 0.5);
      if (outlineCoverage > 0) {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const strokeAlpha = outlineCoverage * mix(dimOpacity, brightOpacity, clamp01(luma));
        const strokeColor = isDark || luma < 0.45 ? 1 : 0;
        r = mix(r, strokeColor, strokeAlpha);
        g = mix(g, strokeColor, strokeAlpha);
        b = mix(b, strokeColor, strokeAlpha);
      }

      output[idx] = Math.round(r * 255);
      output[idx + 1] = Math.round(g * 255);
      output[idx + 2] = Math.round(b * 255);
      output[idx + 3] = Math.round(coverage * 255);
    }
  }

  return {
    rgba: output,
    width: targetSize,
    height: targetSize,
    layout: layers.kind === 'fill' ? 'fill' : 'inset',
  };
}
