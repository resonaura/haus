/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCanvas, ImageData as SkiaImageData, loadImage } from '@napi-rs/canvas';
import {
  decodeBase64Bytes,
  ICON_CACHE_VERSION,
  premultipliedIconPixels,
  renderEnclosureTileToRgba,
  type ResolvedIconStyle,
} from '@haus/icons';
import { registerBrandTileCacheClearHook } from '../components/brand/brand-cache.js';
import type {
  BrandIconPort,
  DecoratedBrandTile,
  RenderedBrandTile,
} from '../primitives/brand-port.js';

/**
 * Symmetrical per-side canvas bleed fraction reserved for alpha-following outer
 * drop-shadows on GPUIX (`1 + 2 * 0.22 = 1.44` total canvas scale around the tile).
 * Matches Electron's `overflow: visible` CSS `filter: drop-shadow(...)` without clipping.
 */
export const BRAND_ICON_SHADOW_BLEED_FRACTION = 0.22;

const CACHE_LIMIT = 400;
const renderedCache = new Map<string, RenderedBrandTile>();
const inflight = new Map<string, Promise<RenderedBrandTile | null>>();
const shadowCache = new Map<string, DecoratedBrandTile>();
const shadowInflight = new Map<string, Promise<DecoratedBrandTile | null>>();

registerBrandTileCacheClearHook(() => {
  renderedCache.clear();
  inflight.clear();
  shadowCache.clear();
  shadowInflight.clear();
});

function rememberLru<V>(map: Map<string, V>, key: string, value: V): V {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > CACHE_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return value;
}

const UTF8_ENCODER = new TextEncoder();

export function decodeDataUrlBytes(src: string): Uint8Array | null {
  if (!src.startsWith('data:')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const header = src.slice(5, comma).toLowerCase();
  const body = src.slice(comma + 1);
  if (header.includes(';base64')) {
    return decodeBase64Bytes(body);
  }
  return UTF8_ENCODER.encode(decodeURIComponent(body));
}

export interface RasterizedBrandSource {
  readonly width: number;
  readonly height: number;
  readonly straightRgba: Uint8ClampedArray;
  readonly premulRgba: Uint8ClampedArray;
}

/**
 * Rasterizes an SVG, PNG, JPEG, or WebP source URI via Skia at full `@haus/icons`
 * analysis resolution (`512px` for vectors, up to `512px` for rasters).
 */
export async function rasterizeBrandSource(
  src: string,
  fallbackDim = 256,
): Promise<RasterizedBrandSource | null> {
  if (!src) return null;
  try {
    const payload = decodeDataUrlBytes(src);
    const img = payload ? await loadImage(payload) : await loadImage(src);
    const naturalW = img.width || fallbackDim;
    const naturalH = img.height || fallbackDim;
    const isSvg = src.startsWith('data:image/svg+xml') || /\.svg(?:[?#]|$)/i.test(src);
    const sampleDim = isSvg ? 512 : Math.max(1, Math.min(512, Math.max(naturalW, naturalH)));
    const sourceCanvas = createCanvas(sampleDim, sampleDim);
    const sourceCtx = sourceCanvas.getContext('2d');
    const scale = Math.min(sampleDim / Math.max(1, naturalW), sampleDim / Math.max(1, naturalH));
    const drawW = Math.max(1, Math.round(naturalW * scale));
    const drawH = Math.max(1, Math.round(naturalH * scale));
    const offsetX = Math.floor((sampleDim - drawW) / 2);
    const offsetY = Math.floor((sampleDim - drawH) / 2);

    sourceCtx.clearRect(0, 0, sampleDim, sampleDim);
    sourceCtx.imageSmoothingEnabled = true;
    sourceCtx.imageSmoothingQuality = 'high';
    sourceCtx.drawImage(img, offsetX, offsetY, drawW, drawH);

    const straightRgba = new Uint8ClampedArray(
      sourceCtx.getImageData(0, 0, sampleDim, sampleDim).data,
    );
    const premulRgba = premultipliedIconPixels(straightRgba);
    return { width: sampleDim, height: sampleDim, straightRgba, premulRgba };
  } catch {
    return null;
  }
}

/**
 * Composites Electron's exact `.brand-icon-tile` alpha-following drop-shadow
 * (`0 1.25px 2.25px rgb(0 0 0 / 26%)` light; `0 1.5px 2.75px rgb(0 0 0 / 42%)` dark)
 * onto a symmetrically bleed-padded PNG for GPUIX (which has no CSS `filter: drop-shadow`).
 * Works identically for Hub-rendered tiles, C++20 `IconRenderService` tiles, clear/tinted tiles,
 * and protocol vectors without clipping the continuous-supercircle shadow silhouette.
 */
export function applyBrandIconDropShadow(
  dataUrl: string,
  displaySize = 44,
  dark = false,
): Promise<DecoratedBrandTile | null> {
  if (!dataUrl) return Promise.resolve(null);
  const clampedDisplay = Math.max(16, Math.min(256, Math.round(displaySize)));
  const cacheKey = `${ICON_CACHE_VERSION}:shadow:${dark ? 'd' : 'l'}:${clampedDisplay}:${dataUrl}`;
  const cached = shadowCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = shadowInflight.get(cacheKey);
  if (pending) return pending;

  const job = (async (): Promise<DecoratedBrandTile | null> => {
    try {
      const payload = decodeDataUrlBytes(dataUrl);
      const img = payload ? await loadImage(payload) : await loadImage(dataUrl);
      const tileW = Math.max(64, Math.min(320, img.width || 256));
      const tileH = Math.max(64, Math.min(320, img.height || 256));
      const tileDim = Math.max(tileW, tileH);
      const pad = Math.round(tileDim * BRAND_ICON_SHADOW_BLEED_FRACTION);
      const outDim = tileDim + pad * 2;
      const scale = tileDim / clampedDisplay;

      // In Skia/Chromium, CSS `filter: drop-shadow(0 y blur color)` uses Gaussian sigma = blur,
      // while Canvas 2D `ctx.shadowBlur` uses sigma = shadowBlur / 2.
      const offsetY = (dark ? 1.5 : 1.25) * scale;
      const shadowBlur = (dark ? 2.75 : 2.25) * 2 * scale;
      const shadowColor = dark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0.26)';

      const canvas = createCanvas(outDim, outDim);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, outDim, outDim);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      ctx.shadowColor = shadowColor;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = offsetY;
      ctx.shadowBlur = shadowBlur;
      ctx.drawImage(img, pad, pad, tileDim, tileDim);
      ctx.restore();

      const outUrl = canvas.toDataURL('image/png');
      if (!outUrl || outUrl === 'data:,') return null;
      return rememberLru(shadowCache, cacheKey, {
        dataUrl: outUrl,
        bleedFraction: BRAND_ICON_SHADOW_BLEED_FRACTION,
      });
    } catch {
      return null;
    } finally {
      shadowInflight.delete(cacheKey);
    }
  })();

  shadowInflight.set(cacheKey, job);
  return job;
}

/**
 * Fallback local tile rasterizer backed directly by `@haus/icons` (`renderEnclosureTileToRgba`)
 * at full 256–320px resolution matching Electron's browser fallback 1:1.
 * Desktop GPUIX prefers `@haus/icons/node`'s `IconRenderService` + C++20 `haus-icon-worker`.
 */
export function renderLocalBrandTileNode(
  src: string,
  style: ResolvedIconStyle,
  displaySize = 44,
): Promise<RenderedBrandTile | null> {
  if (!src) return Promise.resolve(null);
  const targetSize = Math.max(256, Math.min(320, Math.round(displaySize * 4)));
  const tintKey = style.appearance === 'tinted' ? style.tintHex.toLowerCase() : '-';
  const varKey = style.appearance === 'dark' ? '-' : style.variation;
  const cacheKey = `${ICON_CACHE_VERSION}:gpui:${style.appearance}:${varKey}:${tintKey}:${targetSize}:${Math.round(displaySize)}:${src}`;
  const cached = renderedCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const job = (async (): Promise<RenderedBrandTile | null> => {
    try {
      const source = await rasterizeBrandSource(src, targetSize);
      if (!source) return null;

      const rendered = renderEnclosureTileToRgba(source.premulRgba, source.width, source.height, {
        targetSize,
        displaySize,
        appearance: style.appearance,
        variation: style.variation,
        tintHex: style.tintHex,
      });

      const outCanvas = createCanvas(rendered.width, rendered.height);
      const outCtx = outCanvas.getContext('2d');
      const outData = new SkiaImageData(
        new Uint8ClampedArray(rendered.rgba),
        rendered.width,
        rendered.height,
      );
      outCtx.putImageData(outData, 0, 0);
      const dataUrl = outCanvas.toDataURL('image/png');
      if (!dataUrl || dataUrl === 'data:,') return null;
      return rememberLru(renderedCache, cacheKey, { dataUrl, layout: rendered.layout });
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, job);
  return job;
}

/** Creates a GPUIX `BrandIconPort` with `@haus/icons` fallback rendering and alpha drop-shadow compositing. */
export function createGpuiBrandIconPort(overrides?: Partial<BrandIconPort>): BrandIconPort {
  return {
    renderLocalTile: renderLocalBrandTileNode,
    applyTileShadow: applyBrandIconDropShadow,
    ...overrides,
  };
}
