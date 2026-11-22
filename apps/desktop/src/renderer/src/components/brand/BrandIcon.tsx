/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildUnifiedPlaceholderSvgUri,
  type PlaceholderGlyphKind,
  type ResolvedIconStyle,
} from '@haus/icons';
import type { BrandIconHint, BrandIconKind } from '../../../../shared/native';
import { protocolArtwork } from '../../model/brand-vectors';
import { renderBrandIconTile, type RenderedBrandTile } from './engine/render';
import { useIconStyle } from './useIconStyle';

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

function buildMonogramBadgeSvgUri(kind: BrandIconKind, id: string, hint?: BrandIconHint): string {
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

function placeholderGlyphKind(kind: BrandIconKind): PlaceholderGlyphKind {
  if (kind === 'addon' || kind === 'app') return 'addon';
  if (kind === 'hacs' || kind === 'homebridge' || kind === 'scrypted' || kind === 'plugin') {
    return 'plugin';
  }
  return 'integration';
}

const RESOLVED_TILE_CACHE_MAX = 800;
const MAX_CONCURRENT_TILE_LOADS = 8;

const resolvedTileCache = new Map<string, RenderedBrandTile>();
const inflightTiles = new Map<string, Promise<RenderedBrandTile | null>>();
const placeholderCache = new Map<string, string>();

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

function scheduleTileLoad(task: () => Promise<void>): () => void {
  const entry: QueuedLoad = { cancelled: false, start: task };
  pendingQueue.push(entry);
  drainTileQueue();
  return () => {
    entry.cancelled = true;
  };
}

let sharedVisibilityObserver: IntersectionObserver | null = null;
const visibilityCallbacks = new WeakMap<Element, () => void>();

function getVisibilityObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!sharedVisibilityObserver) {
    sharedVisibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = visibilityCallbacks.get(entry.target);
          if (callback) {
            visibilityCallbacks.delete(entry.target);
            sharedVisibilityObserver?.unobserve(entry.target);
            callback();
          }
        }
      },
      { rootMargin: '280px 0px' },
    );
  }
  return sharedVisibilityObserver;
}

function observeIconVisibility(element: Element, onVisible: () => void): () => void {
  const observer = getVisibilityObserver();
  if (!observer) {
    onVisible();
    return () => {};
  }
  visibilityCallbacks.set(element, onVisible);
  observer.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    observer.unobserve(element);
  };
}

function getPlaceholderUri(glyphKind: PlaceholderGlyphKind, style: ResolvedIconStyle): string {
  const key = `${glyphKind}:${style.appearance}:${style.variation}:${style.appearance === 'tinted' ? style.tintHex : '-'}`;
  const hit = placeholderCache.get(key);
  if (hit) return hit;
  const uri = buildUnifiedPlaceholderSvgUri(glyphKind, style);
  placeholderCache.set(key, uri);
  if (placeholderCache.size > 64) {
    const oldest = placeholderCache.keys().next().value;
    if (oldest !== undefined) placeholderCache.delete(oldest);
  }
  return uri;
}

function rememberResolvedTile(key: string, tile: RenderedBrandTile): void {
  if (resolvedTileCache.has(key)) resolvedTileCache.delete(key);
  resolvedTileCache.set(key, tile);
  while (resolvedTileCache.size > RESOLVED_TILE_CACHE_MAX) {
    const oldest = resolvedTileCache.keys().next().value;
    if (oldest === undefined) break;
    resolvedTileCache.delete(oldest);
  }
}

async function resolveBrandTile(
  styleCacheKey: string,
  kind: BrandIconKind,
  id: string,
  size: number,
  style: ResolvedIconStyle,
  hintPayload: BrandIconHint | undefined,
): Promise<RenderedBrandTile | null> {
  const cached = resolvedTileCache.get(styleCacheKey);
  if (cached) return cached;

  const existing = inflightTiles.get(styleCacheKey);
  if (existing) return existing;

  const job = (async (): Promise<RenderedBrandTile | null> => {
    try {
      const protocolKind = kind === 'addon' || kind === 'app' ? 'addon' : 'integration';
      const vector = protocolArtwork(protocolKind, id);

      if (!vector && window.hausNative?.brandIconTile) {
        const hubTile = await window.hausNative.brandIconTile(
          kind,
          id,
          {
            appearance: style.appearance,
            variation: style.variation,
            tintHex: style.tintHex,
            size,
          },
          hintPayload,
        );
        if (hubTile?.rendered && hubTile.dataUri) {
          const ready: RenderedBrandTile = {
            dataUrl: hubTile.dataUri,
            layout: hubTile.layout === 'fill' ? 'fill' : 'inset',
          };
          rememberResolvedTile(styleCacheKey, ready);
          return ready;
        }
        const rawSource = hubTile?.dataUri || buildMonogramBadgeSvgUri(kind, id, hintPayload);
        const rendered = await renderBrandIconTile(rawSource, style, size);
        if (rendered) rememberResolvedTile(styleCacheKey, rendered);
        return rendered;
      }

      const rawSource =
        vector ??
        (await window.hausNative?.brandIcon?.(
          kind,
          id,
          style.appearance === 'dark' ||
            (style.appearance === 'default' && style.variation === 'dark'),
          hintPayload,
        )) ??
        buildMonogramBadgeSvgUri(kind, id, hintPayload);

      const rendered = await renderBrandIconTile(rawSource, style, size);
      if (rendered) rememberResolvedTile(styleCacheKey, rendered);
      return rendered;
    } catch {
      return null;
    } finally {
      inflightTiles.delete(styleCacheKey);
    }
  })();

  inflightTiles.set(styleCacheKey, job);
  return job;
}

export interface BrandIconProps {
  kind: BrandIconKind;
  id: string;
  hint?: BrandIconHint;
  size?: number;
}

function areBrandIconPropsEqual(prev: BrandIconProps, next: BrandIconProps): boolean {
  if (prev.kind !== next.kind || prev.id !== next.id || prev.size !== next.size) {
    return false;
  }
  const a = prev.hint;
  const b = next.hint;
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.repositoryUrl === b.repositoryUrl &&
    a.repository === b.repository &&
    a.category === b.category &&
    a.supportedBy === b.supportedBy &&
    a.addonSlug === b.addonSlug &&
    a.addonConfigPath === b.addonConfigPath
  );
}

export const BrandIcon = memo(function BrandIcon({ kind, id, hint, size = 44 }: BrandIconProps) {
  const style = useIconStyle();
  const rootRef = useRef<HTMLSpanElement>(null);
  const hintName = hint?.name ?? '';
  const hintRepoUrl = hint?.repositoryUrl ?? '';
  const hintRepo = hint?.repository ?? '';
  const hintCategory = hint?.category ?? '';
  const hintSupportedBy = hint?.supportedBy ?? '';
  const hintAddonSlug = hint?.addonSlug ?? '';
  const hintAddonConfigPath = hint?.addonConfigPath ?? '';

  const styleCacheKey = `${kind}:${id}:${style.appearance}:${style.variation}:${style.appearance === 'tinted' ? style.tintHex : '-'}:${hintRepoUrl}:${hintRepo}:${hintAddonSlug}:${hintSupportedBy}`;

  const [tileState, setTileState] = useState<{
    key: string;
    tile: RenderedBrandTile | null;
  }>(() => ({
    key: styleCacheKey,
    tile: resolvedTileCache.get(styleCacheKey) ?? null,
  }));

  const tile =
    tileState.key === styleCacheKey
      ? tileState.tile
      : (resolvedTileCache.get(styleCacheKey) ?? null);

  const placeholderUri = useMemo(
    () => getPlaceholderUri(placeholderGlyphKind(kind), style),
    [kind, style],
  );

  useEffect(() => {
    const cached = resolvedTileCache.get(styleCacheKey);
    if (cached) {
      setTileState((prev) =>
        prev.key === styleCacheKey && prev.tile === cached
          ? prev
          : { key: styleCacheKey, tile: cached },
      );
      return;
    }

    let current = true;
    let cancelQueued: (() => void) | null = null;
    let cancelObserve: (() => void) | null = null;

    const hintPayload: BrandIconHint | undefined =
      hintName ||
      hintRepoUrl ||
      hintRepo ||
      hintCategory ||
      hintSupportedBy ||
      hintAddonSlug ||
      hintAddonConfigPath
        ? {
            ...(hintName ? { name: hintName } : {}),
            ...(hintRepoUrl ? { repositoryUrl: hintRepoUrl } : {}),
            ...(hintRepo ? { repository: hintRepo } : {}),
            ...(hintCategory ? { category: hintCategory } : {}),
            ...(hintSupportedBy ? { supportedBy: hintSupportedBy } : {}),
            ...(hintAddonSlug ? { addonSlug: hintAddonSlug } : {}),
            ...(hintAddonConfigPath ? { addonConfigPath: hintAddonConfigPath } : {}),
          }
        : undefined;

    const startFetch = () => {
      if (!current) return;
      cancelQueued = scheduleTileLoad(async () => {
        if (!current) return;
        const resolved = await resolveBrandTile(styleCacheKey, kind, id, size, style, hintPayload);
        if (current && resolved) {
          setTileState({ key: styleCacheKey, tile: resolved });
        }
      });
    };

    const element = rootRef.current;
    if (element) {
      cancelObserve = observeIconVisibility(element, startFetch);
    } else {
      startFetch();
    }

    return () => {
      current = false;
      cancelObserve?.();
      cancelQueued?.();
    };
  }, [
    styleCacheKey,
    kind,
    id,
    size,
    style,
    hintName,
    hintRepoUrl,
    hintRepo,
    hintCategory,
    hintSupportedBy,
    hintAddonSlug,
    hintAddonConfigPath,
  ]);

  return (
    <span
      ref={rootRef}
      className={`brand-icon-surface is-enclosure-rendered ${tile?.layout === 'fill' ? 'is-full-bleed' : 'is-inset'}${style.appearance === 'clear' ? ' is-clear-style' : ''}`}
      aria-hidden="true"
    >
      <img
        className={`brand-icon-tile${tile ? '' : ' is-placeholder'}`}
        src={tile ? tile.dataUrl : placeholderUri}
        decoding="async"
        alt=""
      />
    </span>
  );
}, areBrandIconPropsEqual);
