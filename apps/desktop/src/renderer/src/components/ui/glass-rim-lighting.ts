/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  ENCLOSURE_RIM,
  enclosureGlassRim,
  enclosureRimComposite,
  evaluateEnclosureSdf,
} from '@haus/icons';

export type GlassRimPresetName =
  'panel' | 'dock' | 'pill' | 'card' | 'medium' | 'control' | 'circle';

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
 * Shared Liquid Glass surface presets matching Haus's continuous-corner geometry.
 * Every preset evaluates the exact same analytical `evaluateEnclosureSdf` +
 * `enclosureGlassRim` + `enclosureRimComposite` model used for app & brand icons.
 */
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
 * Exact ratio aligning Apple's continuous-corner SDF (`evaluateEnclosureSdf`) to CSS
 * `corner-shape: superellipse(1.4)` (`< 0.08px` RMS error across the entire 90° arc).
 */
const SUPERELLIPSE_14_TO_SDF_RADIUS = (1 - 2 ** (-1 / 2 ** 1.4)) / (1 - Math.SQRT1_2);
const DIFFUSE_DEPTH_PTS = ENCLOSURE_RIM.height * ENCLOSURE_RIM.diffuseHeightScale;
const STRAIGHT_MID_PTS = 4;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function supportsSuperellipseCornerShape(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('corner-shape', 'superellipse(1.4)');
}

/**
 * Generates an exact 9-slice (or full-circle) Liquid Glass rim lighting texture
 * using the 1:1 analytical continuous-corner supercircle SDF (`evaluateEnclosureSdf`),
 * dual-opposing specular + 8pt inner diffuse rim (`enclosureGlassRim`), and
 * vibrancy-aware composite (`enclosureRimComposite`) from `@haus/icons`.
 *
 * Because the supercircle SDF is constant along straight edges and varies only
 * inside the 4 corner regions, stretching the 9-slice middle strips is
 * pixel-for-pixel identical to evaluating the full SDF at arbitrary dimensions `(W, H)`.
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
      const centerSdf = evaluateEnclosureSdf(
        (x + 0.5 - centerX) / scale,
        (y + 0.5 - centerY) / scale,
        halfWidth,
        halfHeight,
        sdfRadius,
      );
      if (centerSdf.distance >= outerCull || centerSdf.distance <= innerCull) continue;

      // 4x4 geometric MSAA along the outer supercircle crest; 2x2 across the soft diffuse band.
      const sub = centerSdf.distance > -1.5 ? 4 : 2;
      const step = 1 / sub;
      const invSamples = 1 / (sub * sub);
      let sumLightA = 0;
      let sumDarkA = 0;

      for (let sy = 0; sy < sub; sy += 1) {
        const py = (y + (sy + 0.5) * step - centerY) / scale;
        for (let sx = 0; sx < sub; sx += 1) {
          const px = (x + (sx + 0.5) * step - centerX) / scale;
          const sdf = evaluateEnclosureSdf(px, py, halfWidth, halfHeight, sdfRadius);
          if (sdf.distance > 0) continue;

          const distInside = Math.max(0, -sdf.distance);
          const rim = enclosureGlassRim(distInside, sdf.normalY, aaWidth);
          if (rim > 0) {
            const [compR, compG, compB] = enclosureRimComposite(
              refPlate,
              refPlate,
              refPlate,
              rim,
              isDark,
            );
            const compLum = (compR + compG + compB) / 3;
            const delta = Math.max(0, compLum - refPlate);
            const liftAlpha = clamp01(delta * invHeadroom * strength);
            sumLightA += liftAlpha;
          }

          // Subtle lateral Fresnel edge bevel strictly on unlit left/right walls (keeps 45° corners pure).
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
      // Composite bright specular over subtle lateral dark edge into one straight RGBA sample.
      const outA = clamp01(lightA + darkA * (1 - lightA));
      if (outA <= 1 / 510) continue;

      const bright = clamp01(lightA / outA);
      const rgb = Math.round(bright * 255);
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

interface EncodedRimSet {
  readonly entries: ReadonlyArray<{
    readonly name: GlassRimPresetName;
    readonly dataUrl: string;
    readonly sliceXPx: number;
    readonly sliceYPx: number;
    readonly sliceXPts: number;
    readonly sliceYPts: number;
  }>;
}

const encodedCache = new Map<string, EncodedRimSet>();
let appliedKey = '';

function rasterToPngDataUrl(raster: GlassRimRaster): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = ctx.createImageData(raster.width, raster.height);
  imageData.data.set(raster.pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function buildRimSet(
  isDark: boolean,
  scale: number,
  continuousSuperellipse: boolean,
): EncodedRimSet | null {
  const key = `${isDark ? 'dark' : 'light'}:${scale}:${continuousSuperellipse ? 'se' : 'rd'}`;
  const cached = encodedCache.get(key);
  if (cached) return cached;

  const entries: Array<{
    readonly name: GlassRimPresetName;
    readonly dataUrl: string;
    readonly sliceXPx: number;
    readonly sliceYPx: number;
    readonly sliceXPts: number;
    readonly sliceYPts: number;
  }> = [];

  for (const preset of GLASS_RIM_PRESETS) {
    const raster = renderGlassRimNineSlice({
      radius: preset.radius,
      scale,
      isDark,
      circular: preset.circular,
      continuousSuperellipse,
      maxSliceYPts: preset.maxSliceYPts,
      refPlateDark: preset.refPlateDark,
      refPlateLight: preset.refPlateLight,
      strength: preset.strength,
    });
    const dataUrl = rasterToPngDataUrl(raster);
    if (!dataUrl) return null;
    entries.push({
      name: preset.name,
      dataUrl,
      sliceXPx: raster.sliceXPx,
      sliceYPx: raster.sliceYPx,
      sliceXPts: raster.sliceXPts,
      sliceYPts: raster.sliceYPts,
    });
  }

  const set: EncodedRimSet = { entries };
  encodedCache.set(key, set);
  return set;
}

/**
 * Installs theme- and DPR-matched analytical Liquid Glass rim textures as CSS
 * custom properties (`--glass-rim-<preset>`, `... -slice`, `... -width`) on `:root`.
 * Runs synchronously in ~3ms once per `(theme, dpr)` pair and caches across toggles.
 */
export function syncDocumentGlassRimLighting(isDark: boolean): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const scale = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 2)));
  const continuousSuperellipse = supportsSuperellipseCornerShape();
  const key = `${isDark ? 'dark' : 'light'}:${scale}:${continuousSuperellipse ? 'se' : 'rd'}`;
  if (key === appliedKey) return;

  const set = buildRimSet(isDark, scale, continuousSuperellipse);
  if (!set) return;

  const rootStyle = document.documentElement.style;
  for (const entry of set.entries) {
    rootStyle.setProperty(`--glass-rim-${entry.name}`, `url("${entry.dataUrl}")`);
    rootStyle.setProperty(`--glass-rim-${entry.name}-slice`, `${entry.sliceYPx} ${entry.sliceXPx}`);
    rootStyle.setProperty(
      `--glass-rim-${entry.name}-width`,
      `${entry.sliceYPts}px ${entry.sliceXPts}px`,
    );
  }
  appliedKey = key;
}
