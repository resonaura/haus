/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppManifest } from './manifest.js';
import { registerBridgeCatalogEntries } from './bridge-catalog.js';

export type AppCatalogCategory =
  'security' | 'media' | 'automation' | 'utility' | 'network' | 'bridge' | 'integration';

export type AppRuntimeType = 'docker' | 'hacs' | 'homebridge' | 'scrypted';

export type AppStabilityTier = 'gold' | 'silver' | 'bronze' | 'low';

export interface AppCatalogVersion {
  readonly version: string;
  readonly manifest: AppManifest;
  readonly releaseNotes?: string;
  readonly publishedAt?: string;
}

export interface AppCatalogEntry {
  readonly manifest: AppManifest;
  readonly category: AppCatalogCategory;
  readonly runtimeType?: AppRuntimeType;
  readonly packageName?: string;
  readonly verified?: boolean;
  readonly trustScore?: number;
  readonly stabilityTier?: AppStabilityTier;
  readonly vendorId?: string;
  readonly vendorName?: string;
  readonly channel?: 'stable' | 'beta';
  readonly featured?: boolean;
  readonly documentationUrl?: string;
  readonly repositoryUrl?: string;
  readonly addonConfigPath?: string;
  readonly repositoryId?: string;
  readonly repositoryName?: string;
  readonly customRepository?: boolean;
  readonly hacsRepositoryId?: string;
  readonly domain?: string;
  readonly stars?: number;
  readonly downloads?: number;
  readonly author?: string;
  readonly versions?: readonly AppCatalogVersion[];
}

export interface MarketplaceAppEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly category: AppCatalogCategory;
  readonly runtimeType: AppRuntimeType;
  readonly packageName?: string;
  readonly verified?: boolean;
  readonly trustScore?: number;
  readonly stabilityTier?: AppStabilityTier;
  readonly vendorId?: string;
  readonly vendorName?: string;
  readonly channel: 'stable' | 'beta';
  readonly featured: boolean;
  readonly documentationUrl?: string;
  readonly repositoryUrl?: string;
  readonly addonConfigPath?: string;
  readonly repositoryId?: string;
  readonly repositoryName?: string;
  readonly customRepository?: boolean;
  readonly hacsRepositoryId?: string;
  readonly domain?: string;
  readonly stars?: number;
  readonly downloads?: number;
  readonly author?: string;
  readonly installed: boolean;
  readonly state?: 'running' | 'stopped' | 'attention';
  readonly currentVersion?: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly releaseNotes?: string;
}

export interface AppUpdateCheckResult {
  readonly updateAvailable: boolean;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly targetManifest?: AppManifest;
  readonly releaseNotes?: string;
}

export interface AppCatalogFilter {
  readonly category?: AppCatalogCategory;
  readonly runtimeType?: AppRuntimeType;
  readonly search?: string;
  readonly channel?: 'stable' | 'beta';
  readonly installed?: boolean;
}

export interface AppCatalogDynamicProvider {
  sync(options?: {
    search?: string;
    runtimeType?: AppRuntimeType;
    refresh?: boolean;
  }): Promise<void>;
  resolve(appId: string): Promise<AppCatalogEntry | undefined>;
}

function compareVersions(v1: string, v2: string): number {
  const parse = (raw: string) =>
    raw
      .replace(/^v/i, '')
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const a = p1[i] ?? 0;
    const b = p2[i] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

export class AppCatalog {
  private readonly entries = new Map<string, AppCatalogEntry>();
  private dynamicProvider?: AppCatalogDynamicProvider;

  setDynamicProvider(provider: AppCatalogDynamicProvider): void {
    this.dynamicProvider = provider;
  }

  async syncDynamic(options?: {
    search?: string;
    runtimeType?: AppRuntimeType;
    refresh?: boolean;
  }): Promise<void> {
    await this.dynamicProvider?.sync(options);
  }

  async resolveEntry(appId: string): Promise<AppCatalogEntry | undefined> {
    return this.entries.get(appId) ?? (await this.dynamicProvider?.resolve(appId));
  }

  register(entry: AppCatalogEntry): void {
    if (!entry?.manifest?.id) throw new Error('invalid_catalog_entry');
    this.entries.set(entry.manifest.id, entry);
  }

  unregister(appId: string): boolean {
    return this.entries.delete(appId);
  }

  unregisterByRepositoryId(repositoryId: string): number {
    let removed = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.repositoryId === repositoryId) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  registerUpstreamVersion(appId: string, version: AppCatalogVersion): boolean {
    const existing = this.entries.get(appId);
    if (!existing) return false;
    const retained = (existing.versions ?? []).filter((item) => item.version !== version.version);
    this.entries.set(appId, { ...existing, versions: [...retained, version] });
    return true;
  }

  get(appId: string): AppCatalogEntry | undefined {
    return this.entries.get(appId);
  }

  list(filter?: AppCatalogFilter): readonly AppCatalogEntry[] {
    const all = Array.from(this.entries.values());
    return all.filter((entry) => {
      if (filter?.category && entry.category !== filter.category) return false;
      if (filter?.runtimeType && (entry.runtimeType ?? 'docker') !== filter.runtimeType)
        return false;
      if (filter?.channel && entry.channel && entry.channel !== filter.channel) return false;
      if (filter?.search) {
        const query = filter.search.toLowerCase();
        const matchesName = entry.manifest.name.toLowerCase().includes(query);
        const matchesId = entry.manifest.id.toLowerCase().includes(query);
        const matchesPkg = (entry.packageName ?? '').toLowerCase().includes(query);
        const matchesVendor = (entry.vendorName ?? '').toLowerCase().includes(query);
        const matchesDesc = (entry.manifest.description ?? '').toLowerCase().includes(query);
        const matchesAuthor = (entry.author ?? '').toLowerCase().includes(query);
        const matchesDomain = (entry.domain ?? '').toLowerCase().includes(query);
        const matchesRepo = (entry.repositoryName ?? '').toLowerCase().includes(query);
        if (
          !matchesName &&
          !matchesId &&
          !matchesPkg &&
          !matchesVendor &&
          !matchesDesc &&
          !matchesAuthor &&
          !matchesDomain &&
          !matchesRepo
        )
          return false;
      }
      return true;
    });
  }

  checkUpdate(appId: string, currentVersion: string): AppUpdateCheckResult {
    const entry = this.entries.get(appId);
    if (!entry) {
      return { updateAvailable: false, currentVersion };
    }

    let latestVersion = entry.manifest.version;
    let targetManifest: AppManifest = entry.manifest;
    let releaseNotes: string | undefined;

    if (entry.versions && entry.versions.length > 0) {
      for (const v of entry.versions) {
        if (compareVersions(v.version, latestVersion) > 0) {
          latestVersion = v.version;
          targetManifest = v.manifest;
          releaseNotes = v.releaseNotes;
        }
      }
    }

    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    return {
      updateAvailable,
      currentVersion,
      latestVersion: updateAvailable ? latestVersion : undefined,
      targetManifest: updateAvailable ? targetManifest : undefined,
      releaseNotes: updateAvailable ? releaseNotes : undefined,
    };
  }

  toMarketplaceEntries(
    installed: ReadonlyMap<string, { manifest: AppManifest; state: 'running' | 'stopped' }>,
    filter?: AppCatalogFilter,
  ): readonly MarketplaceAppEntry[] {
    const results: MarketplaceAppEntry[] = [];
    const processedIds = new Set<string>();

    for (const entry of this.list(filter)) {
      processedIds.add(entry.manifest.id);
      const installedInfo = installed.get(entry.manifest.id);
      const isInstalled = Boolean(installedInfo);

      if (filter?.installed !== undefined && filter.installed !== isInstalled) {
        continue;
      }

      const updateCheck = isInstalled
        ? this.checkUpdate(entry.manifest.id, installedInfo!.manifest.version)
        : { updateAvailable: false, currentVersion: entry.manifest.version };

      let latestVersion = entry.manifest.version;
      let latestNotes: string | undefined;
      for (const v of entry.versions ?? []) {
        if (compareVersions(v.version, latestVersion) > 0) {
          latestVersion = v.version;
          latestNotes = v.releaseNotes;
        }
      }

      results.push({
        id: entry.manifest.id,
        name: entry.manifest.name,
        description: entry.manifest.description,
        category: entry.category,
        runtimeType: entry.runtimeType ?? 'docker',
        ...(entry.packageName ? { packageName: entry.packageName } : {}),
        ...(entry.verified ? { verified: true } : {}),
        ...(entry.trustScore !== undefined ? { trustScore: entry.trustScore } : {}),
        ...(entry.stabilityTier ? { stabilityTier: entry.stabilityTier } : {}),
        ...(entry.vendorId ? { vendorId: entry.vendorId } : {}),
        ...(entry.vendorName ? { vendorName: entry.vendorName } : {}),
        channel: entry.channel ?? 'stable',
        featured: Boolean(entry.featured),
        documentationUrl: entry.documentationUrl,
        repositoryUrl: entry.repositoryUrl,
        ...(entry.addonConfigPath ? { addonConfigPath: entry.addonConfigPath } : {}),
        ...(entry.repositoryId ? { repositoryId: entry.repositoryId } : {}),
        ...(entry.repositoryName ? { repositoryName: entry.repositoryName } : {}),
        ...(entry.customRepository ? { customRepository: true } : {}),
        ...(entry.hacsRepositoryId ? { hacsRepositoryId: entry.hacsRepositoryId } : {}),
        ...(entry.domain ? { domain: entry.domain } : {}),
        ...(entry.stars !== undefined ? { stars: entry.stars } : {}),
        ...(entry.downloads !== undefined ? { downloads: entry.downloads } : {}),
        author: entry.author,
        installed: isInstalled,
        state: installedInfo?.state,
        currentVersion: installedInfo?.manifest.version,
        latestVersion,
        updateAvailable: updateCheck.updateAvailable,
        releaseNotes: updateCheck.releaseNotes ?? latestNotes,
      });
    }

    if (filter?.installed !== false) {
      for (const [id, installedInfo] of installed) {
        if (processedIds.has(id)) continue;
        if (filter?.search) {
          const query = filter.search.toLowerCase();
          const matchesName = installedInfo.manifest.name.toLowerCase().includes(query);
          const matchesId = id.toLowerCase().includes(query);
          if (!matchesName && !matchesId) continue;
        }
        results.push({
          id,
          name: installedInfo.manifest.name,
          description: installedInfo.manifest.description,
          category: 'utility',
          runtimeType: 'docker',
          channel: 'stable',
          featured: false,
          installed: true,
          state: installedInfo.state,
          currentVersion: installedInfo.manifest.version,
          latestVersion: installedInfo.manifest.version,
          updateAvailable: false,
        });
      }
    }

    return results;
  }

  static createDefaultCatalog(): AppCatalog {
    const catalog = new AppCatalog();
    registerBridgeCatalogEntries(catalog);
    return catalog;
  }
}
