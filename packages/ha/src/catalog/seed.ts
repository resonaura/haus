/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { computeCatalogChecksum } from './loader.js';
import { computeTranslationsChecksum, type HaTranslationsIndex } from './translations.js';
import type { HaCatalogIndex, HaCatalogManifest } from './types.js';
import { extractGeneratedMetadataFromPy, parseManifestRecord } from './wheel.js';

export const DEFAULT_CATALOG_SEED_DIR = '/opt/ha-catalog-seed';
export const LATEST_CATALOG_FILENAME = 'ha-catalog-latest.json.gz';
export const LATEST_TRANSLATIONS_FILENAME = 'ha-translations-latest.json.gz';

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: boolean;
  readonly preTag: string;
}

function parseHaVersion(raw: string): ParsedVersion | null {
  const clean = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(clean);
  if (!match) return null;
  const suffix = (match[4] ?? '').trim();
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: suffix.length > 0,
    preTag: suffix,
  };
}

/** Compares two Home Assistant version strings (`YYYY.MM.patch`). Returns 1, 0, or -1. */
export function compareHaVersions(a: string, b: string): number {
  const pa = parseHaVersion(a);
  const pb = parseHaVersion(b);
  if (!pa || !pb) {
    return a.localeCompare(b);
  }
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  if (pa.prerelease !== pb.prerelease) return pa.prerelease ? -1 : 1;
  if (pa.preTag !== pb.preTag) return pa.preTag > pb.preTag ? 1 : -1;
  return 0;
}

export function writeAtomicGzipJson(targetPath: string, payload: unknown): void {
  const rawJson = JSON.stringify(payload);
  const compressed = gzipSync(Buffer.from(rawJson, 'utf-8'));
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, compressed);
  renameSync(tmpPath, targetPath);
}

export function resolveSeedCatalogPaths(
  explicitSeedPath?: string,
  explicitSeedTranslationsPath?: string,
): { readonly catalogPath?: string; readonly translationsPath?: string } {
  if (explicitSeedPath || explicitSeedTranslationsPath) {
    return {
      catalogPath: explicitSeedPath,
      translationsPath: explicitSeedTranslationsPath,
    };
  }
  const envDir = process.env.HAUS_CATALOG_SEED_DIR?.trim();
  const candidates = [envDir ? resolve(envDir) : undefined, DEFAULT_CATALOG_SEED_DIR].filter(
    (entry): entry is string => Boolean(entry),
  );
  for (const dir of candidates) {
    const cat = join(dir, LATEST_CATALOG_FILENAME);
    if (existsSync(cat)) {
      const tr = join(dir, LATEST_TRANSLATIONS_FILENAME);
      return {
        catalogPath: cat,
        translationsPath: existsSync(tr) ? tr : undefined,
      };
    }
  }
  return {};
}

export function detectHaVersionFromDirectory(haRootDir: string): string | undefined {
  const constPath = join(haRootDir, 'const.py');
  if (!existsSync(constPath)) return undefined;
  const content = readFileSync(constPath, 'utf-8');
  const major = /MAJOR_VERSION(?::\s*\w+)?\s*=\s*(\d+)/.exec(content)?.[1];
  const minor = /MINOR_VERSION(?::\s*\w+)?\s*=\s*(\d+)/.exec(content)?.[1];
  const patch = /PATCH_VERSION(?::\s*\w+)?\s*=\s*["']([^"']+)["']/.exec(content)?.[1];
  if (major && minor && patch) {
    return `${major}.${minor}.${patch}`;
  }
  const explicit = /__version__\s*=\s*["']([^"']+)["']/.exec(content)?.[1];
  return explicit || undefined;
}

export function extractCatalogFromHaDirectory(
  haRootDir: string,
  options: { readonly version?: string; readonly license?: string } = {},
): {
  readonly version: string;
  readonly catalogIndex: HaCatalogIndex;
  readonly translationsIndex: HaTranslationsIndex;
} {
  const root = resolve(haRootDir);
  const componentsDir = existsSync(join(root, 'components')) ? join(root, 'components') : root;
  if (!existsSync(componentsDir)) {
    throw new Error(`ha_components_dir_not_found:${componentsDir}`);
  }
  const generatedDir = existsSync(join(root, 'generated'))
    ? join(root, 'generated')
    : resolve(componentsDir, '..', 'generated');

  const detectedVersion = detectHaVersionFromDirectory(
    existsSync(join(root, 'const.py')) ? root : resolve(componentsDir, '..'),
  );
  const version = options.version ?? detectedVersion;
  if (!version) {
    throw new Error(`ha_version_undetected:${root}`);
  }
  const license = options.license ?? 'Apache-2.0';

  const manifests: Record<string, HaCatalogManifest> = {};
  const translations: Record<string, Record<string, unknown>> = {};
  const supportedBy: Record<string, string> = {};
  const configFlowDomains = new Set<string>();

  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const compDir = join(componentsDir, entry.name);
    const manifestPath = join(compDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
        const manifest = parseManifestRecord(entry.name, parsed);
        manifests[manifest.domain] = manifest;
        if (manifest.supported_by) {
          supportedBy[manifest.domain] = manifest.supported_by;
        }
        if (manifest.config_flow) {
          configFlowDomains.add(manifest.domain);
        }
      } catch {
        // Ignore malformed individual manifest files.
      }
    }

    const enPath = join(compDir, 'translations', 'en.json');
    if (existsSync(enPath)) {
      try {
        const parsed = JSON.parse(readFileSync(enPath, 'utf-8')) as Record<string, unknown>;
        translations[entry.name] = parsed;
      } catch {
        // Ignore malformed individual translation files.
      }
    }
  }

  const sortedManifests: Record<string, HaCatalogManifest> = {};
  for (const key of Object.keys(manifests).sort()) {
    const manifest = manifests[key];
    if (!manifest) continue;
    sortedManifests[key] = manifest;
    const existing = translations[manifest.domain];
    if (!existing) {
      translations[manifest.domain] = { title: manifest.name };
    } else if (typeof existing.title !== 'string' || !existing.title) {
      translations[manifest.domain] = { ...existing, title: manifest.name };
    }
  }

  const readOptional = (filePath: string): string | undefined =>
    existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined;
  const generated = extractGeneratedMetadataFromPy({
    zeroconfPy: readOptional(join(generatedDir, 'zeroconf.py')),
    configFlowsPy: readOptional(join(generatedDir, 'config_flows.py')),
    applicationCredentialsPy: readOptional(join(generatedDir, 'application_credentials.py')),
  });

  const allFlowHandlers = new Set<string>(generated.flowHandlers);
  for (const domain of configFlowDomains) {
    allFlowHandlers.add(domain);
  }
  for (const [virtualDomain, parentDomain] of Object.entries(supportedBy)) {
    if (allFlowHandlers.has(parentDomain)) {
      allFlowHandlers.add(virtualDomain);
    }
  }

  const catalogChecksum =
    Object.keys(sortedManifests).length > 0
      ? computeCatalogChecksum(sortedManifests)
      : createHash('sha256').update('{}').digest('hex');

  const catalogIndex: HaCatalogIndex = {
    version,
    releaseTag: version,
    license,
    sourceUrl: `https://github.com/home-assistant/core/releases/tag/${version}`,
    totalIntegrations: Object.keys(sortedManifests).length,
    sha256: catalogChecksum,
    generatedAt: new Date().toISOString(),
    integrations: sortedManifests,
  };

  const baseTranslations = {
    version,
    translations,
    supportedBy,
    homekitModels: generated.homekitModels,
    flowHandlers: [...allFlowHandlers].sort(),
    applicationCredentials: generated.applicationCredentials,
  };

  const translationsIndex: HaTranslationsIndex = {
    ...baseTranslations,
    sha256: computeTranslationsChecksum(baseTranslations),
    generatedAt: catalogIndex.generatedAt,
  };

  return {
    version,
    catalogIndex,
    translationsIndex,
  };
}
