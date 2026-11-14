/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { renderEnclosureTileToRgba } from './enclosure';

export interface RenderedBrandTile {
  dataUrl: string;
  layout: 'fill' | 'inset';
}

const CACHE_LIMIT = 300;
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

/**
 * Decodes a data URI or image URL on a bounded canvas, applies the complete
 * segmentation, 6-pass contour lighting, continuous-corner supercircle SDF, and
 * optical rim highlight pipeline, and returns a PNG data URI + layout hint.
 */
export function renderBrandIconTile(
  src: string,
  dark: boolean,
  displaySize = 40,
): Promise<RenderedBrandTile | null> {
  if (!src) return Promise.resolve(null);
  const pixelRatio =
    typeof window !== 'undefined'
      ? Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 2)))
      : 2;
  const targetSize = Math.max(32, Math.min(128, Math.round(displaySize * pixelRatio)));
  const cacheKey = `${dark ? 'dark' : 'light'}:${targetSize}:${src}`;
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
      const sampleDim = Math.max(32, Math.min(128, Math.max(naturalW, naturalH)));
      const sourceCanvas = createCanvas2d(sampleDim, sampleDim);
      if (!sourceCanvas) return null;

      const scale = Math.min(sampleDim / Math.max(1, naturalW), sampleDim / Math.max(1, naturalH));
      const drawW = Math.max(1, Math.round(naturalW * scale));
      const drawH = Math.max(1, Math.round(naturalH * scale));
      const offsetX = Math.floor((sampleDim - drawW) / 2);
      const offsetY = Math.floor((sampleDim - drawH) / 2);
      sourceCanvas.ctx.clearRect(0, 0, sampleDim, sampleDim);
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
        appearance: dark ? 'dark' : 'default',
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
