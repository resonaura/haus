/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useSyncExternalStore } from 'react';
import { ICON_CACHE_VERSION } from '@haus/icons';
import type { BrandIconHint, BrandIconKind } from '../../../../shared/native';
import { clearRenderedBrandTileCache, type RenderedBrandTile } from './engine/render';

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

const RESOLVED_TILE_CACHE_MAX = 800;

export const resolvedTileCache = new Map<string, RenderedBrandTile>();
export const inflightTiles = new Map<string, Promise<RenderedBrandTile | null>>();

let observedHubRevision: string | null = null;
let cacheEpoch = 0;
let activeVersionToken = ICON_CACHE_VERSION;
const listeners = new Set<() => void>();
let unsubscribeNative: (() => void) | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function buildVersionToken(hubRevision: string | null, epoch: number): string {
  return hubRevision ? `${ICON_CACHE_VERSION}:${hubRevision}` : `${ICON_CACHE_VERSION}:e${epoch}`;
}

export function getBrandIconCacheEpoch(): number {
  return cacheEpoch;
}

export function getBrandIconCacheVersion(): string {
  return activeVersionToken;
}

/**
 * Purges all renderer-side brand icon caches and bumps the reactive cache version
 * so every mounted `<BrandIcon>` re-fetches fresh tiles immediately.
 */
export function invalidateBrandIconCache(nextHubRevision?: string): void {
  const clean = nextHubRevision?.trim() || null;
  resolvedTileCache.clear();
  inflightTiles.clear();
  clearRenderedBrandTileCache();
  observedHubRevision = clean;
  cacheEpoch += 1;
  activeVersionToken = buildVersionToken(clean, cacheEpoch);
  notify();
}

/**
 * Tracks the Hub's reported tile revision on every response.
 * - First Hub revision establishes the baseline without causing redundant reloads.
 * - Any subsequent revision change immediately purges stale tiles from memory and
 *   triggers live in-place refresh across all mounted `<BrandIcon>` instances.
 */
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

export function rememberResolvedTile(key: string, tile: RenderedBrandTile, epoch: number): void {
  if (epoch !== cacheEpoch) return;
  if (resolvedTileCache.has(key)) resolvedTileCache.delete(key);
  resolvedTileCache.set(key, tile);
  while (resolvedTileCache.size > RESOLVED_TILE_CACHE_MAX) {
    const oldest = resolvedTileCache.keys().next().value;
    if (oldest === undefined) break;
    resolvedTileCache.delete(oldest);
  }
}

function ensureNativeSubscription(): void {
  if (unsubscribeNative || typeof window === 'undefined' || !window.hausNative?.onEvent) return;
  unsubscribeNative = window.hausNative.onEvent((event) => {
    if (event.type === 'brand-icons-invalidated') {
      invalidateBrandIconCache(event.version);
    } else if (event.type === 'connection' && event.status === 'disconnected') {
      invalidateBrandIconCache();
    }
  });
}

function subscribe(listener: () => void): () => void {
  ensureNativeSubscription();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive icon cache version token shared across all mounted `<BrandIcon>` instances. */
export function useBrandIconCacheVersion(): string {
  return useSyncExternalStore(subscribe, getBrandIconCacheVersion, getBrandIconCacheVersion);
}

/** Resets singleton cache state cleanly for unit tests. */
export function resetBrandIconCacheForTesting(): void {
  unsubscribeNative?.();
  unsubscribeNative = null;
  listeners.clear();
  resolvedTileCache.clear();
  inflightTiles.clear();
  clearRenderedBrandTileCache();
  observedHubRevision = null;
  cacheEpoch = 0;
  activeVersionToken = ICON_CACHE_VERSION;
}
