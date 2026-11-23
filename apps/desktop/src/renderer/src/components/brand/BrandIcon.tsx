/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image as HausImage, Text } from '@haus/ui';
import {
  buildUnifiedPlaceholderSvgUri,
  type PlaceholderGlyphKind,
  type ResolvedIconStyle,
} from '@haus/icons';
import type { BrandIconHint, BrandIconKind } from '../../../../shared/native';
import { protocolArtwork } from '../../model/brand-vectors';
import {
  buildMonogramBadgeSvgUri,
  getBrandIconCacheEpoch,
  inflightTiles,
  reconcileHubBrandIconRevision,
  rememberResolvedTile,
  resolvedTileCache,
  useBrandIconCacheVersion,
} from './brand-cache';
import { renderBrandIconTile, type RenderedBrandTile } from './engine/render';
import { useIconStyle } from './useIconStyle';

function placeholderGlyphKind(kind: BrandIconKind): PlaceholderGlyphKind {
  if (kind === 'addon' || kind === 'app') return 'addon';
  if (kind === 'hacs' || kind === 'homebridge' || kind === 'scrypted' || kind === 'plugin') {
    return 'plugin';
  }
  return 'integration';
}

const MAX_CONCURRENT_TILE_LOADS = 8;

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

  const startEpoch = getBrandIconCacheEpoch();
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
        const rolledOver = reconcileHubBrandIconRevision(hubTile?.revision);
        const storeEpoch = rolledOver ? getBrandIconCacheEpoch() : startEpoch;
        if (hubTile?.rendered && hubTile.dataUri) {
          const ready: RenderedBrandTile = {
            dataUrl: hubTile.dataUri,
            layout: hubTile.layout === 'fill' ? 'fill' : 'inset',
          };
          if (!rolledOver) rememberResolvedTile(styleCacheKey, ready, storeEpoch);
          return ready;
        }
        const rawSource = hubTile?.dataUri || buildMonogramBadgeSvgUri(kind, id, hintPayload);
        const rendered = await renderBrandIconTile(rawSource, style, size);
        if (rendered && !rolledOver) rememberResolvedTile(styleCacheKey, rendered, storeEpoch);
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
      if (rendered) rememberResolvedTile(styleCacheKey, rendered, startEpoch);
      return rendered;
    } catch {
      return null;
    } finally {
      if (getBrandIconCacheEpoch() === startEpoch) {
        inflightTiles.delete(styleCacheKey);
      }
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
  const cacheVersion = useBrandIconCacheVersion();
  const rootRef = useRef<HTMLSpanElement>(null);
  const hintName = hint?.name ?? '';
  const hintRepoUrl = hint?.repositoryUrl ?? '';
  const hintRepo = hint?.repository ?? '';
  const hintCategory = hint?.category ?? '';
  const hintSupportedBy = hint?.supportedBy ?? '';
  const hintAddonSlug = hint?.addonSlug ?? '';
  const hintAddonConfigPath = hint?.addonConfigPath ?? '';

  const styleCacheKey = `${cacheVersion}:${kind}:${id}:${style.appearance}:${style.variation}:${style.appearance === 'tinted' ? style.tintHex : '-'}:${hintRepoUrl}:${hintRepo}:${hintAddonSlug}:${hintSupportedBy}`;

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
    <Text
      textRef={rootRef}
      className={`brand-icon-surface is-enclosure-rendered ${tile?.layout === 'fill' ? 'is-full-bleed' : 'is-inset'}${style.appearance === 'clear' ? ' is-clear-style' : ''}`}
      ariaHidden
    >
      <HausImage
        className={`brand-icon-tile${tile ? '' : ' is-placeholder'}`}
        src={tile ? tile.dataUrl : placeholderUri}
        alt=""
      />
    </Text>
  );
}, areBrandIconPropsEqual);
