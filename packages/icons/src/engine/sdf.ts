/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ENCLOSURE_RIM } from './parameters.js';

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const srgbToLinear = (value: number): number => {
  const c = clamp01(value);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const linearToSrgb = (value: number): number => {
  const c = clamp01(value);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

export interface EnclosureSdfSample {
  distance: number;
  normalX: number;
  normalY: number;
}

/** Analytical continuous-corner supercircle signed distance and radial normal (1:1 GNOME macosGlassShape). */
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

/** Dual-opposing specular + diffuse rim highlight intensity (1:1 GNOME macosGlassRim). */
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

/** Vibrancy-aware color matrix composite (1:1 GNOME macosGlassRimComposite). */
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
