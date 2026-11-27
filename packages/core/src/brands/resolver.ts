/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { resolveAddonGithubIcon } from './addons.js';
import type { BrandIconCache } from './cache.js';
import {
  bundledFallbackSvgDataUri,
  deriveCandidateDomains,
  validateBrandIconInput,
  type BrandIconHint,
  type BrandIconKind,
  type GithubRepoRef,
} from './fallbacks.js';
import {
  MAX_BRAND_ICON_BYTES,
  resolvePluginPackageAssets,
  tryGithubBrandFallback,
  tryUpstreamBrands,
} from './remote.js';

export interface BrandIconLookupContext {
  readonly kind: BrandIconKind;
  readonly id: string;
  readonly candidates: string[];
  readonly dark: boolean;
  readonly hint?: BrandIconHint;
  readonly maxBytes: number;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs: number;
}

export interface BrandIconCoreResolveOptions {
  readonly kind: unknown;
  readonly id: unknown;
  readonly dark?: boolean;
  readonly hint?: BrandIconHint;
  readonly readLocalIcon?: (context: BrandIconLookupContext) => Promise<string | null>;
  readonly resolveSessionIcon?: (context: BrandIconLookupContext) => Promise<string | null>;
  readonly fetchFn?: typeof fetch;
  readonly brandsBaseUrl?: string;
  readonly githubRawBaseUrl?: string;
  readonly githubAvatarBaseUrl?: string;
  readonly npmCdnBaseUrl?: string;
  readonly cache?: BrandIconCache;
  readonly allowFallback?: boolean;
  readonly timeoutMs?: number;
}

/** Platform-neutral brand icon resolver shared across Haus Hubs, desktop, and mobile. */
export async function resolveCoreBrandIconWithMeta(
  options: BrandIconCoreResolveOptions,
): Promise<{ readonly dataUri: string | null; readonly isFallback: boolean }> {
  const { kind, id } = validateBrandIconInput(options.kind, options.id);
  const dark = options.dark === true;
  const allowFallback = options.allowFallback !== false;
  const hintKey = `${options.hint?.supportedBy ?? ''}:${options.hint?.repositoryUrl ?? ''}:${options.hint?.repository ?? ''}:${options.hint?.addonSlug ?? ''}:${options.hint?.addonConfigPath ?? ''}`;
  const cacheKey = `${kind}:${id}:${dark ? 'dark' : 'light'}:${hintKey}:${allowFallback ? 'fb' : 'raw'}`;

  const cached = options.cache?.get(cacheKey);
  if (cached !== undefined) {
    return {
      dataUri: cached,
      isFallback: Boolean(cached && cached.startsWith('data:image/svg+xml;')),
    };
  }

  const existingFlight = options.cache?.getInFlight(cacheKey);
  if (existingFlight) {
    const dataUri = await existingFlight;
    return {
      dataUri,
      isFallback: Boolean(dataUri && dataUri.startsWith('data:image/svg+xml;')),
    };
  }

  let usedFallback = false;
  const task = (async (): Promise<string | null> => {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 6_000;
    const candidates = deriveCandidateDomains(kind, id, options.hint);
    const githubRawBaseUrl = options.githubRawBaseUrl ?? 'https://raw.githubusercontent.com';
    const isAddonLike = kind === 'addon' || kind === 'app';
    const lookupContext: BrandIconLookupContext = {
      kind,
      id,
      candidates,
      dark,
      hint: options.hint,
      maxBytes: MAX_BRAND_ICON_BYTES,
      fetchFn,
      timeoutMs,
    };

    let resolved: string | null = null;
    if (options.readLocalIcon) {
      resolved = await options.readLocalIcon(lookupContext);
    }

    if (!resolved && options.resolveSessionIcon) {
      resolved = await options.resolveSessionIcon(lookupContext);
    }

    if (!resolved && isAddonLike) {
      resolved = await resolveAddonGithubIcon({
        id,
        hint: options.hint,
        githubRawBaseUrl,
        fetchFn,
        timeoutMs,
      });
    }

    let discoveredRepo: GithubRepoRef | null = null;
    if (!resolved) {
      const pluginAssets = await resolvePluginPackageAssets({
        kind,
        id,
        hint: options.hint,
        npmCdnBaseUrl: options.npmCdnBaseUrl ?? 'https://cdn.jsdelivr.net',
        githubRawBaseUrl,
        fetchFn,
        timeoutMs,
      });
      resolved = pluginAssets.iconDataUri;
      discoveredRepo = pluginAssets.discoveredRepo;
    }

    if (!resolved) {
      resolved = await tryUpstreamBrands(
        candidates,
        dark,
        options.brandsBaseUrl ?? 'https://brands.home-assistant.io',
        fetchFn,
        timeoutMs,
      );
    }

    if (!resolved) {
      resolved = await tryGithubBrandFallback(
        kind,
        id,
        candidates,
        options.hint,
        discoveredRepo,
        githubRawBaseUrl,
        options.githubAvatarBaseUrl ?? 'https://github.com',
        fetchFn,
        timeoutMs,
      );
    }

    if (resolved) {
      options.cache?.set(cacheKey, resolved, false);
      return resolved;
    }

    usedFallback = true;
    const fallback = allowFallback ? bundledFallbackSvgDataUri(kind, id, options.hint) : null;
    options.cache?.set(cacheKey, fallback, true);
    return fallback;
  })();

  options.cache?.setInFlight(cacheKey, task);
  try {
    const dataUri = await task;
    return { dataUri, isFallback: usedFallback };
  } finally {
    options.cache?.clearInFlight(cacheKey);
  }
}

export async function resolveCoreBrandIcon(
  options: BrandIconCoreResolveOptions,
): Promise<string | null> {
  const result = await resolveCoreBrandIconWithMeta(options);
  return result.dataUri;
}
