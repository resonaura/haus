/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ICON_STYLE, resolveIconStyle, type ResolvedIconStyle } from '@haus/icons';
import { insets, pct, px } from '../../ir/geometry.js';
import { useHausUi } from '../../primitives/context.js';
import { Box } from '../../primitives/elements.js';
import { Image } from '../../primitives/media.js';
import type { HostImageDropShadow } from '../../renderers/host-media.js';
import {
  buildMonogramBadgeSvgUri,
  getBrandIconCacheEpoch,
  getBrandPlaceholderUri,
  inflightBrandTiles,
  invalidateBrandIconCache,
  placeholderGlyphKindForBrand,
  reconcileHubBrandIconRevision,
  rememberResolvedBrandTile,
  resolvedBrandTileCache,
  scheduleBrandTileLoad,
  useBrandIconCacheVersion,
} from './brand-cache.js';
import { resolveProtocolBrandSvgUri } from './device-artworks.js';
import type { BrandIconHint, BrandIconKind, BrandIconPort, RenderedBrandTile } from './types.js';

const LIGHT_TILE_SHADOW: HostImageDropShadow = {
  offsetX: 0,
  offsetY: 1.25,
  blurRadius: 2.25,
  color: 'rgba(0, 0, 0, 0.26)',
};

const DARK_TILE_SHADOW: HostImageDropShadow = {
  offsetX: 0,
  offsetY: 1.5,
  blurRadius: 2.75,
  color: 'rgba(0, 0, 0, 0.42)',
};

const DEFAULT_GPUI_SHADOW_BLEED = 0.22;

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

function observeIfDomElement(node: unknown, onVisible: () => void): () => void {
  if (typeof Element === 'undefined' || !(node instanceof Element)) {
    onVisible();
    return () => {};
  }
  const observer = getVisibilityObserver();
  if (!observer) {
    onVisible();
    return () => {};
  }
  visibilityCallbacks.set(node, onVisible);
  observer.observe(node);
  return () => {
    visibilityCallbacks.delete(node);
    observer.unobserve(node);
  };
}

/**
 * Expands `@haus/icons`'s `0 0 1024 1024` placeholder SVG viewBox by the same
 * symmetrical bleed fraction used by GPUIX shadowed tiles so placeholder -> loaded
 * tile crossfades have zero geometry or scale jump.
 */
function padPlaceholderSvgForBleed(svgDataUri: string, bleedFraction: number): string {
  const prefix = 'data:image/svg+xml;charset=utf-8,';
  if (!svgDataUri.startsWith(prefix)) return svgDataUri;
  try {
    const raw = decodeURIComponent(svgDataUri.slice(prefix.length));
    const pad = Number((1024 * bleedFraction).toFixed(2));
    const span = Number((1024 + pad * 2).toFixed(2));
    const outDim = Math.round(256 * (1 + bleedFraction * 2));
    const padded = raw
      .replace('width="256" height="256"', `width="${outDim}" height="${outDim}"`)
      .replace('viewBox="0 0 1024 1024"', `viewBox="${-pad} ${-pad} ${span} ${span}"`);
    return `${prefix}${encodeURIComponent(padded)}`;
  } catch {
    return svgDataUri;
  }
}

async function decorateTileIfNeeded(
  tile: RenderedBrandTile | null,
  size: number,
  themeDark: boolean,
  port: BrandIconPort | undefined,
): Promise<RenderedBrandTile | null> {
  if (!tile) return null;
  if (!port?.applyTileShadow) return tile;
  const decorated = await port.applyTileShadow(tile.dataUrl, size, themeDark);
  if (!decorated) return tile;
  return {
    dataUrl: decorated.dataUrl,
    layout: tile.layout,
    shadowBleedFraction: decorated.bleedFraction,
  };
}

async function resolveBrandTile(
  styleCacheKey: string,
  kind: BrandIconKind,
  id: string,
  size: number,
  style: ResolvedIconStyle,
  themeDark: boolean,
  hintPayload: BrandIconHint | undefined,
  port: BrandIconPort | undefined,
): Promise<RenderedBrandTile | null> {
  const cached = resolvedBrandTileCache.get(styleCacheKey);
  if (cached) return cached;

  const existing = inflightBrandTiles.get(styleCacheKey);
  if (existing) return existing;

  const startEpoch = getBrandIconCacheEpoch();
  const job = (async (): Promise<RenderedBrandTile | null> => {
    try {
      const protocolKind = kind === 'addon' || kind === 'app' ? 'addon' : 'integration';
      const protocolVector = resolveProtocolBrandSvgUri(protocolKind, id);

      if (!protocolVector && port?.resolveTile) {
        const hubTile = await port.resolveTile(
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
          const baseReady: RenderedBrandTile = {
            dataUrl: hubTile.dataUri,
            layout: hubTile.layout === 'fill' ? 'fill' : 'inset',
          };
          const ready = await decorateTileIfNeeded(baseReady, size, themeDark, port);
          if (ready && !rolledOver) rememberResolvedBrandTile(styleCacheKey, ready, storeEpoch);
          return ready;
        }
        const rawSource = hubTile?.dataUri || buildMonogramBadgeSvgUri(kind, id, hintPayload);
        const baseRendered = port.renderLocalTile
          ? await port.renderLocalTile(rawSource, style, size)
          : { dataUrl: rawSource, layout: 'inset' as const };
        const rendered = await decorateTileIfNeeded(baseRendered, size, themeDark, port);
        if (rendered && !rolledOver) rememberResolvedBrandTile(styleCacheKey, rendered, storeEpoch);
        return rendered;
      }

      const dark =
        style.appearance === 'dark' ||
        (style.appearance === 'default' && style.variation === 'dark');
      const rawSource =
        protocolVector ??
        (port?.resolveSource ? await port.resolveSource(kind, id, dark, hintPayload) : null) ??
        buildMonogramBadgeSvgUri(kind, id, hintPayload);

      const baseRendered = port?.renderLocalTile
        ? await port.renderLocalTile(rawSource, style, size)
        : { dataUrl: rawSource, layout: 'inset' as const };
      const rendered = await decorateTileIfNeeded(baseRendered, size, themeDark, port);
      if (rendered) rememberResolvedBrandTile(styleCacheKey, rendered, startEpoch);
      return rendered;
    } catch {
      return null;
    } finally {
      if (getBrandIconCacheEpoch() === startEpoch) {
        inflightBrandTiles.delete(styleCacheKey);
      }
    }
  })();

  inflightBrandTiles.set(styleCacheKey, job);
  return job;
}

export interface BrandIconProps {
  readonly kind: BrandIconKind;
  readonly id: string;
  readonly hint?: BrandIconHint;
  readonly size?: number;
  readonly className?: string;
}

function areBrandIconPropsEqual(prev: BrandIconProps, next: BrandIconProps): boolean {
  if (
    prev.kind !== next.kind ||
    prev.id !== next.id ||
    prev.size !== next.size ||
    prev.className !== next.className
  ) {
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

const subscribedPorts = new WeakSet<BrandIconPort>();

function ensurePortInvalidationSubscription(port: BrandIconPort | undefined): void {
  if (!port?.subscribeInvalidation || subscribedPorts.has(port)) return;
  subscribedPorts.add(port);
  port.subscribeInvalidation((revision) => {
    invalidateBrandIconCache(revision);
  });
}

/**
 * Unified `@haus/icons` continuous-supercircle (`266.24/1024`, `tileFraction = 0.9`)
 * brand icon shared across Electron, GPUIX, and mobile.
 *
 * - Resolves Hub / `@haus/icons/node` (`IconRenderService` + C++20 `haus-icon-worker`)
 *   rendered enclosure tiles through `HausUiProvider.brandIcons`.
 * - Preserves exact Electron CSS container sizing when `size` is omitted on DOM.
 * - Matches Electron's `.brand-icon-tile` alpha-following drop-shadow on both DOM
 *   (CSS `filter: drop-shadow`) and GPUIX (symmetrical Skia alpha shadow bleed).
 */
export const BrandIcon = memo(function BrandIcon({
  kind,
  id,
  hint,
  size,
  className,
}: BrandIconProps) {
  const { theme, host, brandIcons } = useHausUi();
  const cacheVersion = useBrandIconCacheVersion();
  const rootRef = useRef<unknown>(null);
  const isDom = host.target === 'react-dom';
  const themeDark = theme.mode === 'dark';
  const requestSize = size ?? 44;

  useEffect(() => {
    ensurePortInvalidationSubscription(brandIcons);
  }, [brandIcons]);

  const style = useMemo<ResolvedIconStyle>(
    () => brandIcons?.iconStyle ?? resolveIconStyle(DEFAULT_ICON_STYLE, themeDark),
    [brandIcons?.iconStyle, themeDark],
  );

  const hintName = hint?.name ?? '';
  const hintRepoUrl = hint?.repositoryUrl ?? '';
  const hintRepo = hint?.repository ?? '';
  const hintCategory = hint?.category ?? '';
  const hintSupportedBy = hint?.supportedBy ?? '';
  const hintAddonSlug = hint?.addonSlug ?? '';
  const hintAddonConfigPath = hint?.addonConfigPath ?? '';

  const hasShadowCompositor = Boolean(!isDom && brandIcons?.applyTileShadow);
  const rendererTag = hasShadowCompositor
    ? `gpui-shadow:${themeDark ? 'd' : 'l'}:${Math.round(requestSize)}`
    : brandIcons?.renderLocalTile || brandIcons?.resolveTile
      ? 'tile'
      : 'raw';
  const styleCacheKey = `${cacheVersion}:${rendererTag}:${kind}:${id}:${style.appearance}:${style.variation}:${style.appearance === 'tinted' ? style.tintHex : '-'}:${hintRepoUrl}:${hintRepo}:${hintAddonSlug}:${hintSupportedBy}`;

  const [tileState, setTileState] = useState<{
    key: string;
    tile: RenderedBrandTile | null;
  }>(() => ({
    key: styleCacheKey,
    tile: resolvedBrandTileCache.get(styleCacheKey) ?? null,
  }));

  const tile =
    tileState.key === styleCacheKey
      ? tileState.tile
      : (resolvedBrandTileCache.get(styleCacheKey) ?? null);

  const placeholderUri = useMemo(() => {
    const base = getBrandPlaceholderUri(placeholderGlyphKindForBrand(kind), style);
    return hasShadowCompositor ? padPlaceholderSvgForBleed(base, DEFAULT_GPUI_SHADOW_BLEED) : base;
  }, [hasShadowCompositor, kind, style]);

  useEffect(() => {
    const cached = resolvedBrandTileCache.get(styleCacheKey);
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
      cancelQueued = scheduleBrandTileLoad(async () => {
        if (!current) return;
        const resolved = await resolveBrandTile(
          styleCacheKey,
          kind,
          id,
          requestSize,
          style,
          themeDark,
          hintPayload,
          brandIcons,
        );
        if (current && resolved) {
          setTileState({ key: styleCacheKey, tile: resolved });
        }
      });
    };

    cancelObserve = observeIfDomElement(rootRef.current, startFetch);

    return () => {
      current = false;
      cancelObserve?.();
      cancelQueued?.();
    };
  }, [
    styleCacheKey,
    kind,
    id,
    requestSize,
    style,
    themeDark,
    brandIcons,
    hintName,
    hintRepoUrl,
    hintRepo,
    hintCategory,
    hintSupportedBy,
    hintAddonSlug,
    hintAddonConfigPath,
  ]);

  const surfaceClass = [
    'brand-icon-surface',
    'is-enclosure-rendered',
    tile?.layout === 'fill' ? 'is-full-bleed' : 'is-inset',
    style.appearance === 'clear' ? 'is-clear-style' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const bleedFraction = hasShadowCompositor
    ? (tile?.shadowBleedFraction ?? DEFAULT_GPUI_SHADOW_BLEED)
    : 0;
  const bleedPx = bleedFraction > 0 ? requestSize * bleedFraction : 0;

  return (
    <Box
      boxRef={rootRef}
      className={surfaceClass}
      ariaHidden
      style={{
        layout: {
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isDom && size === undefined ? pct(100) : px(requestSize),
          height: isDom && size === undefined ? pct(100) : px(requestSize),
          flexShrink: 0,
          overflow: 'visible',
        },
      }}
    >
      <Image
        className={`brand-icon-tile${tile ? '' : ' is-placeholder'}`}
        src={tile ? tile.dataUrl : placeholderUri}
        alt=""
        ariaHidden
        objectFit="contain"
        transitionMs={140}
        dropShadow={isDom ? (themeDark ? DARK_TILE_SHADOW : LIGHT_TILE_SHADOW) : undefined}
        style={
          bleedPx > 0
            ? {
                layout: {
                  position: 'absolute',
                  inset: insets(-bleedPx),
                  width: px(requestSize + bleedPx * 2),
                  height: px(requestSize + bleedPx * 2),
                  flexShrink: 0,
                },
                opacity: tile ? 1 : 0.92,
                pointerEvents: 'none',
              }
            : {
                layout: {
                  width: pct(100),
                  height: pct(100),
                  flexShrink: 0,
                },
                opacity: tile ? 1 : 0.92,
              }
        }
      />
    </Box>
  );
}, areBrandIconPropsEqual);
