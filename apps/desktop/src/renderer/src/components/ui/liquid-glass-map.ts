/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { evaluateEnclosureSdf } from '@haus/icons';

export interface GlassDisplacement {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

/**
 * A continuous-corner Liquid Glass lens using the exact `@haus/icons` supercircle SDF:
 * the reading centre is flat and only the curved superellipse rim refracts the backdrop.
 */
export function glassDisplacement(
  width: number,
  height: number,
  radius: number,
): GlassDisplacement {
  const safeSize = (value: number) => (Number.isFinite(value) ? Math.max(1, value) : 1);
  const cssWidth = safeSize(width);
  const cssHeight = safeSize(height);
  const ratio = Math.min(1, 512 / Math.max(cssWidth, cssHeight));
  const rasterWidth = Math.max(1, Math.round(cssWidth * ratio));
  const rasterHeight = Math.max(1, Math.round(cssHeight * ratio));
  const halfWidth = cssWidth / 2;
  const halfHeight = cssHeight / 2;
  const corner = Math.min(halfWidth, halfHeight, Number.isFinite(radius) ? Math.max(0, radius) : 0);
  const rim = Math.min(28, Math.max(8, corner * 0.85), halfWidth, halfHeight);
  const pixels = new Uint8ClampedArray(rasterWidth * rasterHeight * 4);
  for (let y = 0; y < rasterHeight; y++) {
    const py = ((y + 0.5) / rasterHeight) * cssHeight - halfHeight;
    for (let x = 0; x < rasterWidth; x++) {
      const px = ((x + 0.5) / rasterWidth) * cssWidth - halfWidth;
      const offset = (y * rasterWidth + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 128;
      pixels[offset + 3] = 255;
      const sdf = evaluateEnclosureSdf(px, py, halfWidth, halfHeight, corner);
      const distance = -sdf.distance;
      if (distance < 0 || distance >= rim) continue;

      const t = distance / rim;
      const bend = 1 - t * t * (3 - 2 * t);
      pixels[offset] = Math.round(128 - sdf.normalX * bend * 127);
      pixels[offset + 1] = Math.round(128 - sdf.normalY * bend * 127);
    }
  }
  return { width: rasterWidth, height: rasterHeight, pixels };
}
