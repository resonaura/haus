/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  bundledFallbackSvgDataUri,
  deriveCandidateDomains,
  KNOWN_BRAND_REPOS,
  parseGithubRepo,
  validateBrandIconInput,
  type BrandIconHint,
  type BrandIconKind,
  type GithubRepoRef,
} from './brand-fallbacks.js';
import {
  readLocalIntegrationDirectoryIcon,
  readLocalPluginDirectoryIcon,
  resolvePluginPackageAssets,
  sniffRasterImageMime,
} from './brand-packages.js';
import { boundedBody } from './validation.js';

export type { BrandIconHint, BrandIconKind };

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

const MAX_ICON_BYTES = 2_000_000;
const POSITIVE_TTL_MS = 24 * 60 * 60_000;
const FALLBACK_TTL_MS = 2 * 60_000;

interface CacheEntry {
  readonly value: string | null;
  readonly expiresAt: number;
}

/** Bounded LRU cache and in-flight coalescing registry for resolved brand icon data URIs. */
export class BrandIconCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(private readonly maxEntries = 600) {}

  getInFlight(key: string): Promise<string | null> | undefined {
    return this.inFlight.get(key);
  }

  setInFlight(key: string, promise: Promise<string | null>): void {
    this.inFlight.set(key, promise);
  }

  clearInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  get(key: string): string | null | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string | null, isFallback: boolean): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (isFallback ? FALLBACK_TTL_MS : POSITIVE_TTL_MS),
    });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export interface BrandIconHaSession {
  readonly url: string;
  getAccessToken(): Promise<string>;
}

export interface BrandIconResolveOptions {
  readonly kind: unknown;
  readonly id: unknown;
  readonly dark?: boolean;
  readonly hint?: BrandIconHint;
  readonly haSession?: BrandIconHaSession;
  readonly localIntegrationDirs?: readonly string[];
  readonly localPluginDirs?: readonly string[];
  readonly fetchFn?: typeof fetch;
  readonly brandsBaseUrl?: string;
  readonly githubRawBaseUrl?: string;
  readonly githubAvatarBaseUrl?: string;
  readonly npmCdnBaseUrl?: string;
  readonly cache?: BrandIconCache;
  readonly allowFallback?: boolean;
  readonly timeoutMs?: number;
}

async function fetchImageDataUri(
  url: URL,
  fetchFn: typeof fetch,
  timeoutMs: number,
  headers: Record<string, string> = {},
  allowSafeGithubRedirect = false,
): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= (allowSafeGithubRedirect ? 2 : 0); hop += 1) {
    let response: Response;
    try {
      response = await fetchFn(current, {
        headers,
        redirect: allowSafeGithubRedirect ? 'manual' : 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return null;
    }

    if (
      allowSafeGithubRedirect &&
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get('location')
    ) {
      await response.body?.cancel();
      try {
        const nextUrl = new URL(response.headers.get('location')!, current);
        if (
          nextUrl.protocol !== 'https:' ||
          (nextUrl.hostname !== 'avatars.githubusercontent.com' &&
            nextUrl.hostname !== 'github.com' &&
            nextUrl.hostname !== 'raw.githubusercontent.com')
        ) {
          return null;
        }
        current = nextUrl;
        continue;
      } catch {
        return null;
      }
    }

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    const rawMime = (response.headers.get('content-type')?.split(';')[0] ?? '')
      .trim()
      .toLowerCase();
    const normalizedHeaderMime = rawMime === 'image/x-png' ? 'image/png' : rawMime;
    const allowMagicSniff =
      normalizedHeaderMime === '' || normalizedHeaderMime === 'application/octet-stream';
    if (!ALLOWED_IMAGE_MIMES.has(normalizedHeaderMime) && !allowMagicSniff) {
      await response.body?.cancel();
      return null;
    }

    try {
      const body = await boundedBody(response, MAX_ICON_BYTES);
      if (body.length === 0) return null;
      const mime = ALLOWED_IMAGE_MIMES.has(normalizedHeaderMime)
        ? normalizedHeaderMime
        : sniffRasterImageMime(body);
      if (!mime) return null;
      return `data:${mime};base64,${body.toString('base64')}`;
    } catch {
      return null;
    }
  }
  return null;
}

async function tryHaEndpoints(
  kind: BrandIconKind,
  id: string,
  candidates: readonly string[],
  dark: boolean,
  hint: BrandIconHint | undefined,
  haSession: BrandIconHaSession,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  let baseUrl: URL;
  let token: string;
  try {
    baseUrl = new URL(haSession.url);
    token = await haSession.getAccessToken();
  } catch {
    return null;
  }

  const urls: URL[] = [];
  if (kind === 'addon' || kind === 'app') {
    const slugs = [id, hint?.addonSlug].filter((s): s is string => Boolean(s));
    const seen = new Set<string>();
    for (const slug of slugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      const encoded = encodeURIComponent(slug);
      for (const path of [
        `/api/hassio/addons/${encoded}/icon`,
        `/api/hassio/store/addons/${encoded}/icon`,
        `/api/hassio/addons/${encoded}/logo`,
        `/api/hassio/store/addons/${encoded}/logo`,
      ]) {
        const target = new URL(path, baseUrl);
        if (target.origin === baseUrl.origin) urls.push(target);
      }
    }
  } else {
    const variants = dark
      ? [
          'dark_icon@2x.png',
          'dark_icon.png',
          'icon@2x.png',
          'icon.png',
          'dark_logo@2x.png',
          'logo.png',
        ]
      : ['icon@2x.png', 'icon.png', 'logo@2x.png', 'logo.png'];
    for (const domain of candidates.slice(0, 2)) {
      const encoded = encodeURIComponent(domain);
      for (const variant of variants) {
        const target = new URL(`/api/brands/integration/${encoded}/${variant}`, baseUrl);
        if (target.origin === baseUrl.origin) urls.push(target);
      }
    }
  }

  for (const target of urls) {
    if (target.origin !== baseUrl.origin) continue;
    const hit = await fetchImageDataUri(target, fetchFn, Math.min(timeoutMs, 4_000), {
      Authorization: `Bearer ${token}`,
    });
    if (hit) return hit;
  }
  return null;
}

async function tryUpstreamBrands(
  candidates: readonly string[],
  dark: boolean,
  brandsBaseUrl: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const primaryVariants = dark
    ? [
        'dark_icon@2x.png',
        'dark_icon.png',
        'icon@2x.png',
        'icon.png',
        'dark_logo@2x.png',
        'logo@2x.png',
        'logo.png',
      ]
    : ['icon@2x.png', 'icon.png', 'logo@2x.png', 'logo.png'];
  const secondaryVariants = dark
    ? ['dark_icon@2x.png', 'icon@2x.png', 'icon.png', 'logo.png']
    : ['icon@2x.png', 'icon.png', 'logo.png'];

  for (let i = 0; i < candidates.length; i += 1) {
    const domain = candidates[i]!;
    const variants = i === 0 ? primaryVariants : secondaryVariants;
    for (const variant of variants) {
      let target: URL;
      try {
        target = new URL(`/${encodeURIComponent(domain)}/${variant}`, brandsBaseUrl);
      } catch {
        continue;
      }
      const hit = await fetchImageDataUri(target, fetchFn, timeoutMs);
      if (hit) return hit;
    }
  }
  return null;
}

async function tryGithubFallback(
  kind: BrandIconKind,
  id: string,
  candidates: readonly string[],
  hint: BrandIconHint | undefined,
  discoveredRepo: GithubRepoRef | null,
  rawBaseUrl: string,
  avatarBaseUrl: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const repoRef =
    parseGithubRepo(hint?.repositoryUrl) ??
    discoveredRepo ??
    parseGithubRepo(id) ??
    parseGithubRepo(KNOWN_BRAND_REPOS[id.toLowerCase()]) ??
    candidates.map((c) => parseGithubRepo(KNOWN_BRAND_REPOS[c])).find((v) => v !== null) ??
    null;

  if (!repoRef) return null;

  const owner = encodeURIComponent(repoRef.owner);
  const repo = encodeURIComponent(repoRef.repo);
  const primary = encodeURIComponent(candidates[0] ?? id);
  const prefix = `/${owner}/${repo}/HEAD`;
  const rawPaths =
    kind === 'homebridge'
      ? [
          `${prefix}/homebridge-ui/public/icon.png`,
          `${prefix}/branding/icon.png`,
          `${prefix}/icon.png`,
          `${prefix}/logo.png`,
          `${prefix}/images/icon.png`,
        ]
      : kind === 'scrypted'
        ? [
            `${prefix}/icon.png`,
            `${prefix}/assets/icon.png`,
            `${prefix}/public/icon.png`,
            `${prefix}/logo.png`,
          ]
        : kind === 'addon'
          ? [
              `${prefix}/icon.png`,
              `${prefix}/logo.png`,
              `${prefix}/${primary}/icon.png`,
              `${prefix}/${primary}/logo.png`,
            ]
          : [
              `${prefix}/custom_components/${primary}/brand/icon.png`,
              `${prefix}/custom_components/${primary}/icon.png`,
              `${prefix}/brand/icon.png`,
              `${prefix}/icon.png`,
              `${prefix}/logo.png`,
              `${prefix}/assets/icon.png`,
            ];

  for (const path of rawPaths) {
    try {
      const target = new URL(path, rawBaseUrl);
      const hit = await fetchImageDataUri(target, fetchFn, timeoutMs);
      if (hit) return hit;
    } catch {
      // ignore invalid URL
    }
  }

  try {
    const avatarUrl = new URL(`/${owner}.png?size=128`, avatarBaseUrl);
    return await fetchImageDataUri(avatarUrl, fetchFn, timeoutMs, {}, true);
  } catch {
    return null;
  }
}

/** Resolves an icon data URI across local components, HA APIs, upstream HA brands, GitHub, and bundled vector fallbacks. */
export async function resolveBrandIcon(options: BrandIconResolveOptions): Promise<string | null> {
  const { kind, id } = validateBrandIconInput(options.kind, options.id);
  const dark = options.dark === true;
  const allowFallback = options.allowFallback !== false;
  const hintKey = `${options.hint?.supportedBy ?? ''}:${options.hint?.repositoryUrl ?? ''}:${options.hint?.addonSlug ?? ''}`;
  const cacheKey = `${kind}:${id}:${dark ? 'dark' : 'light'}:${hintKey}:${allowFallback ? 'fb' : 'raw'}`;

  const cached = options.cache?.get(cacheKey);
  if (cached !== undefined) return cached;

  const existingFlight = options.cache?.getInFlight(cacheKey);
  if (existingFlight) return existingFlight;

  const task = (async (): Promise<string | null> => {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 6_000;
    const candidates = deriveCandidateDomains(kind, id, options.hint);

    let resolved: string | null = null;
    if (options.localIntegrationDirs?.length) {
      resolved = await readLocalIntegrationDirectoryIcon(
        options.localIntegrationDirs,
        candidates,
        dark,
        MAX_ICON_BYTES,
      );
    }

    if (!resolved && options.localPluginDirs?.length) {
      resolved = await readLocalPluginDirectoryIcon(options.localPluginDirs, id, MAX_ICON_BYTES);
    }

    if (!resolved && options.haSession) {
      resolved = await tryHaEndpoints(
        kind,
        id,
        candidates,
        dark,
        options.hint,
        options.haSession,
        fetchFn,
        timeoutMs,
      );
    }

    const githubRawBaseUrl = options.githubRawBaseUrl ?? 'https://raw.githubusercontent.com';
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
        fetchImage: fetchImageDataUri,
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
      resolved = await tryGithubFallback(
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

    const fallback = allowFallback ? bundledFallbackSvgDataUri(kind, id, options.hint) : null;
    options.cache?.set(cacheKey, fallback, true);
    return fallback;
  })();

  options.cache?.setInFlight(cacheKey, task);
  try {
    return await task;
  } finally {
    options.cache?.clearInFlight(cacheKey);
  }
}
