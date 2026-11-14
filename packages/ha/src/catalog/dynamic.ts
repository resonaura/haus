/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { DiscoveryMatcherRule } from '@haus/core';
import { HaIntegrationCatalog } from './loader.js';
import { HaCatalogTranslations, type HaTranslationsIndex } from './translations.js';
import type { HaCatalogIndex, HaCatalogManifest } from './types.js';
import {
  extractComponentsOverlayFromWheel,
  parseHomeAssistantWheel,
  resolveWheelUrlFromPyPi,
} from './wheel.js';

export interface DynamicCatalogOptions {
  readonly baselinePath?: string;
  readonly cachePath?: string;
  readonly baselineTranslationsPath?: string;
  readonly translationsCachePath?: string;
  readonly componentsOverlayBaseDir?: string;
  readonly pypiUrl?: string;
  readonly githubReleasesUrl?: string;
  readonly fetchFn?: typeof fetch;
}

export interface UpstreamVersionCheck {
  readonly latestVersion: string;
  readonly currentVersion: string;
  readonly updateAvailable: boolean;
  readonly releaseSource: 'pypi' | 'github' | 'cached';
}

function writeAtomicGzipJson(targetPath: string, payload: unknown): void {
  const rawJson = JSON.stringify(payload);
  const compressed = gzipSync(Buffer.from(rawJson, 'utf-8'));
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, compressed);
  renameSync(tmpPath, targetPath);
}

function resolveBaselineFile(explicit: string | undefined, filename: string): string {
  if (explicit) return explicit;
  const pkgFile = fileURLToPath(new URL(`../../data/${filename}`, import.meta.url));
  if (existsSync(pkgFile)) return pkgFile;
  if (existsSync(resolve(`packages/ha/data/${filename}`))) {
    return resolve(`packages/ha/data/${filename}`);
  }
  return resolve(`data/${filename}`);
}

export class DynamicCatalogService {
  private activeCatalog: HaIntegrationCatalog;
  private activeTranslations: HaCatalogTranslations;
  private readonly baselinePath: string;
  private readonly cachePath: string;
  private readonly baselineTranslationsPath: string;
  private readonly translationsCachePath: string;
  private readonly componentsOverlayBaseDir: string;
  private readonly pypiUrl: string;
  private readonly githubReleasesUrl: string;
  private readonly customFetch?: typeof fetch;
  private lastETag?: string;

  constructor(options: DynamicCatalogOptions = {}) {
    this.baselinePath = resolveBaselineFile(options.baselinePath, 'ha-catalog-2024.12.5.json.gz');
    this.baselineTranslationsPath = resolveBaselineFile(
      options.baselineTranslationsPath,
      'ha-translations-2024.12.5.json.gz',
    );
    this.cachePath = options.cachePath ?? resolve('.local/cache/ha-catalog-latest.json.gz');
    this.translationsCachePath =
      options.translationsCachePath ??
      join(dirname(this.cachePath), 'ha-translations-latest.json.gz');
    this.componentsOverlayBaseDir =
      options.componentsOverlayBaseDir ?? join(dirname(this.cachePath), 'ha-components');
    this.pypiUrl = options.pypiUrl ?? 'https://pypi.org/pypi/homeassistant/json';
    this.githubReleasesUrl =
      options.githubReleasesUrl ??
      'https://api.github.com/repos/home-assistant/core/releases/latest';
    this.customFetch = options.fetchFn;

    const cached = this.tryLoadFromCache();
    this.activeCatalog = cached ?? HaIntegrationCatalog.fromFile(this.baselinePath, true);

    const cachedTr = this.tryLoadTranslations(this.translationsCachePath);
    const baselineTr = this.tryLoadTranslations(this.baselineTranslationsPath);
    this.activeTranslations =
      cachedTr ?? baselineTr ?? HaCatalogTranslations.empty(this.getVersion());
  }

  getCatalog(): HaIntegrationCatalog {
    return this.activeCatalog;
  }

  getTranslations(): HaCatalogTranslations {
    return this.activeTranslations;
  }

  getVersion(): string {
    return this.activeCatalog.getVersion();
  }

  getTotalIntegrations(): number {
    return this.activeCatalog.getTotalCount();
  }

  getComponentsOverlayDir(): string | undefined {
    const versionDir = join(this.componentsOverlayBaseDir, this.getVersion());
    return existsSync(versionDir) ? versionDir : undefined;
  }

  /**
   * Build discovery matcher rules enriched with HomeKit `alwaysDiscover`
   * metadata from `generated/zeroconf.py` via the active translations bundle.
   */
  getDiscoveryMatcherRules(): DiscoveryMatcherRule[] {
    const baseRules = this.activeCatalog.getDiscoveryMatcherRules();
    const hkModels = this.activeTranslations.getAllHomeKitModels();
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

  private getFetcher(): typeof fetch {
    return this.customFetch ?? globalThis.fetch;
  }

  private tryLoadFromCache(): HaIntegrationCatalog | null {
    if (!existsSync(this.cachePath)) return null;
    try {
      return HaIntegrationCatalog.fromFile(this.cachePath, true);
    } catch {
      return null;
    }
  }

  private tryLoadTranslations(path: string): HaCatalogTranslations | null {
    if (!existsSync(path)) return null;
    try {
      return HaCatalogTranslations.fromFile(path);
    } catch {
      return null;
    }
  }

  async checkUpstreamVersion(): Promise<UpstreamVersionCheck> {
    const fetcher = this.getFetcher();
    const currentVersion = this.activeCatalog.getVersion();

    try {
      const res = await fetcher(this.pypiUrl, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as { info?: { version?: string } };
        const pypiVersion = data.info?.version;
        if (pypiVersion) {
          return {
            latestVersion: pypiVersion,
            currentVersion,
            updateAvailable: pypiVersion !== currentVersion,
            releaseSource: 'pypi',
          };
        }
      }
    } catch {
      // Fall through to GitHub
    }

    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
      if (this.lastETag) headers['If-None-Match'] = this.lastETag;
      const res = await fetcher(this.githubReleasesUrl, { headers });
      const etag = res.headers?.get('etag');
      if (etag) this.lastETag = etag;

      if (res.status === 304) {
        return {
          latestVersion: currentVersion,
          currentVersion,
          updateAvailable: false,
          releaseSource: 'cached',
        };
      }

      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string };
        const rawTag = data.tag_name ?? '';
        const ghVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
        if (ghVersion) {
          return {
            latestVersion: ghVersion,
            currentVersion,
            updateAvailable: ghVersion !== currentVersion,
            releaseSource: 'github',
          };
        }
      }
    } catch {
      // Both network checks failed
    }

    return {
      latestVersion: currentVersion,
      currentVersion,
      updateAvailable: false,
      releaseSource: 'cached',
    };
  }

  saveToCache(catalog: HaIntegrationCatalog): void {
    const manifests = catalog.getAllManifests();
    const manifestMap: Record<string, HaCatalogManifest> = {};
    for (const m of manifests) {
      manifestMap[m.domain] = m;
    }

    const index: HaCatalogIndex = {
      version: catalog.getVersion(),
      releaseTag: catalog.getReleaseTag(),
      license: catalog.getLicense(),
      sourceUrl: `https://github.com/home-assistant/core/releases/tag/${catalog.getVersion()}`,
      totalIntegrations: manifests.length,
      sha256: catalog.getSha256(),
      generatedAt: new Date().toISOString(),
      integrations: manifestMap,
    };

    writeAtomicGzipJson(this.cachePath, index);
  }

  saveTranslationsToCache(index: HaTranslationsIndex): void {
    writeAtomicGzipJson(this.translationsCachePath, index);
  }

  async refreshCatalog(
    newVersion?: string,
    additionalManifests?: readonly HaCatalogManifest[],
  ): Promise<HaIntegrationCatalog> {
    const check = await this.checkUpstreamVersion();
    const targetVersion = newVersion ?? check.latestVersion;
    const fetcher = this.getFetcher();

    if (!additionalManifests) {
      // Attempt full extraction from PyPI wheel so manifests, supported_by, and translations stay in lockstep.
      const resolved = await resolveWheelUrlFromPyPi(targetVersion, fetcher).catch(() => null);
      if (resolved?.wheelUrl) {
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

        const sortedObj: Record<string, HaCatalogManifest> = {};
        for (const key of Object.keys(parsed.manifests).sort()) {
          const item = parsed.manifests[key];
          if (item) sortedObj[key] = item;
        }
        const sha256 = createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex');
        const updatedIndex: HaCatalogIndex = {
          version: resolved.version,
          releaseTag: resolved.version,
          license: this.activeCatalog.getLicense(),
          sourceUrl: `https://github.com/home-assistant/core/releases/tag/${resolved.version}`,
          totalIntegrations: Object.keys(sortedObj).length,
          sha256,
          generatedAt: new Date().toISOString(),
          integrations: sortedObj,
        };
        const updatedCatalog = new HaIntegrationCatalog(updatedIndex);
        this.saveToCache(updatedCatalog);
        this.saveTranslationsToCache(parsed.translationsIndex);
        extractComponentsOverlayFromWheel(
          wheelBuf,
          join(this.componentsOverlayBaseDir, resolved.version),
        );
        this.activeCatalog = updatedCatalog;
        this.activeTranslations = new HaCatalogTranslations(parsed.translationsIndex);
        return updatedCatalog;
      }
    }

    const existingManifests = this.activeCatalog.getAllManifests();
    const manifestMap: Record<string, HaCatalogManifest> = {};
    for (const m of existingManifests) {
      manifestMap[m.domain] = m;
    }
    if (additionalManifests) {
      for (const m of additionalManifests) {
        manifestMap[m.domain] = m;
      }
    }

    const sortedObj: Record<string, HaCatalogManifest> = {};
    for (const k of Object.keys(manifestMap).sort()) {
      const entry = manifestMap[k];
      if (entry) sortedObj[k] = entry;
    }

    const sha256 = createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex');
    const updatedIndex: HaCatalogIndex = {
      version: targetVersion,
      releaseTag: targetVersion,
      license: this.activeCatalog.getLicense(),
      sourceUrl: `https://github.com/home-assistant/core/releases/tag/${targetVersion}`,
      totalIntegrations: Object.keys(sortedObj).length,
      sha256,
      generatedAt: new Date().toISOString(),
      integrations: sortedObj,
    };

    const updatedCatalog = new HaIntegrationCatalog(updatedIndex);
    this.saveToCache(updatedCatalog);
    this.activeCatalog = updatedCatalog;
    return updatedCatalog;
  }
}
