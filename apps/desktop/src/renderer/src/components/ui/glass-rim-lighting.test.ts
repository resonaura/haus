/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { GLASS_RIM_PRESETS, renderGlassRimNineSlice } from './glass-rim-lighting';

function pixelAt(
  raster: ReturnType<typeof renderGlassRimNineSlice>,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const idx = (y * raster.width + x) * 4;
  return [
    raster.pixels[idx] ?? 0,
    raster.pixels[idx + 1] ?? 0,
    raster.pixels[idx + 2] ?? 0,
    raster.pixels[idx + 3] ?? 0,
  ];
}

describe('analytical Liquid Glass rim lighting 9-slice generator', () => {
  it('renders continuous-corner specular + diffuse rim matching @haus/icons enclosureGlassRim', () => {
    const darkCard = renderGlassRimNineSlice({ radius: 25, scale: 2, isDark: true });
    expect(darkCard.width).toBe(darkCard.totalWidthPts * 2);
    expect(darkCard.height).toBe(darkCard.totalHeightPts * 2);
    expect(darkCard.sliceXPx).toBe(darkCard.sliceXPts * 2);
    expect(darkCard.sliceYPx).toBe(darkCard.sliceYPts * 2);

    // Exterior corner outside superellipse silhouette is completely transparent.
    expect(pixelAt(darkCard, 0, 0)[3]).toBe(0);
    expect(pixelAt(darkCard, darkCard.width - 1, darkCard.height - 1)[3]).toBe(0);

    // Interior body past the 8pt diffuse band is completely transparent.
    const midX = Math.floor(darkCard.width / 2);
    const midY = Math.floor(darkCard.height / 2);
    expect(pixelAt(darkCard, midX, midY)[3]).toBe(0);

    // Top straight edge has crisp specular crest at d=0.5pt decaying smoothly across the 8pt diffuse band.
    const topCrest = pixelAt(darkCard, midX, 0);
    const topDiffuseNear = pixelAt(darkCard, midX, 3); // ~1.75pt inside
    const topDiffuseMid = pixelAt(darkCard, midX, 8); // ~4.25pt inside
    const topInterior = pixelAt(darkCard, midX, 24); // ~12pt inside
    expect(topCrest[0]).toBe(255);
    expect(topCrest[3]).toBeGreaterThan(60);
    expect(topDiffuseNear[3]).toBeGreaterThan(0);
    expect(topDiffuseNear[3]).toBeLessThan(topCrest[3]);
    expect(topDiffuseMid[3]).toBeGreaterThan(0);
    expect(topDiffuseMid[3]).toBeLessThan(topDiffuseNear[3]);
    expect(topInterior[3]).toBe(0);

    // Dual-opposing bottom straight edge carries matching specular crest.
    const bottomCrest = pixelAt(darkCard, midX, darkCard.height - 1);
    expect(bottomCrest[0]).toBe(255);
    expect(bottomCrest[3]).toBe(topCrest[3]);

    // Unlit left/right side edges have zero bright white glare (only subtle lateral edge bevel).
    const leftEdge = pixelAt(darkCard, 0, midY);
    expect(leftEdge[0]).toBe(0);
    expect(leftEdge[3]).toBeLessThan(topCrest[3] / 2);

    // Middle straight-edge strip columns are identical in X so horizontal 9-slice stretching is seamless.
    const stripLeft = darkCard.sliceXPx;
    const stripRight = darkCard.width - darkCard.sliceXPx - 1;
    for (let y = 0; y < 18; y += 1) {
      expect(pixelAt(darkCard, stripLeft, y)).toEqual(pixelAt(darkCard, stripRight, y));
    }
  });

  it('aligns continuousSuperellipse corners to CSS superellipse(1.4) across all presets', () => {
    for (const preset of GLASS_RIM_PRESETS) {
      for (const isDark of [true, false]) {
        const raster = renderGlassRimNineSlice({
          radius: preset.radius,
          scale: 2,
          isDark,
          circular: preset.circular,
          continuousSuperellipse: true,
          maxSliceYPts: preset.maxSliceYPts,
          refPlateDark: preset.refPlateDark,
          refPlateLight: preset.refPlateLight,
          strength: preset.strength,
        });
        const midX = Math.floor(raster.width / 2);
        const midY = Math.floor(raster.height / 2);
        expect(pixelAt(raster, midX, 0)[3]).toBeGreaterThan(40);
        expect(pixelAt(raster, midX, midY)[3]).toBe(0);
        if (!preset.circular) {
          const stripLeft = raster.sliceXPx;
          const stripRight = raster.width - raster.sliceXPx - 1;
          expect(pixelAt(raster, stripLeft, 0)).toEqual(pixelAt(raster, stripRight, 0));
          // Verify diagonal 45° superellipse(1.4) crest hugs the CSS corner curve within 1px.
          const rEff = Math.min(preset.radius, raster.totalHeightPts / 2);
          const d45 = Math.round(rEff * (1 - 0.5 ** (1 / 2 ** 1.4)) * 2);
          expect(pixelAt(raster, Math.max(0, d45 - 2), Math.max(0, d45 - 2))[3]).toBe(0);
          const crestA = pixelAt(raster, d45, d45);
          const crestB = pixelAt(raster, d45 + 1, d45 + 1);
          const peak = crestA[3] >= crestB[3] ? crestA : crestB;
          expect(peak[0]).toBe(255);
          expect(peak[3]).toBeGreaterThan(20);
        }
      }
    }
  });
});
