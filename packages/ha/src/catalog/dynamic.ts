/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { HaIntegrationCatalog } from './loader.js';
import type { HaCatalogIndex, HaCatalogManifest } from './types.js';

export interface DynamicCatalogOptions {
  readonly baselinePath?: string;
  readonly cachePath?: string;
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

export class DynamicCatalogService {
  private activeCatalog: HaIntegrationCatalog;
  private readonly baselinePath: string;
  private readonly cachePath: string;
  private readonly pypiUrl: string;
  private readonly githubReleasesUrl: string;
  private readonly customFetch?: typeof fetch;
  private lastETag?: string;

  constructor(options: DynamicCatalogOptions = {}) {
    const pkgBaseline = fileURLToPath(new URL('../../data/ha-catalog-2024.12.5.json.gz', import.meta.url));
    this.baselinePath =
      options.baselinePath ??
      (existsSync(pkgBaseline)
        ? pkgBaseline
        : existsSync(resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz'))
          ? resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz')
          : resolve('data/ha-catalog-2024.12.5.json.gz'));

    this.cachePath = options.cachePath ?? resolve('.local/cache/ha-catalog-latest.json.gz');
    this.pypiUrl = options.pypiUrl ?? 'https://pypi.org/pypi/homeassistant/json';
    this.githubReleasesUrl =
      options.githubReleasesUrl ??
      'https://api.github.com/repos/home-assistant/core/releases/latest';
    this.customFetch = options.fetchFn;

    // Tier 2: Check persistent local cache first
    const cached = this.tryLoadFromCache();
    if (cached) {
      this.activeCatalog = cached;
    } else {
      // Tier 1: Fallback to baseline
      this.activeCatalog = HaIntegrationCatalog.fromFile(this.baselinePath, true);
    }
  }

  getCatalog(): HaIntegrationCatalog {
    return this.activeCatalog;
  }

  getVersion(): string {
    return this.activeCatalog.getVersion();
  }

  getTotalIntegrations(): number {
    return this.activeCatalog.getTotalCount();
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

  async checkUpstreamVersion(): Promise<UpstreamVersionCheck> {
    const fetcher = this.getFetcher();
    const currentVersion = this.activeCatalog.getVersion();

    // 1. Try PyPI
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

    // 2. Try GitHub Releases API
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

    const rawJson = JSON.stringify(index);
    const compressed = gzipSync(Buffer.from(rawJson, 'utf-8'));

    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, compressed);
  }

  async refreshCatalog(
    newVersion?: string,
    additionalManifests?: readonly HaCatalogManifest[],
  ): Promise<HaIntegrationCatalog> {
    const check = await this.checkUpstreamVersion();
    const targetVersion = newVersion ?? check.latestVersion;

    // Combine existing manifests with any updated manifests
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

    // Build updated index
    const sortedKeys = Object.keys(manifestMap).sort();
    const sortedObj: Record<string, HaCatalogManifest> = {};
    for (const k of sortedKeys) {
      const entry = manifestMap[k];
      if (entry) sortedObj[k] = entry;
    }

    const rawSorted = JSON.stringify(sortedObj);
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(rawSorted).digest('hex');

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
