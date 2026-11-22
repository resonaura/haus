/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ICON_APPEARANCES,
  ICON_CACHE_FORMAT,
  ICON_ENGINE_REVISION,
  ICON_TINT_COLORS,
  ICON_VARIATIONS,
  UNIFIED_ICON_SQUIRCLE_PATH,
  buildUnifiedPlaceholderSvgUri,
  compositeSemanticPresentation,
  premultipliedIconPixels,
  renderAllBaseLayers,
  renderEnclosureTileToRgba,
  resolveEffectiveColorPresentation,
  resolveIconStyle,
  sanitizeIconStyle,
} from '../src/index.js';
import {
  IconRenderService,
  NativeIconWorkerPool,
  VersionedIconCache,
  decodePngRgba,
  encodePngRgba,
  straightToPremultipliedRgba,
} from '../src/node/index.js';

function makeTestIconRgba(size: number, bg: readonly [number, number, number] | null): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.28;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (x + y * size) * 4;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r) {
        rgba[idx] = 250;
        rgba[idx + 1] = 250;
        rgba[idx + 2] = 255;
        rgba[idx + 3] = 255;
      } else if (bg) {
        rgba[idx] = bg[0];
        rgba[idx + 1] = bg[1];
        rgba[idx + 2] = bg[2];
        rgba[idx + 3] = 255;
      }
    }
  }
  return rgba;
}

describe('@haus/icons', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes 1:1 GNOME icon appearance, variation, and tint metadata', () => {
    expect(ICON_CACHE_FORMAT).toBe(3);
    expect(ICON_APPEARANCES.map((a) => a.value)).toEqual(['default', 'dark', 'clear', 'tinted']);
    expect(ICON_VARIATIONS.map((v) => v.value)).toEqual(['auto', 'light', 'dark']);
    expect(ICON_TINT_COLORS.map((c) => c.value)).toEqual([
      'automatic',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'graphite',
    ]);
    expect(
      sanitizeIconStyle({ appearance: 'tinted', variation: 'dark', tintColor: 'purple' }),
    ).toEqual({
      appearance: 'tinted',
      variation: 'dark',
      tintColor: 'purple',
    });
    expect(resolveIconStyle({ appearance: 'clear', variation: 'auto' }, true)).toMatchObject({
      appearance: 'clear',
      variation: 'dark',
    });
    expect(UNIFIED_ICON_SQUIRCLE_PATH).toContain('M');
    const placeholder = buildUnifiedPlaceholderSvgUri(
      'integration',
      resolveIconStyle({ appearance: 'tinted', variation: 'dark', tintColor: 'orange' }, true),
    );
    expect(placeholder.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  });

  it('round-trips RGBA PNG encoding/decoding losslessly', () => {
    const src = makeTestIconRgba(64, [20, 120, 235]);
    const png = encodePngRgba(src, 64, 64);
    const decoded = decodePngRgba(png);
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(src))).toBe(true);
  });

  it('renders all 4 GNOME appearances (default, dark, clear, tinted) cleanly in TS engine', () => {
    const src = premultipliedIconPixels(
      new Uint8ClampedArray(makeTestIconRgba(96, [20, 120, 235])),
    );
    const base = renderAllBaseLayers(src, 96, 96, { targetSize: 96 });
    expect(base.width).toBe(96);
    expect(base.defaultRgba[3]).toBe(0);
    expect(base.defaultRgba[(48 + 48 * 96) * 4 + 3]).toBe(255);
    expect(base.darkRgba[(48 + 48 * 96) * 4 + 3]).toBe(255);

    const clearLight = compositeSemanticPresentation(base.clearSemanticRgba, 96, 96, {
      appearance: 'clear',
      variation: 'light',
    });
    const clearDark = compositeSemanticPresentation(base.clearSemanticRgba, 96, 96, {
      appearance: 'clear',
      variation: 'dark',
    });
    const tintedLight = compositeSemanticPresentation(base.tintedSemanticRgba, 96, 96, {
      appearance: 'tinted',
      variation: 'light',
      tintHex: '#ff453a',
    });
    const tintedDark = compositeSemanticPresentation(base.tintedSemanticRgba, 96, 96, {
      appearance: 'tinted',
      variation: 'dark',
      tintHex: '#32d74b',
    });

    // Clear corners transparent, center visible; Clear Light brighter than Clear Dark.
    expect(clearLight[3]).toBe(0);
    expect(clearDark[3]).toBe(0);
    const sampleIdx = (24 + 24 * 96) * 4;
    expect(clearLight[sampleIdx]!).toBeGreaterThan(clearDark[sampleIdx]!);
    // Tinted Light plate is red-dominant; Tinted Dark plate is dark neutral with green glyph.
    expect(tintedLight[sampleIdx]!).toBeGreaterThan(tintedLight[sampleIdx + 2]! + 80);
    expect(tintedDark[sampleIdx]!).toBeLessThan(60);

    const directClear = renderEnclosureTileToRgba(src, 96, 96, {
      targetSize: 96,
      appearance: 'clear',
      variation: 'dark',
    });
    expect(directClear.rgba[(48 + 48 * 96) * 4 + 3]).toBeGreaterThan(150);
  });

  it('maintains GNOME versioned cache namespace with 1-generation rollback retention', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-icons-cache-'));
    tempDirs.push(root);

    // Seed three older generations with distinct mtimes.
    mkdirSync(join(root, 'v3-old-1'), { recursive: true });
    mkdirSync(join(root, 'v3-old-2'), { recursive: true });
    mkdirSync(join(root, 'v3-old-3'), { recursive: true });
    const cache = new VersionedIconCache(root, { revision: 'current-v4' });
    expect(existsSync(cache.namespaceDir)).toBe(true);
    const remainingOld = ['v3-old-1', 'v3-old-2', 'v3-old-3'].filter((d) =>
      existsSync(join(root, d)),
    );
    expect(remainingOld.length).toBe(1);
    await cache.flushIndex();
  });

  it('runs persistent C++20 worker and IconRenderService background queue with cache reuse', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-icons-svc-'));
    tempDirs.push(root);

    const worker = new NativeIconWorkerPool({ threads: 4 });
    const srcStraight = makeTestIconRgba(128, [16, 118, 232]);
    const srcPremul = straightToPremultipliedRgba(srcStraight);

    const t0 = performance.now();
    const batch = await Promise.all(
      Array.from({ length: 16 }, () => worker.renderAllBase(srcPremul, 128, 128, 128)),
    );
    const elapsedMs = performance.now() - t0;
    expect(batch[0]!.engine).toBe('cpp');
    expect(batch[0]!.segmented).toBe(true);
    expect(batch[0]!.defaultRgba[(64 + 64 * 128) * 4 + 3]).toBe(255);
    expect(elapsedMs).toBeLessThan(2000);
    worker.dispose();

    const pngDataUri = `data:image/png;base64,${encodePngRgba(srcStraight, 128, 128).toString('base64')}`;
    let fetches = 0;
    const service = new IconRenderService({
      cacheRoot: root,
      revision: 'test-rev-1',
      tileSize: 96,
      concurrency: 2,
    });
    await service.init();

    const r1 = await service.resolveTile({
      source: {
        key: 'integration:hue',
        fetchSource: async () => {
          fetches += 1;
          return { dataUri: pngDataUri, isFallback: false };
        },
      },
      appearance: 'tinted',
      variation: 'dark',
      tintHex: '#bf5af2',
    });
    expect(r1.rendered).toBe(true);
    expect(r1.dataUri?.startsWith('data:image/png;base64,')).toBe(true);
    expect(fetches).toBe(1);

    // Switching appearance to Clear Light reuses cached semantic layers with ZERO re-fetch!
    const r2 = await service.resolveTile({
      source: {
        key: 'integration:hue',
        fetchSource: async () => {
          fetches += 1;
          return { dataUri: pngDataUri, isFallback: false };
        },
      },
      appearance: 'clear',
      variation: 'light',
      tintHex: '#0a84ff',
    });
    expect(r2.rendered).toBe(true);
    expect(r2.cacheHit).toBe(true);
    expect(fetches).toBe(1);

    // Bumping revision re-renders from raw disk source cache WITHOUT refetching upstream!
    await service.dispose();
    const serviceV2 = new IconRenderService({
      cacheRoot: root,
      revision: 'test-rev-2',
      tileSize: 96,
      concurrency: 2,
    });
    await serviceV2.init();
    const r3 = await serviceV2.resolveTile({
      source: {
        key: 'integration:hue',
        fetchSource: async () => {
          fetches += 1;
          return { dataUri: pngDataUri, isFallback: false };
        },
      },
      appearance: 'dark',
      variation: 'dark',
      tintHex: '#0a84ff',
    });
    expect(r3.rendered).toBe(true);
    expect(r3.revision).toBe('v3-test-rev-2');
    expect(fetches).toBe(1);

    // Default appearance follows system light/dark variation (`auto` -> dark in dark theme).
    const rDefaultDark = await serviceV2.resolveTile({
      source: {
        key: 'integration:hue',
        fetchSource: async () => ({ dataUri: pngDataUri, isFallback: false }),
      },
      appearance: 'default',
      variation: 'dark',
      tintHex: '#0a84ff',
    });
    const rDefaultLight = await serviceV2.resolveTile({
      source: {
        key: 'integration:hue',
        fetchSource: async () => ({ dataUri: pngDataUri, isFallback: false }),
      },
      appearance: 'default',
      variation: 'light',
      tintHex: '#0a84ff',
    });
    expect(rDefaultDark.dataUri).toBe(r3.dataUri);
    expect(rDefaultLight.dataUri).not.toBe(rDefaultDark.dataUri);
    await serviceV2.dispose();
  });

  it('follows system light/dark for Default appearance and renders sharp 256px tiles', async () => {
    expect(ICON_ENGINE_REVISION).toBe('gnome-v2');
    expect(resolveEffectiveColorPresentation('default', 'dark')).toBe('dark');
    expect(resolveEffectiveColorPresentation('default', 'light')).toBe('default');
    expect(resolveEffectiveColorPresentation('dark', 'light')).toBe('dark');

    const darkPh = buildUnifiedPlaceholderSvgUri(
      'integration',
      resolveIconStyle({ appearance: 'default', variation: 'auto' }, true),
    );
    const lightPh = buildUnifiedPlaceholderSvgUri(
      'integration',
      resolveIconStyle({ appearance: 'default', variation: 'auto' }, false),
    );
    expect(decodeURIComponent(darkPh)).toContain('#1f1f1f');
    expect(decodeURIComponent(lightPh)).toContain('#ffffff');

    const srcStraight = makeTestIconRgba(256, null);
    const srcPremul = straightToPremultipliedRgba(srcStraight);
    const worker = new NativeIconWorkerPool({ threads: 2 });
    const out = await worker.renderAllBase(srcPremul, 256, 256, 256);
    worker.dispose();
    expect(out.width).toBe(256);
    expect(out.height).toBe(256);
    expect(out.engine).toBe('cpp');
    // Interior pixels of the 256px dark plate stay dark while light plate stays bright.
    const cornerPlateIdx = (32 + 32 * 256) * 4;
    expect(out.defaultRgba[cornerPlateIdx]!).toBeGreaterThan(220);
    expect(out.darkRgba[cornerPlateIdx]!).toBeLessThan(60);
  });
});
