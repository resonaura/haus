/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useSyncExternalStore } from 'react';
import {
  buildUnifiedPlaceholderSvgUri,
  ICON_CACHE_VERSION,
  type PlaceholderGlyphKind,
  type ResolvedIconStyle,
} from '@haus/icons';
import type { BrandIconHint, BrandIconKind, RenderedBrandTile } from './types.js';

function monogramLetters(label: string): string {
  const clean = label
    .replace(/^hassio_?/i, '')
    .replace(/[_./:-]+/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  const single = (words[0] ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (single.length >= 2) return single.slice(0, 2).toUpperCase();
  if (single.length === 1) return single.toUpperCase();
  return 'H';
}

function hashHue(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

export function buildMonogramBadgeSvgUri(
  kind: BrandIconKind,
  id: string,
  hint?: BrandIconHint,
): string {
  const letters = monogramLetters(hint?.name || id).replace(/[<>&"']/g, '');
  const hue = hashHue(`${kind}:${id}`);
  const hueAlt = (hue + 24) % 360;
  const fontSize = letters.length > 1 ? 104 : 124;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue} 68% 52%)"/>` +
    `<stop offset="100%" stop-color="hsl(${hueAlt} 72% 38%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="256" height="256" fill="url(#b)"/>` +
    `<text x="128" y="132" text-anchor="middle" dominant-baseline="central" ` +
    `fill="#ffffff" font-family="ui-sans-serif, system-ui, sans-serif" ` +
    `font-weight="700" font-size="${fontSize}" letter-spacing="-2">${letters}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function placeholderGlyphKindForBrand(kind: BrandIconKind): PlaceholderGlyphKind {
  if (kind === 'addon' || kind === 'app') return 'addon';
  if (kind === 'hacs' || kind === 'homebridge' || kind === 'scrypted' || kind === 'plugin') {
    return 'plugin';
  }
  return 'integration';
}

const RESOLVED_TILE_CACHE_MAX = 800;
const PLACEHOLDER_CACHE_MAX = 64;
const MAX_CONCURRENT_TILE_LOADS = 8;

export const resolvedBrandTileCache = new Map<string, RenderedBrandTile>();
export const inflightBrandTiles = new Map<string, Promise<RenderedBrandTile | null>>();
const placeholderCache = new Map<string, string>();

let observedHubRevision: string | null = null;
let cacheEpoch = 0;
let activeVersionToken = ICON_CACHE_VERSION;
const listeners = new Set<() => void>();
const extraClearHooks = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function buildVersionToken(hubRevision: string | null, epoch: number): string {
  return hubRevision ? `${ICON_CACHE_VERSION}:${hubRevision}` : `${ICON_CACHE_VERSION}:e${epoch}`;
}

export function registerBrandTileCacheClearHook(hook: () => void): () => void {
  extraClearHooks.add(hook);
  return () => {
    extraClearHooks.delete(hook);
  };
}

export function getBrandIconCacheEpoch(): number {
  return cacheEpoch;
}

export function getBrandIconCacheVersion(): string {
  return activeVersionToken;
}

export function invalidateBrandIconCache(nextHubRevision?: string): void {
  const clean = nextHubRevision?.trim() || null;
  resolvedBrandTileCache.clear();
  inflightBrandTiles.clear();
  for (const hook of extraClearHooks) hook();
  observedHubRevision = clean;
  cacheEpoch += 1;
  activeVersionToken = buildVersionToken(clean, cacheEpoch);
  notify();
}

export function reconcileHubBrandIconRevision(revision?: string): boolean {
  const clean = revision?.trim();
  if (!clean) return false;
  if (observedHubRevision === null) {
    observedHubRevision = clean;
    return false;
  }
  if (observedHubRevision === clean) return false;
  invalidateBrandIconCache(clean);
  return true;
}

export function rememberResolvedBrandTile(
  key: string,
  tile: RenderedBrandTile,
  epoch: number,
): void {
  if (epoch !== cacheEpoch) return;
  if (resolvedBrandTileCache.has(key)) resolvedBrandTileCache.delete(key);
  resolvedBrandTileCache.set(key, tile);
  while (resolvedBrandTileCache.size > RESOLVED_TILE_CACHE_MAX) {
    const oldest = resolvedBrandTileCache.keys().next().value;
    if (oldest === undefined) break;
    resolvedBrandTileCache.delete(oldest);
  }
}

export function getBrandPlaceholderUri(
  glyphKind: PlaceholderGlyphKind,
  style: ResolvedIconStyle,
): string {
  const key = `${glyphKind}:${style.appearance}:${style.variation}:${style.appearance === 'tinted' ? style.tintHex : '-'}`;
  const hit = placeholderCache.get(key);
  if (hit) return hit;
  const uri = buildUnifiedPlaceholderSvgUri(glyphKind, style);
  placeholderCache.set(key, uri);
  if (placeholderCache.size > PLACEHOLDER_CACHE_MAX) {
    const oldest = placeholderCache.keys().next().value;
    if (oldest !== undefined) placeholderCache.delete(oldest);
  }
  return uri;
}

interface QueuedLoad {
  cancelled: boolean;
  start: () => Promise<void>;
}

const pendingQueue: QueuedLoad[] = [];
let activeTileLoads = 0;

function drainTileQueue(): void {
  while (activeTileLoads < MAX_CONCURRENT_TILE_LOADS && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (!next || next.cancelled) continue;
    activeTileLoads += 1;
    void next.start().finally(() => {
      activeTileLoads = Math.max(0, activeTileLoads - 1);
      drainTileQueue();
    });
  }
}

export function scheduleBrandTileLoad(task: () => Promise<void>): () => void {
  const entry: QueuedLoad = { cancelled: false, start: task };
  pendingQueue.push(entry);
  drainTileQueue();
  return () => {
    entry.cancelled = true;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBrandIconCacheVersion(): string {
  return useSyncExternalStore(subscribe, getBrandIconCacheVersion, getBrandIconCacheVersion);
}

export function resetBrandIconCacheForTesting(): void {
  listeners.clear();
  resolvedBrandTileCache.clear();
  inflightBrandTiles.clear();
  placeholderCache.clear();
  for (const hook of extraClearHooks) hook();
  observedHubRevision = null;
  cacheEpoch = 0;
  activeVersionToken = ICON_CACHE_VERSION;
}
