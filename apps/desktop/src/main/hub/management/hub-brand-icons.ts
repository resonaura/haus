/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BrandIconCache,
  resolveCoreBrandIcon,
  validateBrandIconInput,
  type BrandIconHint,
} from '@haus/core/brands';
import { isIconAppearance, resolveIconTintColor } from '@haus/icons';
import type { BrandIconTileResult, BrandIconTileStyle, NativeEvent } from '../../../shared/native';

export type { BrandIconHint };

type HubApiGet = (path: string) => Promise<unknown>;
type NativeEmit = (event: NativeEvent) => void;

const DATA_URI_RE = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

const connectionCaches = new WeakMap<object, BrandIconCache>();
const renderedTileCaches = new WeakMap<object, Map<string, BrandIconTileResult>>();
const connectionVersions = new WeakMap<object, string>();
const connectionEpochs = new WeakMap<object, number>();
const RENDERED_TILE_CACHE_MAX = 800;

function getCache(owner: object): BrandIconCache {
  let cache = connectionCaches.get(owner);
  if (!cache) {
    cache = new BrandIconCache(600);
    connectionCaches.set(owner, cache);
  }
  return cache;
}

function getRenderedCache(owner: object): Map<string, BrandIconTileResult> {
  let cache = renderedTileCaches.get(owner);
  if (!cache) {
    cache = new Map<string, BrandIconTileResult>();
    renderedTileCaches.set(owner, cache);
  }
  return cache;
}

function getEpoch(owner: object): number {
  return connectionEpochs.get(owner) ?? 0;
}

function bumpEpoch(owner: object): number {
  const next = getEpoch(owner) + 1;
  connectionEpochs.set(owner, next);
  return next;
}

/**
 * Synchronizes the tracked Hub icon cache version for a connection owner.
 * Whenever the Hub reports a new version (after an upgrade, C++ worker rebuild,
 * or engine revision bump), all main-process caches for that connection are
 * purged immediately and the renderer is notified to invalidate and re-fetch.
 */
export function syncHubBrandIconVersion(
  owner: object,
  version: string,
  emit?: NativeEmit,
): boolean {
  const clean = version.trim();
  if (!clean) return false;
  const previous = connectionVersions.get(owner);
  if (previous === clean) return false;

  const rendered = renderedTileCaches.get(owner);
  const hadCached = Boolean(rendered && rendered.size > 0);
  connectionVersions.set(owner, clean);
  if (previous !== undefined || hadCached) {
    rendered?.clear();
    connectionCaches.get(owner)?.clear();
    bumpEpoch(owner);
    emit?.({ type: 'brand-icons-invalidated', version: clean });
    return true;
  }
  return false;
}

/** Clears all main-process brand icon caches for a connection (e.g. on disconnect or home switch). */
export function clearHubBrandIconCaches(owner: object, emit?: NativeEmit): void {
  renderedTileCaches.get(owner)?.clear();
  connectionCaches.get(owner)?.clear();
  connectionVersions.delete(owner);
  bumpEpoch(owner);
  emit?.({ type: 'brand-icons-invalidated', version: '' });
}

/** Probes `/api/brands/status` on connect/reconnect to detect Hub icon cache rollovers immediately. */
export async function probeHubBrandIconVersion(
  owner: object,
  apiGet: HubApiGet,
  emit?: NativeEmit,
): Promise<string | null> {
  try {
    const res = (await apiGet('/api/brands/status')) as { version?: unknown } | null;
    if (res && typeof res.version === 'string' && res.version.trim()) {
      syncHubBrandIconVersion(owner, res.version, emit);
      return res.version.trim();
    }
  } catch {
    // Older Hubs without /api/brands/status fall through cleanly.
  }
  return null;
}

function rememberRendered(
  cache: Map<string, BrandIconTileResult>,
  key: string,
  value: BrandIconTileResult,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > RENDERED_TILE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cleanHintString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLen ? trimmed : undefined;
}

export function sanitizeBrandIconHint(raw: unknown): BrandIconHint | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const name = cleanHintString(rec.name, 120);
  const supportedBy = cleanHintString(rec.supportedBy, 100);
  const repositoryUrl = cleanHintString(rec.repositoryUrl, 240);
  const repository = cleanHintString(rec.repository, 160);
  const category = cleanHintString(rec.category, 64);
  const addonSlug = cleanHintString(rec.addonSlug, 120);
  const addonConfigPath = cleanHintString(rec.addonConfigPath, 160);
  if (
    !name &&
    !supportedBy &&
    !repositoryUrl &&
    !repository &&
    !category &&
    !addonSlug &&
    !addonConfigPath
  ) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(supportedBy ? { supportedBy } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(repository ? { repository } : {}),
    ...(category ? { category } : {}),
    ...(addonSlug ? { addonSlug } : {}),
    ...(addonConfigPath ? { addonConfigPath } : {}),
  };
}

export function sanitizeBrandIconTileStyle(raw: unknown): BrandIconTileStyle {
  const rec =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const appearance = isIconAppearance(rec.appearance) ? rec.appearance : 'default';
  const variation = rec.variation === 'dark' ? 'dark' : 'light';
  const tintHex = resolveIconTintColor(typeof rec.tintHex === 'string' ? rec.tintHex : '#0a84ff');
  const sizeNum = Number(rec.size);
  const size =
    Number.isFinite(sizeNum) && sizeNum >= 16 && sizeNum <= 256 ? Math.round(sizeNum) : 44;
  return { appearance, variation, tintHex, size };
}

function appendHintParams(params: URLSearchParams, hint: BrandIconHint | undefined): void {
  if (!hint) return;
  if (hint.name) params.set('name', hint.name);
  if (hint.supportedBy) params.set('supportedBy', hint.supportedBy);
  if (hint.repositoryUrl) params.set('repositoryUrl', hint.repositoryUrl);
  if (hint.repository) params.set('repository', hint.repository);
  if (hint.category) params.set('category', hint.category);
  if (hint.addonSlug) params.set('addonSlug', hint.addonSlug);
  if (hint.addonConfigPath) params.set('addonConfigPath', hint.addonConfigPath);
}

/** Resolves a brand icon through Hub `/api/brands/icon` with automatic local fallback for older Hubs. */
export async function resolveHubBrandIcon(
  owner: object,
  apiGet: HubApiGet,
  kind: unknown,
  id: unknown,
  dark = false,
  rawHint?: unknown,
): Promise<string | null> {
  const valid = validateBrandIconInput(kind, id);
  const hint = sanitizeBrandIconHint(rawHint);
  const cache = getCache(owner);
  const hintKey = `${hint?.supportedBy ?? ''}:${hint?.repositoryUrl ?? ''}:${hint?.repository ?? ''}:${hint?.addonSlug ?? ''}:${hint?.addonConfigPath ?? ''}`;
  const cacheKey = `hub:${valid.kind}:${valid.id}:${dark ? 'dark' : 'light'}:${hintKey}`;

  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    kind: valid.kind,
    id: valid.id,
    dark: dark ? '1' : '0',
  });
  appendHintParams(params, hint);

  try {
    const res = (await apiGet(`/api/brands/icon?${params.toString()}`)) as {
      dataUri?: unknown;
    } | null;
    if (res && typeof res.dataUri === 'string' && DATA_URI_RE.test(res.dataUri)) {
      const isSvgFallback = res.dataUri.startsWith('data:image/svg+xml;');
      cache.set(cacheKey, res.dataUri, isSvgFallback);
      return res.dataUri;
    }
  } catch {
    // Older Hubs without /api/brands/icon fall through cleanly to direct resolution
  }

  return resolveCoreBrandIcon({
    kind: valid.kind,
    id: valid.id,
    dark,
    hint,
    cache,
  });
}

/**
 * Resolves a pre-rendered, versioned 1:1 GNOME tile PNG directly from the Hub
 * (`/api/brands/icon?appearance=...&variation=...&tint=...`), falling back to
 * unrendered source resolution if the connected Hub predates server-side rendering.
 */
export async function resolveHubBrandIconTile(
  owner: object,
  apiGet: HubApiGet,
  kind: unknown,
  id: unknown,
  rawStyle: unknown,
  rawHint?: unknown,
  emit?: NativeEmit,
): Promise<BrandIconTileResult | null> {
  const valid = validateBrandIconInput(kind, id);
  const style = sanitizeBrandIconTileStyle(rawStyle);
  const hint = sanitizeBrandIconHint(rawHint);
  const hintKey = `${hint?.supportedBy ?? ''}:${hint?.repositoryUrl ?? ''}:${hint?.repository ?? ''}:${hint?.addonSlug ?? ''}:${hint?.addonConfigPath ?? ''}`;
  const tileSuffix = `tile:${valid.kind}:${valid.id}:${style.appearance}:${style.variation}:${style.appearance === 'tinted' ? style.tintHex : '-'}:${hintKey}`;
  const startEpoch = getEpoch(owner);
  const startVersion = connectionVersions.get(owner) ?? '';
  const tileKey = `${startVersion}:${tileSuffix}`;
  const renderedCache = getRenderedCache(owner);
  const hit = renderedCache.get(tileKey);
  if (hit) {
    renderedCache.delete(tileKey);
    renderedCache.set(tileKey, hit);
    return hit;
  }

  const params = new URLSearchParams({
    kind: valid.kind,
    id: valid.id,
    dark: style.appearance === 'dark' || style.variation === 'dark' ? '1' : '0',
    appearance: style.appearance,
    variation: style.variation,
    tint: style.tintHex ?? '#0a84ff',
    size: String(style.size ?? 44),
  });
  appendHintParams(params, hint);

  try {
    const res = (await apiGet(`/api/brands/icon?${params.toString()}`)) as {
      dataUri?: unknown;
      rendered?: unknown;
      layout?: unknown;
      revision?: unknown;
    } | null;
    if (res && typeof res.dataUri === 'string' && DATA_URI_RE.test(res.dataUri)) {
      const revision =
        typeof res.revision === 'string' && res.revision.trim() ? res.revision.trim() : undefined;
      const rendered = res.rendered === true;
      const result: BrandIconTileResult = {
        dataUri: res.dataUri,
        rendered,
        layout: res.layout === 'fill' ? 'fill' : 'inset',
        ...(revision ? { revision } : {}),
      };
      if (revision) {
        syncHubBrandIconVersion(owner, revision, emit);
      }
      const currentVersion = connectionVersions.get(owner) ?? '';
      const stillCurrent =
        revision !== undefined ? currentVersion === revision : getEpoch(owner) === startEpoch;
      if (stillCurrent && (rendered || !res.dataUri.startsWith('data:image/svg+xml;'))) {
        rememberRendered(renderedCache, `${currentVersion}:${tileSuffix}`, result);
      }
      return result;
    }
  } catch {
    // Fall back cleanly to direct unrendered source resolution.
  }

  const fallbackSource = await resolveCoreBrandIcon({
    kind: valid.kind,
    id: valid.id,
    dark:
      style.appearance === 'dark' || (style.appearance === 'default' && style.variation === 'dark'),
    hint,
    cache: getCache(owner),
  });
  return fallbackSource ? { dataUri: fallbackSource, rendered: false } : null;
}

/** Composed Hub brand-icon client keeping connection cache versioning self-contained. */
export class HubBrandIconsClient {
  constructor(
    private readonly apiGet: HubApiGet,
    private readonly emit: NativeEmit,
  ) {}

  resolve(kind: unknown, id: unknown, dark = false, hint?: unknown): Promise<string | null> {
    return resolveHubBrandIcon(this, this.apiGet, kind, id, dark, hint);
  }

  resolveTile(
    kind: unknown,
    id: unknown,
    style: unknown,
    hint?: unknown,
  ): Promise<BrandIconTileResult | null> {
    return resolveHubBrandIconTile(this, this.apiGet, kind, id, style, hint, this.emit);
  }

  probeVersion(): void {
    void probeHubBrandIconVersion(this, this.apiGet, this.emit);
  }

  clear(): void {
    clearHubBrandIconCaches(this, this.emit);
  }
}
