/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  encodeBase64,
  KNOWN_BRAND_REPOS,
  parseGithubRepo,
  type BrandIconHint,
  type BrandIconKind,
  type GithubRepoRef,
} from './fallbacks.js';

const PACKAGE_META_MAX_BYTES = 64 * 1024;
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
export const MAX_BRAND_ICON_BYTES = 2_000_000;

export function mimeForIconExtension(path: string): string | null {
  const clean = path.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  switch (clean.slice(dot)) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return null;
  }
}

export function sniffRasterImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const lengthHeader = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes) {
    await response.body?.cancel();
    throw new Error('Response body too large.');
  }
  if (!response.body) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new Error('Response body too large.');
    return new Uint8Array(ab);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Response body too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Safely fetches an image URL into a data URI with bounded size and optional GitHub redirect following. */
export async function fetchImageDataUri(
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
      const body = await readBoundedBytes(response, MAX_BRAND_ICON_BYTES);
      if (body.length === 0) return null;
      const mime = ALLOWED_IMAGE_MIMES.has(normalizedHeaderMime)
        ? normalizedHeaderMime
        : sniffRasterImageMime(body);
      if (!mime) return null;
      return `data:${mime};base64,${encodeBase64(body)}`;
    } catch {
      return null;
    }
  }
  return null;
}

export function cleanRelativeIconPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (
    !trimmed ||
    trimmed.length > 180 ||
    trimmed.includes('..') ||
    trimmed.includes('://') ||
    trimmed.includes('\\') ||
    !/^[a-zA-Z0-9._/@-]+$/.test(trimmed) ||
    !mimeForIconExtension(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export function extractDeclaredPluginIconPath(pkg: Record<string, unknown>): string | null {
  const homebridge =
    pkg.homebridge && typeof pkg.homebridge === 'object'
      ? (pkg.homebridge as Record<string, unknown>)
      : null;
  const scrypted =
    pkg.scrypted && typeof pkg.scrypted === 'object'
      ? (pkg.scrypted as Record<string, unknown>)
      : null;
  return (
    cleanRelativeIconPath(scrypted?.icon) ??
    cleanRelativeIconPath(homebridge?.icon) ??
    cleanRelativeIconPath(pkg.icon)
  );
}

export function extractPackageGithubRepo(pkg: Record<string, unknown>): GithubRepoRef | null {
  const repoField = pkg.repository;
  if (typeof repoField === 'string') {
    const parsed = parseGithubRepo(repoField);
    if (parsed) return parsed;
  } else if (repoField && typeof repoField === 'object') {
    const url = (repoField as { url?: unknown }).url;
    if (typeof url === 'string') {
      const cleaned = url.replace(/^git\+/i, '').replace(/^git:\/\//i, 'https://');
      const parsed = parseGithubRepo(cleaned);
      if (parsed) return parsed;
    }
  }
  if (typeof pkg.homepage === 'string') {
    const parsed = parseGithubRepo(pkg.homepage);
    if (parsed) return parsed;
  }
  return null;
}

export async function resolvePluginPackageAssets(options: {
  readonly kind: BrandIconKind;
  readonly id: string;
  readonly hint?: BrandIconHint;
  readonly npmCdnBaseUrl: string;
  readonly githubRawBaseUrl: string;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs: number;
}): Promise<{
  readonly iconDataUri: string | null;
  readonly discoveredRepo: GithubRepoRef | null;
}> {
  const { kind, id, hint, npmCdnBaseUrl, githubRawBaseUrl, fetchFn, timeoutMs } = options;
  const isPlugin =
    kind === 'homebridge' ||
    kind === 'scrypted' ||
    kind === 'plugin' ||
    id.startsWith('@') ||
    id.startsWith('homebridge-') ||
    id.startsWith('scrypted-');
  if (!isPlugin) return { iconDataUri: null, discoveredRepo: null };

  const cappedTimeout = Math.min(timeoutMs, 3_000);
  if (id.startsWith('@scrypted/')) {
    const short = encodeURIComponent(id.slice('@scrypted/'.length));
    for (const rel of ['icon.png', 'logo.png', 'assets/icon.png', 'public/icon.png']) {
      try {
        const target = new URL(`/koush/scrypted/HEAD/plugins/${short}/${rel}`, githubRawBaseUrl);
        const hit = await fetchImageDataUri(target, fetchFn, cappedTimeout);
        if (hit) return { iconDataUri: hit, discoveredRepo: { owner: 'koush', repo: 'scrypted' } };
      } catch {
        // continue
      }
    }
  }

  let discoveredRepo: GithubRepoRef | null = parseGithubRepo(hint?.repositoryUrl);
  let declaredIcon: string | null = null;
  const encodedPkg = id
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  try {
    const pkgUrl = new URL(`/npm/${encodedPkg}/package.json`, npmCdnBaseUrl);
    const res = await fetchFn(pkgUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(cappedTimeout),
    });
    if (res.ok) {
      const body = await readBoundedBytes(res, PACKAGE_META_MAX_BYTES);
      const parsed = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
      declaredIcon = extractDeclaredPluginIconPath(parsed);
      if (!discoveredRepo) discoveredRepo = extractPackageGithubRepo(parsed);
    } else {
      await res.body?.cancel();
    }
  } catch {
    // ignore unreachable or non-npm plugin identifier
  }

  const cdnPaths = [
    ...(declaredIcon ? [declaredIcon] : []),
    ...(kind === 'homebridge' || id.includes('homebridge')
      ? ['homebridge-ui/public/icon.png', 'branding/icon.png']
      : []),
    'icon.png',
    'assets/icon.png',
  ];

  const seenPaths = new Set<string>();
  for (const rel of cdnPaths) {
    if (seenPaths.has(rel)) continue;
    seenPaths.add(rel);
    try {
      const assetUrl = new URL(`/npm/${encodedPkg}/${rel}`, npmCdnBaseUrl);
      const hit = await fetchImageDataUri(assetUrl, fetchFn, cappedTimeout);
      if (hit) return { iconDataUri: hit, discoveredRepo };
    } catch {
      // continue
    }
  }

  return { iconDataUri: null, discoveredRepo };
}

export async function tryUpstreamBrands(
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

export async function tryGithubBrandFallback(
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
    const avatarUrl = new URL(`/${owner}.png?size=512`, avatarBaseUrl);
    return await fetchImageDataUri(avatarUrl, fetchFn, timeoutMs, {}, true);
  } catch {
    return null;
  }
}
