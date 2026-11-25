/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { superellipseToContinuousRadiusRatio } from './geometry.js';

export type GlassRimPresetName =
  'panel' | 'dock' | 'pill' | 'card' | 'medium' | 'control' | 'circle';

export type GlassRimEffectMotion =
  'none' | 'flicker' | 'pulse' | 'rainbow' | 'aurora' | 'wave' | 'sparkle' | 'beat';

export interface GlassRimPresetSpec {
  readonly name: GlassRimPresetName;
  /** Padding-box corner radius (border-radius minus 1px border) in CSS px. */
  readonly radius: number;
  /** Optional vertical slice cap so short pills/docks never shrink border-image-width. */
  readonly maxSliceYPts?: number;
  readonly circular?: boolean;
  readonly refPlateDark: number;
  readonly refPlateLight: number;
  readonly strength: number;
}

export interface GlassRimSdfSample {
  readonly distance: number;
  readonly normalX: number;
  readonly normalY: number;
}

export interface GlassRimRaster {
  readonly width: number;
  readonly height: number;
  readonly sliceXPx: number;
  readonly sliceYPx: number;
  readonly sliceXPts: number;
  readonly sliceYPts: number;
  readonly totalWidthPts: number;
  readonly totalHeightPts: number;
  readonly pixels: Uint8ClampedArray;
}

/**
 * Analytical macOS Liquid Glass rim lighting constants (`CASDFKeyFillHighlightEffect`).
 * Shared 1:1 with `@haus/icons` and `packages/ui/src/shaders/glass-rim.wgsl`.
 */
export const MACOS_GLASS_RIM = Object.freeze({
  height: 1,
  amount: 0.5,
  spread: 1.523526992886717,
  diffuseHeightScale: 8,
  diffuseAmountScale: 0.15000000596046448,
  diffuseSpreadScale: 0.6499999761581421,
  curvature: 0.75,
});

/** Shared Liquid Glass surface presets matching Haus's continuous-corner geometry. */
export const GLASS_RIM_PRESETS: readonly GlassRimPresetSpec[] = [
  { name: 'panel', radius: 33, refPlateDark: 0.14, refPlateLight: 0.72, strength: 1.0 },
  {
    name: 'dock',
    radius: 30,
    maxSliceYPts: 28,
    refPlateDark: 0.14,
    refPlateLight: 0.72,
    strength: 0.96,
  },
  {
    name: 'pill',
    radius: 23,
    maxSliceYPts: 21,
    refPlateDark: 0.15,
    refPlateLight: 0.74,
    strength: 0.94,
  },
  { name: 'card', radius: 25, refPlateDark: 0.11, refPlateLight: 0.78, strength: 0.92 },
  {
    name: 'medium',
    radius: 17,
    maxSliceYPts: 18,
    refPlateDark: 0.13,
    refPlateLight: 0.75,
    strength: 0.94,
  },
  {
    name: 'control',
    radius: 13,
    maxSliceYPts: 14,
    refPlateDark: 0.15,
    refPlateLight: 0.74,
    strength: 0.92,
  },
  {
    name: 'circle',
    radius: 16,
    circular: true,
    refPlateDark: 0.15,
    refPlateLight: 0.74,
    strength: 0.96,
  },
];

const SUPERELLIPSE_EXTENT_RATIO = 1.5286649465560913;
/**
 * Exact ratio aligning QuartzCore's continuous-corner SDF (`evaluateGlassRimSdf`) to CSS
 * `corner-shape: superellipse(1.4)` (`< 0.08px` RMS error across the entire 90deg arc).
 */
const SUPERELLIPSE_14_TO_SDF_RADIUS = superellipseToContinuousRadiusRatio(1.4);
const DIFFUSE_DEPTH_PTS = MACOS_GLASS_RIM.height * MACOS_GLASS_RIM.diffuseHeightScale;
const STRAIGHT_MID_PTS = 4;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function getGlassRimPreset(name: GlassRimPresetName): GlassRimPresetSpec {
  return GLASS_RIM_PRESETS.find((preset) => preset.name === name) ?? GLASS_RIM_PRESETS[3]!;
}

/** Analytical continuous-corner supercircle signed distance and radial normal (`macosGlassShape`). */
export function evaluateGlassRimSdf(
  pointX: number,
  pointY: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): GlassRimSdfSample {
  const r = Math.max(Math.min(Math.abs(radius), Math.min(halfWidth, halfHeight)), 0.0001);
  const extent = r * SUPERELLIPSE_EXTENT_RATIO;
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
  const circX = Math.max(qx * SUPERELLIPSE_EXTENT_RATIO - 0.5286650061607361, 0);
  const circY = Math.max(qy * SUPERELLIPSE_EXTENT_RATIO - 0.5286650061607361, 0);
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

function rimBand(
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

/** Dual-opposing specular + diffuse rim highlight intensity (`macosGlassRim`). */
export function evaluateGlassRimIntensity(
  distanceInside: number,
  outwardNormalY: number,
  aaWidth: number,
): number {
  const facing = Math.abs(outwardNormalY);
  const spread = Math.cos(MACOS_GLASS_RIM.spread);
  const diffuseSpread = Math.cos(MACOS_GLASS_RIM.spread * MACOS_GLASS_RIM.diffuseSpreadScale);
  const angular = clamp01((facing - spread) / (1 - spread));
  const diffuseAngular = clamp01((facing - diffuseSpread) / (1 - diffuseSpread));
  const aa = Math.max(aaWidth, 0.0001);
  return (
    rimBand(
      distanceInside,
      MACOS_GLASS_RIM.height,
      MACOS_GLASS_RIM.curvature,
      angular,
      MACOS_GLASS_RIM.amount,
      aa,
    ) +
    rimBand(
      distanceInside,
      DIFFUSE_DEPTH_PTS,
      1,
      diffuseAngular,
      MACOS_GLASS_RIM.amount * MACOS_GLASS_RIM.diffuseAmountScale,
      aa,
    )
  );
}

/** Vibrancy-aware color matrix composite (`macosGlassRimComposite`). */
export function compositeGlassRimVibrancy(
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

/**
 * Generates an exact 9-slice (or full-circle) Liquid Glass rim lighting texture
 * using the 1:1 analytical continuous-corner supercircle SDF, dual-opposing
 * specular + 8pt inner diffuse rim, and vibrancy-aware composite.
 */
export function renderGlassRimNineSlice(options: {
  readonly radius: number;
  readonly scale: number;
  readonly isDark: boolean;
  readonly circular?: boolean;
  readonly continuousSuperellipse?: boolean;
  readonly maxSliceYPts?: number;
  readonly refPlateDark?: number;
  readonly refPlateLight?: number;
  readonly strength?: number;
}): GlassRimRaster {
  const scale = Math.max(1, Math.min(3, Math.round(options.scale)));
  const rawRadius = Math.max(4, options.radius);
  const circular = options.circular === true;
  const sdfRadius =
    !circular && options.continuousSuperellipse
      ? rawRadius * SUPERELLIPSE_14_TO_SDF_RADIUS
      : rawRadius;
  const isDark = options.isDark;
  const strength = options.strength ?? 1;
  const refPlate = isDark ? (options.refPlateDark ?? 0.12) : (options.refPlateLight ?? 0.75);

  const sliceXPts = circular
    ? Math.ceil(rawRadius)
    : Math.max(
        Math.ceil(sdfRadius * SUPERELLIPSE_EXTENT_RATIO) + 1,
        Math.ceil(DIFFUSE_DEPTH_PTS) + 4,
      );
  const sliceYPts = circular
    ? sliceXPts
    : Math.max(
        Math.ceil(DIFFUSE_DEPTH_PTS) + 4,
        options.maxSliceYPts ? Math.min(sliceXPts, Math.ceil(options.maxSliceYPts)) : sliceXPts,
      );
  const totalWidthPts = circular ? sliceXPts * 2 : sliceXPts * 2 + STRAIGHT_MID_PTS;
  const totalHeightPts = circular ? sliceYPts * 2 : sliceYPts * 2 + STRAIGHT_MID_PTS;
  const width = totalWidthPts * scale;
  const height = totalHeightPts * scale;
  const sliceXPx = sliceXPts * scale;
  const sliceYPx = sliceYPts * scale;
  const halfWidth = totalWidthPts * 0.5;
  const halfHeight = totalHeightPts * 0.5;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const aaWidth = 1 / scale;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const outerCull = 1.5 / scale;
  const innerCull = -(DIFFUSE_DEPTH_PTS + 1.5);
  const invHeadroom = 1 / Math.max(0.08, 1 - refPlate);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const centerSdf = evaluateGlassRimSdf(
        (x + 0.5 - centerX) / scale,
        (y + 0.5 - centerY) / scale,
        halfWidth,
        halfHeight,
        sdfRadius,
      );
      if (centerSdf.distance >= outerCull || centerSdf.distance <= innerCull) continue;

      const sub = centerSdf.distance > -1.5 ? 4 : 2;
      const step = 1 / sub;
      const invSamples = 1 / (sub * sub);
      let sumLightA = 0;
      let sumDarkA = 0;

      for (let sy = 0; sy < sub; sy += 1) {
        const py = (y + (sy + 0.5) * step - centerY) / scale;
        for (let sx = 0; sx < sub; sx += 1) {
          const px = (x + (sx + 0.5) * step - centerX) / scale;
          const sdf = evaluateGlassRimSdf(px, py, halfWidth, halfHeight, sdfRadius);
          if (sdf.distance > 0) continue;

          const distInside = Math.max(0, -sdf.distance);
          const rim = evaluateGlassRimIntensity(distInside, sdf.normalY, aaWidth);
          if (rim > 0) {
            const [compR, compG, compB] = compositeGlassRimVibrancy(
              refPlate,
              refPlate,
              refPlate,
              rim,
              isDark,
            );
            const compLum = (compR + compG + compB) / 3;
            const delta = Math.max(0, compLum - refPlate);
            sumLightA += clamp01(delta * invHeadroom * strength);
          }

          if (distInside <= 1.1) {
            const sideFacing = Math.abs(sdf.normalX);
            if (sideFacing > 0.78) {
              const edgeBand = clamp01(1 - distInside / 1.1);
              const sideFactor = (sideFacing - 0.78) / 0.22;
              sumDarkA += edgeBand * sideFactor * (isDark ? 0.08 : 0.095) * strength;
            }
          }
        }
      }

      const lightA = clamp01(sumLightA * invSamples);
      const darkA = clamp01(sumDarkA * invSamples);
      const outA = clamp01(lightA + darkA * (1 - lightA));
      if (outA <= 1 / 510) continue;

      const rgb = Math.round(clamp01(lightA / outA) * 255);
      const idx = (y * width + x) * 4;
      pixels[idx] = rgb;
      pixels[idx + 1] = rgb;
      pixels[idx + 2] = rgb;
      pixels[idx + 3] = Math.round(outA * 255);
    }
  }

  return {
    width,
    height,
    sliceXPx,
    sliceYPx,
    sliceXPts,
    sliceYPts,
    totalWidthPts,
    totalHeightPts,
    pixels,
  };
}
