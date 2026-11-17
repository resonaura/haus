/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, statSync, utimesSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DiscoveryMatcherRule } from '@haus/core';
import { HaIntegrationCatalog } from './loader.js';
import {
  compareHaVersions,
  LATEST_TRANSLATIONS_FILENAME,
  resolveSeedCatalogPaths,
  writeAtomicGzipJson,
} from './seed.js';
import { HaCatalogTranslations, type HaTranslationsIndex } from './translations.js';
import type { HaCatalogIndex, HaCatalogManifest } from './types.js';
import {
  buildCatalogIndex,
  checkUpstreamReleaseVersion,
  createTimedFetcher,
  downloadAndExtractWheelCatalog,
  enrichDiscoveryMatcherRules,
  resolveBaselineFile,
  selectInitialCatalogBundle,
  type UpstreamVersionCheck,
} from './upstream.js';

export type { UpstreamVersionCheck } from './upstream.js';

export interface DynamicCatalogOptions {
  readonly baselinePath?: string;
  readonly cachePath?: string;
  readonly seedPath?: string;
  readonly baselineTranslationsPath?: string;
  readonly translationsCachePath?: string;
  readonly seedTranslationsPath?: string;
  readonly componentsOverlayBaseDir?: string;
  readonly pypiUrl?: string;
  readonly githubReleasesUrl?: string;
  readonly fetchFn?: typeof fetch;
}

export interface EnsureLatestCatalogOptions {
  readonly force?: boolean;
  readonly maxAgeMs?: number;
}

export interface EnsureLatestCatalogResult {
  readonly status: 'updated' | 'up_to_date' | 'offline';
  readonly previousVersion: string;
  readonly version: string;
  readonly total: number;
  readonly source: 'wheel' | 'cached';
  readonly error?: string;
}

const DEFAULT_METADATA_TIMEOUT_MS = 15_000;
const DEFAULT_WHEEL_TIMEOUT_MS = 120_000;
const DEFAULT_SYNC_MAX_AGE_MS = 24 * 60 * 60_000;

export class DynamicCatalogService {
  private activeCatalog: HaIntegrationCatalog;
  private activeTranslations: HaCatalogTranslations;
  private readonly baselinePath: string;
  private readonly cachePath: string;
  private readonly seedPath?: string;
  private readonly baselineTranslationsPath: string;
  private readonly translationsCachePath: string;
  private readonly seedTranslationsPath?: string;
  private readonly baselineSha256: string;
  private readonly baselineVersion: string;
  private readonly componentsOverlayBaseDir: string;
  private readonly pypiUrl: string;
  private readonly githubReleasesUrl: string;
  private readonly customFetch?: typeof fetch;
  private lastETag?: string;
  private lastCheckedAt?: number;
  private refreshInFlight?: Promise<HaIntegrationCatalog>;
  private syncInFlight?: Promise<EnsureLatestCatalogResult>;

  constructor(options: DynamicCatalogOptions = {}) {
    this.baselinePath = resolveBaselineFile(options.baselinePath, 'ha-catalog-2024.12.5.json.gz');
    this.baselineTranslationsPath = resolveBaselineFile(
      options.baselineTranslationsPath,
      'ha-translations-2024.12.5.json.gz',
    );
    this.cachePath = options.cachePath ?? resolve('.local/cache/ha-catalog-latest.json.gz');
    this.translationsCachePath =
      options.translationsCachePath ?? join(dirname(this.cachePath), LATEST_TRANSLATIONS_FILENAME);
    this.componentsOverlayBaseDir =
      options.componentsOverlayBaseDir ?? join(dirname(this.cachePath), 'ha-components');

    const resolvedSeeds = resolveSeedCatalogPaths(options.seedPath, options.seedTranslationsPath);
    this.seedPath = resolvedSeeds.catalogPath;
    this.seedTranslationsPath = resolvedSeeds.translationsPath;

    this.pypiUrl = options.pypiUrl ?? 'https://pypi.org/pypi/homeassistant/json';
    this.githubReleasesUrl =
      options.githubReleasesUrl ??
      'https://api.github.com/repos/home-assistant/core/releases/latest';
    this.customFetch = options.fetchFn;

    const baseline = HaIntegrationCatalog.fromFile(this.baselinePath, true);
    this.baselineSha256 = baseline.getSha256();
    this.baselineVersion = baseline.getVersion();

    const selected = selectInitialCatalogBundle({
      baseline,
      cached: this.tryLoadCatalog(this.cachePath),
      seed: this.seedPath ? this.tryLoadCatalog(this.seedPath) : null,
      baselineTr: this.tryLoadTranslations(this.baselineTranslationsPath),
      cachedTr: this.tryLoadTranslations(this.translationsCachePath),
      seedTr: this.seedTranslationsPath
        ? this.tryLoadTranslations(this.seedTranslationsPath)
        : null,
    });
    this.activeCatalog = selected.catalog;
    this.activeTranslations = selected.translations;
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

  getCachePath(): string {
    return this.cachePath;
  }

  getComponentsOverlayDir(): string | undefined {
    const versionDir = join(this.componentsOverlayBaseDir, this.getVersion());
    return existsSync(versionDir) ? versionDir : undefined;
  }

  reloadFromDisk(): boolean {
    const prevSha = this.activeCatalog.getSha256();
    const prevVer = this.activeCatalog.getVersion();
    const baseline = HaIntegrationCatalog.fromFile(this.baselinePath, true);
    const selected = selectInitialCatalogBundle({
      baseline,
      cached: this.tryLoadCatalog(this.cachePath),
      seed: this.seedPath ? this.tryLoadCatalog(this.seedPath) : null,
      baselineTr: this.tryLoadTranslations(this.baselineTranslationsPath),
      cachedTr: this.tryLoadTranslations(this.translationsCachePath),
      seedTr: this.seedTranslationsPath
        ? this.tryLoadTranslations(this.seedTranslationsPath)
        : null,
    });
    this.activeCatalog = selected.catalog;
    this.activeTranslations = selected.translations;
    return selected.catalog.getVersion() !== prevVer || selected.catalog.getSha256() !== prevSha;
  }

  private hasMatchingSeed(version: string): boolean {
    if (!this.seedPath || !this.seedTranslationsPath) return false;
    const seed = this.tryLoadCatalog(this.seedPath);
    if (!seed || seed.getTotalCount() < 500 || compareHaVersions(seed.getVersion(), version) < 0) {
      return false;
    }
    const seedTr = this.tryLoadTranslations(this.seedTranslationsPath);
    return Boolean(
      seedTr &&
      seedTr.getVersion() === seed.getVersion() &&
      Object.keys(seedTr.getIndex().translations).length >= 500,
    );
  }

  isCacheComplete(version = this.getVersion()): boolean {
    if (!existsSync(this.cachePath) || !existsSync(this.translationsCachePath)) {
      return false;
    }
    const cached = this.tryLoadCatalog(this.cachePath);
    if (!cached || cached.getVersion() !== version) {
      return false;
    }
    if (cached.getSha256() === this.baselineSha256 && version !== this.baselineVersion) {
      return false;
    }
    const cachedTr = this.tryLoadTranslations(this.translationsCachePath);
    if (!cachedTr || cachedTr.getVersion() !== version) {
      return false;
    }
    if (Object.keys(cachedTr.getIndex().translations).length < 500) {
      return false;
    }
    return (
      existsSync(join(this.componentsOverlayBaseDir, version)) || this.hasMatchingSeed(version)
    );
  }

  private getCacheAgeMs(): number | undefined {
    if (!existsSync(this.cachePath)) return undefined;
    try {
      return Math.max(0, Date.now() - statSync(this.cachePath).mtimeMs);
    } catch {
      return undefined;
    }
  }

  private touchCacheTimestamp(): void {
    try {
      const now = new Date();
      utimesSync(this.cachePath, now, now);
    } catch {
      // Best-effort mtime refresh only
    }
  }

  /**
   * Build discovery matcher rules enriched with HomeKit `alwaysDiscover`
   * metadata from `generated/zeroconf.py` via the active translations bundle.
   */
  getDiscoveryMatcherRules(): DiscoveryMatcherRule[] {
    return enrichDiscoveryMatcherRules(this.activeCatalog, this.activeTranslations);
  }

  private getBaseFetch(): typeof fetch {
    return this.customFetch ?? globalThis.fetch;
  }

  private tryLoadCatalog(path: string): HaIntegrationCatalog | null {
    if (!existsSync(path)) return null;
    try {
      return HaIntegrationCatalog.fromFile(path, true);
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
    const result = await checkUpstreamReleaseVersion({
      fetcher: createTimedFetcher(this.getBaseFetch(), DEFAULT_METADATA_TIMEOUT_MS),
      pypiUrl: this.pypiUrl,
      githubReleasesUrl: this.githubReleasesUrl,
      currentVersion: this.activeCatalog.getVersion(),
      lastETag: this.lastETag,
    });
    this.lastETag = result.etag;
    if (result.checked) {
      this.lastCheckedAt = Date.now();
    }
    return result.check;
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
    if (!newVersion && !additionalManifests && this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const work = this.performRefreshCatalog(newVersion, additionalManifests);
    if (!newVersion && !additionalManifests) {
      const tracked = work.finally(() => {
        if (this.refreshInFlight === tracked) {
          this.refreshInFlight = undefined;
        }
      });
      this.refreshInFlight = tracked;
      return tracked;
    }
    return work;
  }

  private async performRefreshCatalog(
    newVersion?: string,
    additionalManifests?: readonly HaCatalogManifest[],
  ): Promise<HaIntegrationCatalog> {
    if (!additionalManifests) {
      let requestedVersion = newVersion;
      if (!requestedVersion) {
        const check = await this.checkUpstreamVersion();
        requestedVersion = check.releaseSource !== 'cached' ? check.latestVersion : undefined;
      }

      const extracted = await downloadAndExtractWheelCatalog({
        fetcher: createTimedFetcher(this.getBaseFetch(), DEFAULT_WHEEL_TIMEOUT_MS),
        requestedVersion,
        license: this.activeCatalog.getLicense(),
        componentsOverlayBaseDir: this.componentsOverlayBaseDir,
      });
      this.saveToCache(extracted.catalog);
      this.saveTranslationsToCache(extracted.translations);
      this.activeCatalog = extracted.catalog;
      this.activeTranslations = new HaCatalogTranslations(extracted.translations);
      this.lastCheckedAt = Date.now();
      return extracted.catalog;
    }

    const check = newVersion ? undefined : await this.checkUpstreamVersion();
    const targetVersion = newVersion ?? check?.latestVersion ?? this.getVersion();
    const manifestMap: Record<string, HaCatalogManifest> = {};
    for (const m of this.activeCatalog.getAllManifests()) {
      manifestMap[m.domain] = m;
    }
    for (const m of additionalManifests) {
      manifestMap[m.domain] = m;
    }

    const updatedIndex = buildCatalogIndex(
      manifestMap,
      targetVersion,
      this.activeCatalog.getLicense(),
    );
    const updatedCatalog = new HaIntegrationCatalog(updatedIndex);
    this.saveToCache(updatedCatalog);
    this.activeCatalog = updatedCatalog;
    return updatedCatalog;
  }

  /**
   * Ensures the Hub holds a complete, up-to-date catalog cache for the latest
   * upstream Home Assistant release, degrading gracefully when offline.
   */
  async ensureLatest(options: EnsureLatestCatalogOptions = {}): Promise<EnsureLatestCatalogResult> {
    if (!options.force && this.syncInFlight) {
      return this.syncInFlight;
    }

    const run = async (): Promise<EnsureLatestCatalogResult> => {
      const previousVersion = this.getVersion();
      const maxAgeMs = options.maxAgeMs ?? DEFAULT_SYNC_MAX_AGE_MS;
      const cacheComplete = this.isCacheComplete(previousVersion);
      const cacheAgeMs = this.getCacheAgeMs();
      const checkedRecently =
        this.lastCheckedAt !== undefined && Date.now() - this.lastCheckedAt < maxAgeMs;
      const isLegacyBaseline = compareHaVersions(previousVersion, '2025.1.0') < 0;

      if (
        !options.force &&
        cacheComplete &&
        !isLegacyBaseline &&
        (checkedRecently || (cacheAgeMs !== undefined && cacheAgeMs < maxAgeMs))
      ) {
        return {
          status: 'up_to_date',
          previousVersion,
          version: previousVersion,
          total: this.getTotalIntegrations(),
          source: 'cached',
        };
      }

      try {
        const check = await this.checkUpstreamVersion();
        const needsUpgrade =
          options.force ||
          check.releaseSource === 'cached' ||
          compareHaVersions(check.latestVersion, previousVersion) > 0 ||
          !this.isCacheComplete(check.latestVersion);

        if (
          check.releaseSource === 'cached' &&
          cacheComplete &&
          !options.force &&
          !isLegacyBaseline
        ) {
          return {
            status: 'offline',
            previousVersion,
            version: previousVersion,
            total: this.getTotalIntegrations(),
            source: 'cached',
          };
        }

        if (!needsUpgrade) {
          this.touchCacheTimestamp();
          return {
            status: 'up_to_date',
            previousVersion,
            version: previousVersion,
            total: this.getTotalIntegrations(),
            source: 'cached',
          };
        }

        if (
          !options.force &&
          check.releaseSource !== 'cached' &&
          this.hasMatchingSeed(check.latestVersion) &&
          this.seedPath &&
          this.seedTranslationsPath
        ) {
          const seedCat = this.tryLoadCatalog(this.seedPath);
          const seedTr = this.tryLoadTranslations(this.seedTranslationsPath);
          if (seedCat && seedTr) {
            this.saveToCache(seedCat);
            this.saveTranslationsToCache(seedTr.getIndex());
            this.activeCatalog = seedCat;
            this.activeTranslations = seedTr;
            this.lastCheckedAt = Date.now();
            return {
              status:
                compareHaVersions(seedCat.getVersion(), previousVersion) > 0
                  ? 'updated'
                  : 'up_to_date',
              previousVersion,
              version: seedCat.getVersion(),
              total: seedCat.getTotalCount(),
              source: 'cached',
            };
          }
        }

        const updated = await this.refreshCatalog(
          check.releaseSource === 'cached' ? undefined : check.latestVersion,
        );
        return {
          status: 'updated',
          previousVersion,
          version: updated.getVersion(),
          total: updated.getTotalCount(),
          source: 'wheel',
        };
      } catch (err: unknown) {
        return {
          status: 'offline',
          previousVersion,
          version: previousVersion,
          total: this.getTotalIntegrations(),
          source: 'cached',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    if (!options.force) {
      const tracked = run().finally(() => {
        if (this.syncInFlight === tracked) {
          this.syncInFlight = undefined;
        }
      });
      this.syncInFlight = tracked;
      return tracked;
    }
    return run();
  }
}
