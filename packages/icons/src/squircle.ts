/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  hexColorToRgb,
  resolveEffectiveColorPresentation,
  type ResolvedIconStyle,
} from './appearance.js';
import { evaluateEnclosureSdf } from './engine/enclosure.js';
import { APP_ICON_METRICS, ICON_RENDERING_PARAMETERS } from './engine/parameters.js';

/**
 * Samples the exact zero-iso-contour of `evaluateEnclosureSdf` to produce an
 * SVG path whose outer silhouette, continuous corners (`266.24/1024`), and
 * tile fraction (`0.9`) match rendered icon tiles down to sub-pixel precision.
 */
export function buildContinuousSquircleSvgPath(
  canvasSize = 1024,
  tileFraction: number = APP_ICON_METRICS.tileFraction,
  samplesPerQuarter = 32,
): string {
  const tileSize = canvasSize * tileFraction;
  const half = tileSize * 0.5;
  const radius = (ICON_RENDERING_PARAMETERS.defaultEnclosureCornerRadius / 1024) * tileSize;
  const center = canvasSize * 0.5;
  const total = samplesPerQuarter * 4;
  const points: string[] = [];

  for (let i = 0; i < total; i += 1) {
    const theta = (i / total) * Math.PI * 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // Binary-search the exact ray intersection where evaluateEnclosureSdf == 0.
    let lo = 0;
    let hi = half * Math.SQRT2;
    for (let iter = 0; iter < 20; iter += 1) {
      const mid = (lo + hi) * 0.5;
      const sdf = evaluateEnclosureSdf(dx * mid, dy * mid, half, half, radius);
      if (sdf.distance < 0) lo = mid;
      else hi = mid;
    }
    const r = (lo + hi) * 0.5;
    const px = center + dx * r;
    const py = center + dy * r;
    points.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`);
  }

  return `${points.join(' ')} Z`;
}

/** Precomputed 1024×1024 SVG path matching `tileFraction = 0.9` & `266.24/1024` continuous corners. */
export const UNIFIED_ICON_SQUIRCLE_PATH = buildContinuousSquircleSvgPath(
  1024,
  APP_ICON_METRICS.tileFraction,
  36,
);

/** Full-canvas (1.0) continuous supercircle path for exact mask/clip usage. */
export const FULL_BLEED_SQUIRCLE_PATH = buildContinuousSquircleSvgPath(1024, 1.0, 36);

export type PlaceholderGlyphKind = 'integration' | 'addon' | 'plugin';

const GLYPH_PATHS: Readonly<Record<PlaceholderGlyphKind, string>> = {
  // Clean centered geometric marks matching Lucide stroke weight inside the 1024 canvas.
  integration:
    '<path d="M402 622 L462 562 M562 462 L622 402 M442 482 L542 582 M474 450 L574 550" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '<path d="M352 672 L402 622 C434 654 484 654 516 622 L548 590 L434 476 L402 508 C370 540 370 590 402 622" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '<path d="M672 352 L622 402 C590 370 540 370 508 402 L476 434 L590 548 L622 516 C654 484 654 434 622 402" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  addon:
    '<path d="M512 316 L678 412 L678 604 L512 700 L346 604 L346 412 Z" stroke-width="32" stroke-linejoin="round" fill="none"/>' +
    '<path d="M346 412 L512 508 L678 412 M512 508 L512 700" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  plugin:
    '<path d="M512 316 L678 412 L678 604 L512 700 L346 604 L346 412 Z" stroke-width="32" stroke-linejoin="round" fill="none"/>' +
    '<path d="M430 364 L596 460 M346 412 L512 508 L678 412 M512 508 L512 700" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

function rgbCss(r: number, g: number, b: number, a = 1): string {
  const ri = Math.round(Math.min(1, Math.max(0, r)) * 255);
  const gi = Math.round(Math.min(1, Math.max(0, g)) * 255);
  const bi = Math.round(Math.min(1, Math.max(0, b)) * 255);
  return a < 1 ? `rgba(${ri},${gi},${bi},${a.toFixed(3)})` : `rgb(${ri},${gi},${bi})`;
}

/**
 * Generates an inline SVG data URI for loading/placeholder icons using the exact
 * `UNIFIED_ICON_SQUIRCLE_PATH` geometry (`tileFraction = 0.9`, continuous supercircle
 * `266.24/1024`) and active GNOME appearance palette so there is zero shape or size jump.
 */
export function buildUnifiedPlaceholderSvgUri(
  glyphKind: PlaceholderGlyphKind,
  style: ResolvedIconStyle,
): string {
  const path = UNIFIED_ICON_SQUIRCLE_PATH;
  const glyph = GLYPH_PATHS[glyphKind];
  const [ar, ag, ab] = hexColorToRgb(style.tintHex);

  let fillDef = '';
  let fillRef = '';
  let rimStroke = 'rgba(255,255,255,0.22)';
  let glyphStroke = 'rgba(28,32,38,0.52)';

  const effectiveColor =
    style.appearance === 'default' || style.appearance === 'dark'
      ? resolveEffectiveColorPresentation(style.appearance, style.variation)
      : null;

  if (effectiveColor === 'default') {
    fillDef =
      '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ffffff"/>' +
      '<stop offset="100%" stop-color="#f5f5f5"/>' +
      '</linearGradient>';
    fillRef = 'url(#bg)';
    rimStroke = 'rgba(0,0,0,0.06)';
    glyphStroke = 'rgba(24,28,34,0.48)';
  } else if (effectiveColor === 'dark') {
    fillDef =
      '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#1f1f1f"/>' +
      '<stop offset="100%" stop-color="#0f0f0f"/>' +
      '</linearGradient>';
    fillRef = 'url(#bg)';
    rimStroke = 'rgba(255,255,255,0.12)';
    glyphStroke = 'rgba(255,255,255,0.56)';
  } else if (style.appearance === 'clear') {
    if (style.variation === 'dark') {
      fillDef =
        '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="rgba(48,48,52,0.72)"/>' +
        '<stop offset="100%" stop-color="rgba(34,34,38,0.68)"/>' +
        '</linearGradient>';
      fillRef = 'url(#bg)';
      rimStroke = 'rgba(255,255,255,0.34)';
      glyphStroke = 'rgba(255,255,255,0.78)';
    } else {
      fillDef =
        '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="rgba(166,166,172,0.42)"/>' +
        '<stop offset="100%" stop-color="rgba(128,128,134,0.46)"/>' +
        '</linearGradient>';
      fillRef = 'url(#bg)';
      rimStroke = 'rgba(255,255,255,0.62)';
      glyphStroke = 'rgba(255,255,255,0.88)';
    }
  } else {
    // Tinted
    if (style.variation === 'dark') {
      fillDef =
        '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#1e1e1e"/>' +
        '<stop offset="100%" stop-color="#141414"/>' +
        '</linearGradient>';
      fillRef = 'url(#bg)';
      rimStroke = 'rgba(255,255,255,0.22)';
      glyphStroke = rgbCss(ar, ag, ab, 0.9);
    } else {
      const top = rgbCss(
        Math.min(1, ar * 1.06 + 0.04),
        Math.min(1, ag * 1.06 + 0.04),
        Math.min(1, ab * 1.06 + 0.04),
      );
      const bot = rgbCss(ar * 0.92, ag * 0.92, ab * 0.92);
      fillDef =
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${top}"/>` +
        `<stop offset="100%" stop-color="${bot}"/>` +
        `</linearGradient>`;
      fillRef = 'url(#bg)';
      rimStroke = 'rgba(255,255,255,0.42)';
      glyphStroke = 'rgba(255,255,255,0.86)';
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 1024 1024">` +
    `<defs>${fillDef}` +
    `<clipPath id="c"><path d="${path}"/></clipPath>` +
    `</defs>` +
    `<path d="${path}" fill="${fillRef}"/>` +
    `<g clip-path="url(#c)">` +
    `<path d="${path}" fill="none" stroke="${rimStroke}" stroke-width="18"/>` +
    `<g stroke="${glyphStroke}">${glyph}</g>` +
    `</g>` +
    `</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
