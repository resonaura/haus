/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { validateBrandIconInput, type BrandIconHint } from '@haus/ha/native/brand-fallbacks';
import { BrandIconCache, resolveBrandIcon } from '@haus/ha/native/brand-icons';

export type { BrandIconHint };

type HubApiGet = (path: string) => Promise<unknown>;

const connectionCaches = new WeakMap<object, BrandIconCache>();

function getCache(owner: object): BrandIconCache {
  let cache = connectionCaches.get(owner);
  if (!cache) {
    cache = new BrandIconCache(600);
    connectionCaches.set(owner, cache);
  }
  return cache;
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
  const category = cleanHintString(rec.category, 64);
  const addonSlug = cleanHintString(rec.addonSlug, 120);
  if (!name && !supportedBy && !repositoryUrl && !category && !addonSlug) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(supportedBy ? { supportedBy } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(category ? { category } : {}),
    ...(addonSlug ? { addonSlug } : {}),
  };
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
  const hintKey = `${hint?.supportedBy ?? ''}:${hint?.repositoryUrl ?? ''}:${hint?.addonSlug ?? ''}`;
  const cacheKey = `hub:${valid.kind}:${valid.id}:${dark ? 'dark' : 'light'}:${hintKey}`;

  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const params = new URLSearchParams({
    kind: valid.kind,
    id: valid.id,
    dark: dark ? '1' : '0',
  });
  if (hint?.name) params.set('name', hint.name);
  if (hint?.supportedBy) params.set('supportedBy', hint.supportedBy);
  if (hint?.repositoryUrl) params.set('repositoryUrl', hint.repositoryUrl);
  if (hint?.category) params.set('category', hint.category);
  if (hint?.addonSlug) params.set('addonSlug', hint.addonSlug);

  try {
    const res = (await apiGet(`/api/brands/icon?${params.toString()}`)) as {
      dataUri?: unknown;
    } | null;
    if (
      res &&
      typeof res.dataUri === 'string' &&
      /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(res.dataUri)
    ) {
      const isSvgFallback = res.dataUri.startsWith('data:image/svg+xml;');
      cache.set(cacheKey, res.dataUri, isSvgFallback);
      return res.dataUri;
    }
  } catch {
    // Older Hubs without /api/brands/icon fall through cleanly to direct resolution
  }

  return resolveBrandIcon({
    kind: valid.kind,
    id: valid.id,
    dark,
    hint,
    cache,
  });
}
