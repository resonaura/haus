/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { Box, Cable, Package } from 'lucide-react';
import type { BrandIconHint, BrandIconKind } from '../../../../shared/native';
import { prepareBrandArtwork, type PreparedBrandArtwork } from '../../model/brand-artwork';
import { protocolArtwork } from '../../model/brand-vectors';
import { BrandArtwork } from './BrandArtwork';
import { renderBrandIconTile, type RenderedBrandTile } from './engine/render';

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
  const fontSize = letters.length > 1 ? 38 : 46;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue} 68% 52%)"/>` +
    `<stop offset="100%" stop-color="hsl(${hueAlt} 72% 38%)"/>` +
    `</linearGradient></defs>` +
    `<rect x="20" y="20" width="88" height="88" rx="26" fill="url(#b)"/>` +
    `<text x="64" y="66" text-anchor="middle" dominant-baseline="central" ` +
    `fill="#ffffff" font-family="ui-sans-serif, system-ui, sans-serif" ` +
    `font-weight="700" font-size="${fontSize}" letter-spacing="-1">${letters}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const artworkCache = new Map<string, Promise<PreparedBrandArtwork>>();

function artworkFor(src: string): Promise<PreparedBrandArtwork> {
  let result = artworkCache.get(src);
  if (!result) {
    result = prepareBrandArtwork(src).catch(() => ({
      src,
      layout: 'inset',
      template: false,
      width: 68,
      height: 68,
      viewBox: '0 0 100 100',
      sourceWidth: 100,
      sourceHeight: 100,
    }));
    artworkCache.set(src, result);
    if (artworkCache.size > 256) artworkCache.delete(artworkCache.keys().next().value!);
  }
  return result;
}

export function BrandIcon({
  kind,
  id,
  hint,
  size = 44,
}: {
  kind: BrandIconKind;
  id: string;
  hint?: BrandIconHint;
  size?: number;
}) {
  const [artwork, setArtwork] = useState<PreparedBrandArtwork | null>(null);
  const [tile, setTile] = useState<RenderedBrandTile | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const hintName = hint?.name ?? '';
  const hintRepo = hint?.repositoryUrl ?? '';
  const hintCategory = hint?.category ?? '';
  const hintSupportedBy = hint?.supportedBy ?? '';
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    setArtwork(null);
    setTile(null);
    const protocolKind = kind === 'addon' || kind === 'app' ? 'addon' : 'integration';
    const vector = protocolArtwork(protocolKind, id);
    const hintPayload =
      hintName || hintRepo || hintCategory || hintSupportedBy
        ? {
            ...(hintName ? { name: hintName } : {}),
            ...(hintRepo ? { repositoryUrl: hintRepo } : {}),
            ...(hintCategory ? { category: hintCategory } : {}),
            ...(hintSupportedBy ? { supportedBy: hintSupportedBy } : {}),
          }
        : undefined;
    const source = vector
      ? Promise.resolve(vector)
      : window.hausNative?.brandIcon?.(kind, id, dark, hintPayload);
    void Promise.resolve(source ?? null)
      .then(async (value) => {
        const resolved = value || buildMonogramBadgeSvgUri(kind, id, hintPayload);
        const [prepared, rendered] = await Promise.all([
          artworkFor(resolved).catch(() => null),
          renderBrandIconTile(resolved, dark, size).catch(() => null),
        ]);
        if (!current) return;
        if (rendered) setTile(rendered);
        if (prepared) setArtwork(prepared);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [kind, id, dark, size, hintName, hintRepo, hintCategory, hintSupportedBy]);
  return (
    <span
      className={`brand-icon-surface ${(tile?.layout ?? artwork?.layout) === 'fill' ? 'is-full-bleed' : 'is-inset'}${tile ? ' is-enclosure-rendered' : ''}`}
      aria-hidden="true"
    >
      {tile ? (
        <img className="brand-icon-tile" src={tile.dataUrl} alt="" />
      ) : artwork ? (
        <span
          className={`brand-icon-content ${artwork.template ? 'is-template' : ''}`}
          style={
            {
              '--brand-width': `${artwork.width}%`,
              '--brand-height': `${artwork.height}%`,
            } as CSSProperties
          }
        >
          <BrandArtwork artwork={artwork} />
        </span>
      ) : kind === 'addon' || kind === 'app' ? (
        <Box size={23} />
      ) : kind === 'hacs' || kind === 'homebridge' || kind === 'scrypted' || kind === 'plugin' ? (
        <Package size={23} />
      ) : (
        <Cable size={23} />
      )}
    </span>
  );
}
