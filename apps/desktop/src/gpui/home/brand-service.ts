/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrandIconCache,
  resolveBrandIconWithMeta,
  type BrandIconHint,
  type BrandIconKind,
} from '@haus/ha/native/brand-icons';
import { resolveIconTintColor, type ResolvedIconStyle } from '@haus/icons';
import { encodePngRgba, IconRenderService } from '@haus/icons/node';
import type {
  BrandIconPort,
  BrandIconTileResult,
  BrandIconTileStyleRequest,
  RenderedBrandTile,
} from '@haus/ui/components';
import {
  applyBrandIconDropShadow,
  createGpuiBrandIconPort,
  rasterizeBrandSource,
} from '@haus/ui/gpui';

function resolveGpuiBrandCacheRoot(): string {
  const override = process.env.HAUS_ICON_CACHE_DIR?.trim();
  if (override) return override;
  try {
    const home = homedir();
    if (home) {
      if (process.platform === 'darwin') {
        return join(home, 'Library', 'Caches', 'Haus', 'brand-icons');
      }
      if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local');
        return join(localAppData, 'Haus', 'Cache', 'brand-icons');
      }
      const xdg = process.env.XDG_CACHE_HOME?.trim() || join(home, '.cache');
      return join(xdg, 'haus', 'brand-icons');
    }
  } catch {
    // Fall back to OS temp cache when home directory cannot be resolved.
  }
  return join(tmpdir(), 'haus-brand-icons');
}

let sharedRenderService: IconRenderService | null = null;
const sharedSourceCache = new BrandIconCache(1200);

/**
 * Shared desktop GPUIX `@haus/icons/node` `IconRenderService` backed by the native
 * C++20 `haus-icon-worker` (with automatic TS fallback) and persistent `VersionedIconCache`.
 */
export function getGpuiIconRenderService(): IconRenderService {
  if (!sharedRenderService) {
    const cpus = availableParallelism();
    sharedRenderService = new IconRenderService({
      cacheRoot: resolveGpuiBrandCacheRoot(),
      tileSize: 256,
      concurrency: cpus <= 4 ? 2 : 6,
      workerThreads: cpus <= 4 ? 2 : 4,
    });
  }
  return sharedRenderService;
}

/**
 * Converts SVG data URIs to high-resolution 512×512 PNG data URIs so vector protocol
 * icons (`matter`, `thread`) and SVG fallbacks flow through the exact same C++20
 * `@haus/icons/node` `IconRenderService` 4-layer pipeline and disk cache as PNG icons.
 */
async function ensureRasterPngDataUri(dataUri: string | null): Promise<string | null> {
  if (!dataUri) return null;
  if (!dataUri.startsWith('data:image/svg+xml') && !/\.svg(?:[?#]|$)/i.test(dataUri)) {
    return dataUri;
  }
  const raster = await rasterizeBrandSource(dataUri, 512);
  if (!raster) return dataUri;
  const png = encodePngRgba(raster.straightRgba, raster.width, raster.height);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function sourceKeyFor(kind: BrandIconKind, id: string, hint?: BrandIconHint): string {
  const hintKey = `${hint?.supportedBy ?? ''}:${hint?.repositoryUrl ?? ''}:${hint?.repository ?? ''}:${hint?.addonSlug ?? ''}:${hint?.addonConfigPath ?? ''}`;
  return `${kind}:${id}:${hintKey}`;
}

/**
 * Resolves a real brand logo via `@haus/ha/native/brand-icons` (or an explicit source
 * callback such as a live HA session) and renders it through `@haus/icons/node`
 * (`IconRenderService` + C++20 `haus-icon-worker` + `VersionedIconCache`).
 */
export async function resolveGpuiLocalBrandTile(
  kind: BrandIconKind,
  id: string,
  style: BrandIconTileStyleRequest,
  hint?: BrandIconHint,
  fetchSourceOverride?: () => Promise<{
    readonly dataUri: string | null;
    readonly isFallback: boolean;
  }>,
): Promise<BrandIconTileResult | null> {
  try {
    const service = getGpuiIconRenderService();
    const result = await service.resolveTile({
      source: {
        key: sourceKeyFor(kind, id, hint),
        label: hint?.name ?? id,
        fetchSource: async () => {
          const fetched = fetchSourceOverride
            ? await fetchSourceOverride()
            : await resolveBrandIconWithMeta({
                kind,
                id,
                dark: false,
                hint,
                cache: sharedSourceCache,
              });
          const rasterized = await ensureRasterPngDataUri(fetched.dataUri);
          return { dataUri: rasterized, isFallback: fetched.isFallback };
        },
      },
      appearance: style.appearance,
      variation: style.variation,
      tintHex: resolveIconTintColor(style.tintHex),
      displaySize: style.size,
    });
    if (!result.dataUri) return null;
    return {
      dataUri: result.dataUri,
      rendered: result.rendered,
      layout: result.layout,
      revision: result.revision,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a raw brand source URI via `@haus/ha/native/brand-icons` (`brands.home-assistant.io`,
 * add-on GitHub repos, npm packages, local directories, and bundled fallbacks).
 */
export async function resolveGpuiLocalBrandSource(
  kind: BrandIconKind,
  id: string,
  dark: boolean,
  hint?: BrandIconHint,
): Promise<string | null> {
  try {
    const res = await resolveBrandIconWithMeta({
      kind,
      id,
      dark,
      hint,
      cache: sharedSourceCache,
    });
    return res.dataUri;
  } catch {
    return null;
  }
}

/**
 * Renders any raw source URI (protocol SVGs like `matter`/`thread`, monograms, or HA PNGs)
 * through `@haus/icons/node` `IconRenderService` + C++20 `haus-icon-worker` + disk cache.
 */
export async function renderGpuiLocalBrandTile(
  rawSource: string,
  style: ResolvedIconStyle,
  size = 44,
): Promise<RenderedBrandTile | null> {
  if (!rawSource) return null;
  try {
    const service = getGpuiIconRenderService();
    const digest = createHash('sha256').update(rawSource).digest('hex').slice(0, 24);
    const result = await service.resolveTile({
      source: {
        key: `raw:${digest}`,
        fetchSource: async () => ({
          dataUri: await ensureRasterPngDataUri(rawSource),
          isFallback: false,
        }),
      },
      appearance: style.appearance,
      variation: style.variation,
      tintHex: resolveIconTintColor(style.tintHex),
      displaySize: size,
    });
    if (!result.rendered || !result.dataUri) return null;
    return { dataUrl: result.dataUri, layout: result.layout };
  } catch {
    return null;
  }
}

/**
 * Standalone GPUIX `BrandIconPort` powered by `@haus/icons/node` (`IconRenderService` +
 * C++20 `haus-icon-worker`) and `@haus/ha/native/brand-icons` — used in demo/offline mode
 * and as fallback when a Hub does not supply pre-rendered tiles.
 */
export function createGpuiStandaloneBrandIconPort(): BrandIconPort {
  return createGpuiBrandIconPort({
    resolveTile: (kind, id, style, hint) => resolveGpuiLocalBrandTile(kind, id, style, hint),
    resolveSource: (kind, id, dark, hint) => resolveGpuiLocalBrandSource(kind, id, dark, hint),
    renderLocalTile: renderGpuiLocalBrandTile,
    applyTileShadow: applyBrandIconDropShadow,
  });
}
