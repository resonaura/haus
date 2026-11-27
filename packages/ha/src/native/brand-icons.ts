/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BrandIconCache,
  fetchImageDataUri,
  resolveCoreBrandIconWithMeta,
  type BrandIconHint,
  type BrandIconKind,
} from '@haus/core/brands';
import { createNodeBrandLocalLookup } from '@haus/icons/node';

export { BrandIconCache, type BrandIconHint, type BrandIconKind };

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
  readonly localAddonDirs?: readonly string[];
  readonly fetchFn?: typeof fetch;
  readonly brandsBaseUrl?: string;
  readonly githubRawBaseUrl?: string;
  readonly githubAvatarBaseUrl?: string;
  readonly npmCdnBaseUrl?: string;
  readonly cache?: BrandIconCache;
  readonly allowFallback?: boolean;
  readonly timeoutMs?: number;
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

/** Resolves a brand icon on Home Assistant sessions (extending `@haus/core/brands` with authenticated HA Supervisor & `/api/brands` endpoints). */
export async function resolveBrandIconWithMeta(
  options: BrandIconResolveOptions,
): Promise<{ readonly dataUri: string | null; readonly isFallback: boolean }> {
  const hasLocalDirs = Boolean(
    options.localAddonDirs?.length ||
    options.localIntegrationDirs?.length ||
    options.localPluginDirs?.length,
  );
  const readLocalIcon = hasLocalDirs
    ? createNodeBrandLocalLookup({
        localAddonDirs: options.localAddonDirs,
        localIntegrationDirs: options.localIntegrationDirs,
        localPluginDirs: options.localPluginDirs,
      })
    : undefined;

  return resolveCoreBrandIconWithMeta({
    kind: options.kind,
    id: options.id,
    dark: options.dark,
    hint: options.hint,
    readLocalIcon,
    resolveSessionIcon: options.haSession
      ? (ctx) =>
          tryHaEndpoints(
            ctx.kind,
            ctx.id,
            ctx.candidates,
            ctx.dark,
            ctx.hint,
            options.haSession!,
            ctx.fetchFn,
            ctx.timeoutMs,
          )
      : undefined,
    fetchFn: options.fetchFn,
    brandsBaseUrl: options.brandsBaseUrl,
    githubRawBaseUrl: options.githubRawBaseUrl,
    githubAvatarBaseUrl: options.githubAvatarBaseUrl,
    npmCdnBaseUrl: options.npmCdnBaseUrl,
    cache: options.cache,
    allowFallback: options.allowFallback,
    timeoutMs: options.timeoutMs,
  });
}

export async function resolveBrandIcon(options: BrandIconResolveOptions): Promise<string | null> {
  const result = await resolveBrandIconWithMeta(options);
  return result.dataUri;
}
