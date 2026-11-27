/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCanvas, ImageData as SkiaImageData, loadImage, type Canvas } from '@napi-rs/canvas';
import {
  decodeBase64Bytes,
  ICON_CACHE_VERSION,
  premultipliedIconPixels,
  renderEnclosureTileToRgba,
  type ResolvedIconStyle,
} from '@haus/icons';
import {
  computeBrandIconShadowLayout,
  registerBrandTileCacheClearHook,
} from '../components/brand/brand-cache.js';
import type {
  BrandIconPort,
  DecoratedBrandTile,
  RenderedBrandTile,
} from '../primitives/brand-port.js';

/**
 * Baseline per-side shadow bleed fraction relative to the visible squircle body (`>= 12pt` per side).
 * Matches Electron's `overflow: visible` CSS `filter: drop-shadow(...)` without clipping.
 */
export const BRAND_ICON_SHADOW_BLEED_FRACTION = 0.26;

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

interface OpaqueBodyMeasurement {
  readonly centeredSquare: boolean;
  readonly span: number;
  readonly centerX: number;
  readonly centerY: number;
}

/**
 * Measures the visible enclosure body (`alpha >= 90`, covering `default`, `dark`, `tinted`,
 * and `clear` light/dark plates while excluding outer anti-aliasing fringe) so tiles with
 * different source dimensions or margins (`0.8`, `0.9`, `1.0`) normalize to the exact same
 * visible squircle size on screen.
 */
function measureOpaqueTileBody(
  img: Awaited<ReturnType<typeof loadImage>>,
  srcW: number,
  srcH: number,
): OpaqueBodyMeasurement | null {
  const probeCanvas = createCanvas(srcW, srcH);
  const probeCtx = probeCanvas.getContext('2d');
  probeCtx.clearRect(0, 0, srcW, srcH);
  probeCtx.drawImage(img, 0, 0, srcW, srcH);
  const { data } = probeCtx.getImageData(0, 0, srcW, srcH);

  let minX = srcW;
  let minY = srcH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < srcH; y += 1) {
    const row = y * srcW;
    for (let x = 0; x < srcW; x += 1) {
      if ((data[(row + x) * 4 + 3] ?? 0) >= 90) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const bodyW = maxX - minX + 1;
  const bodyH = maxY - minY + 1;
  const span = Math.max(bodyW, bodyH);
  const centerX = (minX + maxX + 1) * 0.5;
  const centerY = (minY + maxY + 1) * 0.5;
  const squareness = Math.min(bodyW, bodyH) / Math.max(1, span);
  const centeredX = Math.abs(centerX - srcW * 0.5) <= srcW * 0.06;
  const centeredY = Math.abs(centerY - srcH * 0.5) <= srcH * 0.06;
  const largeEnough = span >= Math.max(srcW, srcH) * 0.5;

  return {
    centeredSquare: squareness >= 0.92 && centeredX && centeredY && largeEnough,
    span,
    centerX,
    centerY,
  };
}

/**
 * Normalizes any brand tile to an exact deterministic physical Retina visible body (`displaySize * dpr`)
 * via progressive 2:1 box prefiltering + Skia high-quality resampling (eliminating minification
 * aliasing on GPUI's single-mip Metal/WGPU atlas AND guaranteeing identical rendered icon sizes
 * across mixed source resolutions or tile margins), then composites Electron's exact
 * `.brand-icon-tile` alpha-following drop-shadow onto a symmetrically bleed-padded PNG.
 */
export function applyBrandIconDropShadow(
  dataUrl: string,
  displaySize = 44,
  dark = false,
  dpr = 2,
): Promise<DecoratedBrandTile | null> {
  if (!dataUrl) return Promise.resolve(null);
  const layout = computeBrandIconShadowLayout(displaySize, dpr);
  const cacheKey = `${ICON_CACHE_VERSION}:shadow-aa-v2:${dark ? 'd' : 'l'}:${layout.displaySize}@${layout.dpr}x:${dataUrl}`;
  const cached = shadowCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = shadowInflight.get(cacheKey);
  if (pending) return pending;

  const job = (async (): Promise<DecoratedBrandTile | null> => {
    try {
      const payload = decodeDataUrlBytes(dataUrl);
      const img = payload ? await loadImage(payload) : await loadImage(dataUrl);
      const srcW = Math.max(1, img.width || 256);
      const srcH = Math.max(1, img.height || 256);

      const measured = measureOpaqueTileBody(img, srcW, srcH);
      let drawW: number;
      let drawH: number;
      let drawX: number;
      let drawY: number;
      if (measured?.centeredSquare) {
        const scaleToBody = layout.bodyPx / measured.span;
        drawW = srcW * scaleToBody;
        drawH = srcH * scaleToBody;
        drawX = layout.outPx * 0.5 - measured.centerX * scaleToBody;
        drawY = layout.outPx * 0.5 - measured.centerY * scaleToBody;
      } else {
        const fitScale = layout.bodyPx / Math.max(srcW, srcH);
        drawW = srcW * fitScale;
        drawH = srcH * fitScale;
        drawX = (layout.outPx - drawW) * 0.5;
        drawY = (layout.outPx - drawH) * 0.5;
      }

      // Progressive 2x halving prefilter eliminates high-frequency aliasing before final draw.
      let mipSource: Canvas | typeof img = img;
      let curW = srcW;
      let curH = srcH;
      while (curW >= drawW * 2 && curH >= drawH * 2 && curW > 4 && curH > 4) {
        const nextW = Math.max(Math.ceil(drawW), Math.round(curW / 2));
        const nextH = Math.max(Math.ceil(drawH), Math.round(curH / 2));
        const stepCanvas = createCanvas(nextW, nextH);
        const stepCtx = stepCanvas.getContext('2d');
        stepCtx.clearRect(0, 0, nextW, nextH);
        stepCtx.imageSmoothingEnabled = true;
        stepCtx.imageSmoothingQuality = 'high';
        stepCtx.drawImage(mipSource, 0, 0, nextW, nextH);
        mipSource = stepCanvas;
        curW = nextW;
        curH = nextH;
      }

      // In Skia/Chromium, CSS `filter: drop-shadow(0 y blur color)` uses Gaussian sigma = blur,
      // while Canvas 2D `ctx.shadowBlur` uses sigma = shadowBlur / 2.
      const offsetY = (dark ? 1.5 : 1.25) * layout.dpr;
      const shadowBlur = (dark ? 2.75 : 2.25) * 2 * layout.dpr;
      const shadowColor = dark ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0.26)';

      const canvas = createCanvas(layout.outPx, layout.outPx);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, layout.outPx, layout.outPx);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      ctx.shadowColor = shadowColor;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = offsetY;
      ctx.shadowBlur = shadowBlur;
      ctx.drawImage(mipSource, drawX, drawY, drawW, drawH);
      ctx.restore();

      const outUrl = canvas.toDataURL('image/png');
      if (!outUrl || outUrl === 'data:,') return null;
      return rememberLru(shadowCache, cacheKey, {
        dataUrl: outUrl,
        bleedFraction: layout.bleedFraction,
        displaySizePt: layout.displaySizePt,
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
