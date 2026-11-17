/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveryMatcherRule } from '@haus/core';
import { HaIntegrationCatalog } from './loader.js';
import { compareHaVersions } from './seed.js';
import { HaCatalogTranslations, type HaTranslationsIndex } from './translations.js';
import type { HaCatalogIndex, HaCatalogManifest } from './types.js';
import {
  extractComponentsOverlayFromWheel,
  parseHomeAssistantWheel,
  resolveWheelUrlFromPyPi,
} from './wheel.js';

export interface UpstreamVersionCheck {
  readonly latestVersion: string;
  readonly currentVersion: string;
  readonly updateAvailable: boolean;
  readonly releaseSource: 'pypi' | 'github' | 'cached';
}

export function resolveBaselineFile(explicit: string | undefined, filename: string): string {
  if (explicit) return explicit;
  const pkgFile = fileURLToPath(new URL(`../../data/${filename}`, import.meta.url));
  if (existsSync(pkgFile)) return pkgFile;
  if (existsSync(resolve(`packages/ha/data/${filename}`))) {
    return resolve(`packages/ha/data/${filename}`);
  }
  return resolve(`data/${filename}`);
}

export function createTimedFetcher(baseFetch: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init) => {
    if (init?.signal) {
      return baseFetch(input, init);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export function buildCatalogIndex(
  manifests: Record<string, HaCatalogManifest>,
  version: string,
  license: string,
): HaCatalogIndex {
  const sortedObj: Record<string, HaCatalogManifest> = {};
  for (const key of Object.keys(manifests).sort()) {
    const item = manifests[key];
    if (item) sortedObj[key] = item;
  }
  const sha256 = createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex');
  return {
    version,
    releaseTag: version,
    license,
    sourceUrl: `https://github.com/home-assistant/core/releases/tag/${version}`,
    totalIntegrations: Object.keys(sortedObj).length,
    sha256,
    generatedAt: new Date().toISOString(),
    integrations: sortedObj,
  };
}

export function selectInitialCatalogBundle(params: {
  baseline: HaIntegrationCatalog;
  cached: HaIntegrationCatalog | null;
  seed: HaIntegrationCatalog | null;
  baselineTr: HaCatalogTranslations | null;
  cachedTr: HaCatalogTranslations | null;
  seedTr: HaCatalogTranslations | null;
}): {
  catalog: HaIntegrationCatalog;
  translations: HaCatalogTranslations;
} {
  const { baseline, cached, seed, baselineTr, cachedTr, seedTr } = params;
  const cachedPoisoned =
    cached !== null &&
    cached.getSha256() === baseline.getSha256() &&
    cached.getVersion() !== baseline.getVersion();

  let selectedSource: 'cache' | 'seed' | 'baseline' = 'baseline';
  let selectedCatalog = baseline;

  if (cached && (!cachedPoisoned || !seed)) {
    selectedCatalog = cached;
    selectedSource = 'cache';
  }

  if (seed) {
    const seedBeatsCurrent =
      selectedSource === 'baseline' ||
      cachedPoisoned ||
      compareHaVersions(seed.getVersion(), selectedCatalog.getVersion()) > 0;
    if (seedBeatsCurrent) {
      selectedCatalog = seed;
      selectedSource = 'seed';
    }
  }

  const activeVersion = selectedCatalog.getVersion();
  const matchingTr =
    selectedSource === 'seed'
      ? (seedTr ?? (cachedTr?.getVersion() === activeVersion ? cachedTr : null))
      : selectedSource === 'cache'
        ? ((cachedTr?.getVersion() === activeVersion ? cachedTr : null) ??
          (seedTr?.getVersion() === activeVersion ? seedTr : null) ??
          cachedTr)
        : null;

  return {
    catalog: selectedCatalog,
    translations: matchingTr ?? seedTr ?? baselineTr ?? HaCatalogTranslations.empty(activeVersion),
  };
}

export function enrichDiscoveryMatcherRules(
  catalog: HaIntegrationCatalog,
  translations: HaCatalogTranslations,
): DiscoveryMatcherRule[] {
  const baseRules = catalog.getDiscoveryMatcherRules();
  const hkModels = translations.getAllHomeKitModels();
  const byDomain = new Map<string, { models: Set<string>; alwaysDiscover: boolean }>();
  for (const [model, meta] of Object.entries(hkModels)) {
    let bucket = byDomain.get(meta.domain);
    if (!bucket) {
      bucket = { models: new Set<string>(), alwaysDiscover: meta.alwaysDiscover };
      byDomain.set(meta.domain, bucket);
    }
    bucket.models.add(model);
    if (!meta.alwaysDiscover) bucket.alwaysDiscover = false;
  }

  const seenDomains = new Set<string>();
  const enriched: DiscoveryMatcherRule[] = baseRules.map((rule) => {
    seenDomains.add(rule.domain);
    const hk = byDomain.get(rule.domain);
    if (!hk) return rule;
    const mergedModels = new Set<string>([...(rule.homekit?.models ?? []), ...hk.models]);
    return {
      ...rule,
      homekit: {
        models: Array.from(mergedModels),
        alwaysDiscover: hk.alwaysDiscover,
      },
    };
  });

  for (const [domain, hk] of byDomain.entries()) {
    if (seenDomains.has(domain)) continue;
    enriched.push({
      domain,
      homekit: { models: Array.from(hk.models), alwaysDiscover: hk.alwaysDiscover },
    });
  }
  return enriched;
}

export async function checkUpstreamReleaseVersion(params: {
  fetcher: typeof fetch;
  pypiUrl: string;
  githubReleasesUrl: string;
  currentVersion: string;
  lastETag?: string;
}): Promise<{ check: UpstreamVersionCheck; etag?: string; checked: boolean }> {
  const { fetcher, pypiUrl, githubReleasesUrl, currentVersion, lastETag } = params;

  try {
    const res = await fetcher(pypiUrl, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as { info?: { version?: string } };
      const pypiVersion = data.info?.version;
      if (pypiVersion) {
        return {
          checked: true,
          etag: lastETag,
          check: {
            latestVersion: pypiVersion,
            currentVersion,
            updateAvailable: compareHaVersions(pypiVersion, currentVersion) > 0,
            releaseSource: 'pypi',
          },
        };
      }
    }
  } catch {
    // Fall through to GitHub
  }

  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
    if (lastETag) headers['If-None-Match'] = lastETag;
    const res = await fetcher(githubReleasesUrl, { headers });
    const nextETag = res.headers?.get('etag') ?? lastETag;

    if (res.status === 304) {
      return {
        checked: true,
        etag: nextETag,
        check: {
          latestVersion: currentVersion,
          currentVersion,
          updateAvailable: false,
          releaseSource: 'cached',
        },
      };
    }

    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string };
      const rawTag = data.tag_name ?? '';
      const ghVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
      if (ghVersion) {
        return {
          checked: true,
          etag: nextETag,
          check: {
            latestVersion: ghVersion,
            currentVersion,
            updateAvailable: compareHaVersions(ghVersion, currentVersion) > 0,
            releaseSource: 'github',
          },
        };
      }
    }
  } catch {
    // Both network checks failed
  }

  return {
    checked: false,
    etag: lastETag,
    check: {
      latestVersion: currentVersion,
      currentVersion,
      updateAvailable: false,
      releaseSource: 'cached',
    },
  };
}

export async function downloadAndExtractWheelCatalog(params: {
  fetcher: typeof fetch;
  requestedVersion?: string;
  license: string;
  componentsOverlayBaseDir: string;
}): Promise<{
  catalog: HaIntegrationCatalog;
  translations: HaTranslationsIndex;
}> {
  const { fetcher, requestedVersion, license, componentsOverlayBaseDir } = params;

  let resolved = await resolveWheelUrlFromPyPi(requestedVersion, fetcher).catch(() => null);
  if (!resolved?.wheelUrl && requestedVersion) {
    resolved = await resolveWheelUrlFromPyPi(undefined, fetcher).catch(() => null);
  }
  if (!resolved?.wheelUrl) {
    throw new Error(
      `Failed resolving Home Assistant wheel from PyPI${requestedVersion ? ` (${requestedVersion})` : ''}`,
    );
  }

  const wheelRes = await fetcher(resolved.wheelUrl);
  if (!wheelRes.ok) {
    throw new Error(
      `Failed downloading Home Assistant ${resolved.version} wheel (${wheelRes.status})`,
    );
  }
  const wheelBuf = Buffer.from(await wheelRes.arrayBuffer());
  const parsed = parseHomeAssistantWheel(wheelBuf, resolved.version);
  if (Object.keys(parsed.manifests).length < 500) {
    throw new Error(
      `Parsed HA wheel has too few manifests (${Object.keys(parsed.manifests).length})`,
    );
  }

  const updatedIndex = buildCatalogIndex(parsed.manifests, resolved.version, license);
  extractComponentsOverlayFromWheel(wheelBuf, join(componentsOverlayBaseDir, resolved.version));
  return {
    catalog: new HaIntegrationCatalog(updatedIndex),
    translations: parsed.translationsIndex,
  };
}
