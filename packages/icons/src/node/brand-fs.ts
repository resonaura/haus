/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';

export interface NodeBrandLocalLookupOptions {
  readonly localAddonDirs?: readonly string[];
  readonly localIntegrationDirs?: readonly string[];
  readonly localPluginDirs?: readonly string[];
}

export interface NodeBrandLookupContext {
  readonly kind: string;
  readonly id: string;
  readonly candidates: string[];
  readonly dark: boolean;
  readonly hint?: {
    readonly addonSlug?: string;
    readonly addonConfigPath?: string;
  };
  readonly maxBytes: number;
}

function mimeForExtension(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
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

function isPathWithinDir(baseDir: string, targetPath: string): boolean {
  const baseResolved = resolve(baseDir);
  const targetResolved = resolve(targetPath);
  return targetResolved.startsWith(baseResolved + sep);
}

function isValidDomainToken(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(token) &&
    !token.includes('..')
  );
}

async function readSafeIconFile(
  baseDir: string,
  iconPath: string,
  maxBytes: number,
): Promise<string | null> {
  if (!isPathWithinDir(baseDir, iconPath)) return null;
  const mime = mimeForExtension(iconPath);
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

function stripAddonPrefix(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const m = /^(?:core|local|[a-f0-9]{6,12})_(.+)$/.exec(lower);
  return m?.[1] ?? lower;
}

function cleanConfigSubdir(configPath: string | undefined): string | null {
  if (!configPath) return null;
  const dir = dirname(configPath.trim().replace(/^\/+/, ''));
  if (!dir || dir === '.' || dir.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(dir)) {
    return null;
  }
  return dir;
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
    !mimeForExtension(trimmed)
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

export async function readNodeAddonDirectoryIcon(
  dirs: readonly string[],
  id: string,
  hint: { readonly addonSlug?: string; readonly addonConfigPath?: string } | undefined,
  maxBytes: number,
): Promise<string | null> {
  const rawIds = [id, hint?.addonSlug].filter((v): v is string => Boolean(v));
  const folderNames = new Set<string>();
  for (const raw of rawIds) {
    const clean = raw.trim();
    if (!clean || clean.includes('..') || clean.includes('/')) continue;
    folderNames.add(clean);
    const slug = stripAddonPrefix(clean);
    if (slug) folderNames.add(slug);
  }
  const configSubdir = cleanConfigSubdir(hint?.addonConfigPath);
  const files = [
    ...(configSubdir
      ? [`${configSubdir}/icon@2x.png`, `${configSubdir}/icon.png`, `${configSubdir}/logo.png`]
      : []),
    'icon@2x.png',
    'icon.png',
    'logo@2x.png',
    'logo.png',
    'assets/icon.png',
    'icon.svg',
    'logo.svg',
  ];

  for (const base of dirs) {
    if (!base) continue;
    for (const folder of folderNames) {
      const addonDir = resolve(base, folder);
      if (!isPathWithinDir(base, addonDir)) continue;
      for (const file of files) {
        const hit = await readSafeIconFile(addonDir, resolve(addonDir, file), maxBytes);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export async function readNodeIntegrationDirectoryIcon(
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
            if (isValidDomainToken(sb) && !domains.includes(sb)) domains.push(sb);
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

export async function readNodePluginDirectoryIcon(
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

export function createNodeBrandLocalLookup(
  options: NodeBrandLocalLookupOptions,
): (context: NodeBrandLookupContext) => Promise<string | null> {
  return async (context) => {
    const isAddonLike = context.kind === 'addon' || context.kind === 'app';
    if (isAddonLike && options.localAddonDirs?.length) {
      const hit = await readNodeAddonDirectoryIcon(
        options.localAddonDirs,
        context.id,
        context.hint,
        context.maxBytes,
      );
      if (hit) return hit;
    }
    if (options.localIntegrationDirs?.length) {
      const hit = await readNodeIntegrationDirectoryIcon(
        options.localIntegrationDirs,
        context.candidates,
        context.dark,
        context.maxBytes,
      );
      if (hit) return hit;
    }
    if (options.localPluginDirs?.length) {
      const hit = await readNodePluginDirectoryIcon(
        options.localPluginDirs,
        context.id,
        context.maxBytes,
      );
      if (hit) return hit;
    }
    return null;
  };
}
