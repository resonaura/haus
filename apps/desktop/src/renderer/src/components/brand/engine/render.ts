/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  ICON_CACHE_VERSION,
  renderEnclosureTileToRgba,
  type IconAppearance,
  type ResolvedIconStyle,
  type ResolvedIconVariation,
} from '@haus/icons';

export interface RenderedBrandTile {
  dataUrl: string;
  layout: 'fill' | 'inset';
}

const CACHE_LIMIT = 400;
const renderedCache = new Map<string, RenderedBrandTile>();
const inflight = new Map<string, Promise<RenderedBrandTile | null>>();

function rememberTile(key: string, value: RenderedBrandTile): RenderedBrandTile {
  if (renderedCache.has(key)) renderedCache.delete(key);
  renderedCache.set(key, value);
  while (renderedCache.size > CACHE_LIMIT) {
    const oldest = renderedCache.keys().next().value;
    if (oldest === undefined) break;
    renderedCache.delete(oldest);
  }
  return value;
}

/** Clears browser-side rendered icon tiles when the cache revision rolls over. */
export function clearRenderedBrandTileCache(): void {
  renderedCache.clear();
  inflight.clear();
}

function loadSourceImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function createCanvas2d(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

function premultiplyStraightRgba(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a === 255) {
      out[i] = data[i] ?? 0;
      out[i + 1] = data[i + 1] ?? 0;
      out[i + 2] = data[i + 2] ?? 0;
      out[i + 3] = 255;
    } else if (a > 0) {
      const k = a / 255;
      out[i] = Math.round((data[i] ?? 0) * k);
      out[i + 1] = Math.round((data[i + 1] ?? 0) * k);
      out[i + 2] = Math.round((data[i + 2] ?? 0) * k);
      out[i + 3] = a;
    }
  }
  return out;
}

function normalizeStyleArg(styleOrDark: ResolvedIconStyle | boolean): {
  appearance: IconAppearance;
  variation: ResolvedIconVariation;
  tintHex: string;
} {
  if (typeof styleOrDark === 'boolean') {
    return {
      appearance: styleOrDark ? 'dark' : 'default',
      variation: styleOrDark ? 'dark' : 'light',
      tintHex: '#0a84ff',
    };
  }
  return {
    appearance: styleOrDark.appearance,
    variation: styleOrDark.variation,
    tintHex: styleOrDark.tintHex,
  };
}

/**
 * Browser-side fallback renderer using the shared `@haus/icons` 1:1 GNOME engine
 * (used for local protocol SVGs, demo mode, direct HA connections, or older Hubs).
 */
export function renderBrandIconTile(
  src: string,
  styleOrDark: ResolvedIconStyle | boolean,
  displaySize = 44,
): Promise<RenderedBrandTile | null> {
  if (!src) return Promise.resolve(null);
  const style = normalizeStyleArg(styleOrDark);
  const pixelRatio =
    typeof window !== 'undefined'
      ? Math.min(4, Math.max(2, Math.round(window.devicePixelRatio || 2)))
      : 2;
  // Supersample with generous headroom beyond standard 2x Retina (256-320px tiles for 40-64pt UI icons).
  const targetSize = Math.max(
    256,
    Math.min(320, Math.round(displaySize * Math.max(4, pixelRatio * 2))),
  );
  const tintKey = style.appearance === 'tinted' ? style.tintHex.toLowerCase() : '-';
  const varKey = style.appearance === 'dark' ? '-' : style.variation;
  const cacheKey = `${ICON_CACHE_VERSION}:${style.appearance}:${varKey}:${tintKey}:${targetSize}:${Math.round(displaySize)}:${src}`;
  const cached = renderedCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const job = (async () => {
    try {
      const img = await loadSourceImage(src);
      if (!img) return null;
      const naturalW = img.naturalWidth || img.width || targetSize;
      const naturalH = img.naturalHeight || img.height || targetSize;
      const isSvg = src.startsWith('data:image/svg+xml') || /\.svg(?:[?#]|$)/i.test(src);
      const sampleDim = isSvg ? 512 : Math.max(1, Math.min(512, Math.max(naturalW, naturalH)));
      const sourceCanvas = createCanvas2d(sampleDim, sampleDim);
      if (!sourceCanvas) return null;

      const scale = Math.min(sampleDim / Math.max(1, naturalW), sampleDim / Math.max(1, naturalH));
      const drawW = Math.max(1, Math.round(naturalW * scale));
      const drawH = Math.max(1, Math.round(naturalH * scale));
      const offsetX = Math.floor((sampleDim - drawW) / 2);
      const offsetY = Math.floor((sampleDim - drawH) / 2);
      sourceCanvas.ctx.clearRect(0, 0, sampleDim, sampleDim);
      sourceCanvas.ctx.imageSmoothingEnabled = true;
      sourceCanvas.ctx.imageSmoothingQuality = 'high';
      sourceCanvas.ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      let sourcePixels: Uint8ClampedArray;
      try {
        sourcePixels = premultiplyStraightRgba(
          sourceCanvas.ctx.getImageData(0, 0, sampleDim, sampleDim).data,
        );
      } catch {
        return null;
      }

      const rendered = renderEnclosureTileToRgba(sourcePixels, sampleDim, sampleDim, {
        targetSize,
        displaySize,
        appearance: style.appearance,
        variation: style.variation,
        tintHex: style.tintHex,
      });

      const outCanvas = createCanvas2d(rendered.width, rendered.height);
      if (!outCanvas) return null;
      const imgData = new ImageData(
        new Uint8ClampedArray(rendered.rgba),
        rendered.width,
        rendered.height,
      );
      outCanvas.ctx.putImageData(imgData, 0, 0);
      const dataUrl = outCanvas.canvas.toDataURL('image/png');
      if (!dataUrl || dataUrl === 'data:,') return null;
      return rememberTile(cacheKey, { dataUrl, layout: rendered.layout });
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, job);
  return job;
}
