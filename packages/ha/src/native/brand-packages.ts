/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import {
  isValidDomainToken,
  parseGithubRepo,
  type BrandIconHint,
  type BrandIconKind,
  type GithubRepoRef,
} from './brand-fallbacks.js';
import { boundedBody } from './validation.js';

const PACKAGE_META_MAX_BYTES = 64 * 1024;

export type ImageDataFetcher = (
  url: URL,
  fetchFn: typeof fetch,
  timeoutMs: number,
  headers?: Record<string, string>,
  allowSafeGithubRedirect?: boolean,
) => Promise<string | null>;

export function mimeForIconExtension(path: string): string | null {
  switch (extname(path).toLowerCase()) {
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

export function sniffRasterImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 8) {
    if (
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
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function isPathWithinDir(baseDir: string, targetPath: string): boolean {
  const baseResolved = resolve(baseDir);
  const targetResolved = resolve(targetPath);
  return targetResolved.startsWith(baseResolved + sep);
}

async function readSafeIconFile(
  baseDir: string,
  iconPath: string,
  maxBytes: number,
): Promise<string | null> {
  if (!isPathWithinDir(baseDir, iconPath)) return null;
  const mime = mimeForIconExtension(iconPath);
  if (!mime) return null;
  try {
    const info = await stat(iconPath);
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) return null;
    const bytes = await readFile(iconPath);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Reads local HA integration brand icons across both HA 2026.3+ `brand/`
 * subfolders and legacy integration root files, honoring `supported_by`.
 */
export async function readLocalIntegrationDirectoryIcon(
  dirs: readonly string[],
  domains: string[],
  dark: boolean,
  maxBytes: number,
): Promise<string | null> {
  const baseNames = dark
    ? [
        'dark_icon@2x.png',
        'dark_icon.png',
        'icon@2x.png',
        'icon.png',
        'dark_logo@2x.png',
        'logo@2x.png',
        'logo.png',
        'icon.svg',
        'logo.svg',
      ]
    : ['icon@2x.png', 'icon.png', 'logo@2x.png', 'logo.png', 'icon.svg', 'logo.svg'];
  const variants = [...baseNames.map((file) => `brand/${file}`), ...baseNames];

  for (const dir of dirs) {
    if (!dir) continue;
    for (let i = 0; i < domains.length; i += 1) {
      const domain = domains[i]!;
      const manifestPath = resolve(dir, domain, 'manifest.json');
      if (isPathWithinDir(dir, manifestPath)) {
        try {
          const rawManifest = await readFile(manifestPath, 'utf8');
          const parsed = JSON.parse(rawManifest) as { supported_by?: unknown };
          if (typeof parsed.supported_by === 'string') {
            const sb = parsed.supported_by.trim().toLowerCase();
            if (isValidDomainToken(sb) && !domains.includes(sb)) {
              domains.push(sb);
            }
          }
        } catch {
          // ignore absent or unreadable manifest
        }
      }

      for (const file of variants) {
        const hit = await readSafeIconFile(dir, resolve(dir, domain, file), maxBytes);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function cleanRelativeIconPath(raw: unknown): string | null {
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

function extractDeclaredPluginIconPath(pkg: Record<string, unknown>): string | null {
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

function extractPackageGithubRepo(pkg: Record<string, unknown>): GithubRepoRef | null {
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

/** Reads an icon shipped inside a locally installed Homebridge/Scrypted/Node plugin directory. */
export async function readLocalPluginDirectoryIcon(
  dirs: readonly string[],
  id: string,
  maxBytes: number,
): Promise<string | null> {
  const pkgPaths = id.startsWith('@') && id.includes('/') ? [id.split('/', 2)] : [[id]];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const segments of pkgPaths) {
      const pkgDir = resolve(dir, ...segments);
      if (!isPathWithinDir(dir, pkgDir)) continue;

      const candidates: string[] = [];
      try {
        const rawPkg = await readFile(resolve(pkgDir, 'package.json'), 'utf8');
        const parsed = JSON.parse(rawPkg) as Record<string, unknown>;
        const declared = extractDeclaredPluginIconPath(parsed);
        if (declared) candidates.push(declared);
      } catch {
        // ignore absent package.json
      }

      candidates.push(
        'homebridge-ui/public/icon.png',
        'homebridge-ui/public/logo.png',
        'branding/icon.png',
        'assets/icon.png',
        'public/icon.png',
        'images/icon.png',
        'icon@2x.png',
        'icon.png',
        'logo.png',
        'icon.svg',
        'logo.svg',
      );

      for (const rel of candidates) {
        const hit = await readSafeIconFile(pkgDir, resolve(pkgDir, rel), maxBytes);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export interface PluginPackageLookupResult {
  readonly iconDataUri: string | null;
  readonly discoveredRepo: GithubRepoRef | null;
}

/**
 * Resolves native icons bundled by Homebridge or Scrypted plugins via npm CDN
 * (`package.json` `icon` / `scrypted.icon` / `homebridge.icon` + common plugin asset paths)
 * and discovers their GitHub repository for upstream fallback.
 */
export async function resolvePluginPackageAssets(options: {
  readonly kind: BrandIconKind;
  readonly id: string;
  readonly hint?: BrandIconHint;
  readonly npmCdnBaseUrl: string;
  readonly githubRawBaseUrl: string;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs: number;
  readonly fetchImage: ImageDataFetcher;
}): Promise<PluginPackageLookupResult> {
  const { kind, id, hint, npmCdnBaseUrl, githubRawBaseUrl, fetchFn, timeoutMs, fetchImage } =
    options;
  const isPlugin =
    kind === 'homebridge' ||
    kind === 'scrypted' ||
    kind === 'plugin' ||
    id.startsWith('@') ||
    id.startsWith('homebridge-') ||
    id.startsWith('scrypted-');
  if (!isPlugin) return { iconDataUri: null, discoveredRepo: null };

  const cappedTimeout = Math.min(timeoutMs, 3_000);

  // Official @scrypted/<plugin> monorepo plugins store icons under plugins/<name>/
  if (id.startsWith('@scrypted/')) {
    const short = encodeURIComponent(id.slice('@scrypted/'.length));
    for (const rel of ['icon.png', 'logo.png', 'assets/icon.png', 'public/icon.png']) {
      try {
        const target = new URL(`/koush/scrypted/HEAD/plugins/${short}/${rel}`, githubRawBaseUrl);
        const hit = await fetchImage(target, fetchFn, cappedTimeout);
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
      const body = await boundedBody(res, PACKAGE_META_MAX_BYTES);
      const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      declaredIcon = extractDeclaredPluginIconPath(parsed);
      if (!discoveredRepo) {
        discoveredRepo = extractPackageGithubRepo(parsed);
      }
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
      const hit = await fetchImage(assetUrl, fetchFn, cappedTimeout);
      if (hit) return { iconDataUri: hit, discoveredRepo };
    } catch {
      // continue
    }
  }

  return { iconDataUri: null, discoveredRepo };
}
