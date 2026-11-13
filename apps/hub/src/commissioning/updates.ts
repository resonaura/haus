/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PluginInstaller } from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { HubIntegrationEntryService } from './entries.js';
import { CommissioningService } from './service.js';

export type UpdateCategory =
  'core' | 'integration' | 'plugin' | 'addon' | 'homebridge' | 'scrypted' | 'hacs';

export interface UnifiedUpdateItem {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly category: UpdateCategory;
  readonly installedVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly canInstall: boolean;
  readonly inProgress?: boolean;
  readonly releaseUrl?: string;
  readonly releaseSummary?: string;
  readonly checkedAt: string;
}

export interface UnifiedUpdatesResponse {
  readonly checkedAt: string;
  readonly total: number;
  readonly availableCount: number;
  readonly items: readonly UnifiedUpdateItem[];
}

const KNOWN_HACS_REPOS: Readonly<
  Record<string, { readonly repo: string; readonly title: string }>
> = {
  xiaomi_miot: { repo: 'al-one/hass-xiaomi-miot', title: 'Xiaomi Miot Auto' },
  meross_lan: { repo: 'krahabb/meross_lan', title: 'Meross LAN' },
  sensibo: { repo: 'GuyKh/sensibo-custom-component', title: 'Sensibo' },
};

const UPDATE_CACHE_TTL_MS = 10 * 60_000;
const NETWORK_TIMEOUT_MS = 2_500;

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '');
}

function compareSemverLoose(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return normalizeVersion(a) === normalizeVersion(b) ? 0 : -1;
}

interface InstalledReceipt {
  readonly name: string;
  readonly version: string;
}

@Injectable()
export class HubUpdatesService {
  private cache?: { expiresAt: number; payload: UnifiedUpdatesResponse };
  private readonly installing = new Set<string>();
  private fetchImpl: typeof fetch = fetch;

  constructor(
    private readonly commissioning: CommissioningService,
    private readonly entries: HubIntegrationEntryService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {}

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
  }

  private getDataDirectory(): string {
    return resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  }

  private async fetchJson(url: string): Promise<Record<string, unknown> | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Haus-Hub' },
        signal: controller.signal,
      });
      if (!res.ok) return undefined;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readInstalledNpmReceipts(): Promise<InstalledReceipt[]> {
    const root = join(this.getDataDirectory(), 'kitsune', 'plugins');
    const out: InstalledReceipt[] = [];
    try {
      const dirs = await readdir(root);
      for (const dir of dirs.slice(0, 256)) {
        try {
          const raw = await readFile(join(root, dir, 'kitsune-receipt.json'), 'utf8');
          const parsed = JSON.parse(raw) as Partial<InstalledReceipt>;
          if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
            out.push({ name: parsed.name, version: parsed.version });
          }
        } catch {
          // ignore non-receipt entry
        }
      }
    } catch {
      // plugins directory might not exist yet
    }
    return out;
  }

  async listUpdates(forceRefresh = false): Promise<UnifiedUpdatesResponse> {
    const now = Date.now();
    if (!forceRefresh && this.cache && now < this.cache.expiresAt) {
      return this.cache.payload;
    }

    const checkedAt = new Date(now).toISOString();
    const items: UnifiedUpdateItem[] = [];

    // 1. HA integration catalog version check
    try {
      const upstream = await this.commissioning.catalog.checkUpstreamVersion();
      items.push({
        id: 'catalog:ha-integrations',
        domain: 'homeassistant',
        title: 'Integration Compatibility Catalog',
        category: 'core',
        installedVersion: upstream.currentVersion,
        latestVersion: upstream.latestVersion ?? upstream.currentVersion,
        updateAvailable: upstream.updateAvailable,
        canInstall: true,
        inProgress: this.installing.has('catalog:ha-integrations'),
        releaseUrl: 'https://github.com/home-assistant/core/releases',
        releaseSummary: upstream.updateAvailable
          ? `Catalog ${upstream.latestVersion} available (${upstream.releaseSource})`
          : 'Up to date',
        checkedAt,
      });
    } catch {
      // ignore catalog check errors when offline
    }

    // 2. Installed Apps / Add-ons / Homebridge catalog apps
    if (this.homeService) {
      try {
        const inventory = await this.homeService.listApps('hub');
        for (const app of inventory.apps) {
          const appId = app.source.externalId;
          const check = this.homeService.checkAppUpdate(appId);
          const catalogEntry = this.homeService.getAppCatalogEntry(appId);
          const category: UpdateCategory =
            catalogEntry?.runtimeType === 'homebridge'
              ? 'homebridge'
              : catalogEntry?.runtimeType === 'hacs'
                ? 'hacs'
                : catalogEntry?.runtimeType === 'scrypted'
                  ? 'scrypted'
                  : 'addon';
          const id = `app:${appId}`;
          items.push({
            id,
            domain: appId,
            title: app.name,
            category,
            installedVersion: check.currentVersion,
            latestVersion: check.latestVersion ?? check.currentVersion,
            updateAvailable: check.updateAvailable,
            canInstall: check.updateAvailable,
            inProgress: this.installing.has(id),
            releaseUrl: catalogEntry?.documentationUrl ?? catalogEntry?.repositoryUrl,
            releaseSummary: check.releaseNotes,
            checkedAt,
          });
        }
      } catch {
        // ignore if HomeService apps unavailable
      }
    }

    // 3. Kitsune npm plugin receipts (Homebridge / Scrypted packages)
    const receipts = await this.readInstalledNpmReceipts();
    for (const receipt of receipts) {
      const encoded = encodeURIComponent(receipt.name).replace('%40', '@');
      const npmMeta = await this.fetchJson(`https://registry.npmjs.org/${encoded}/latest`);
      const latestVersion =
        typeof npmMeta?.version === 'string' ? npmMeta.version : receipt.version;
      const updateAvailable = compareSemverLoose(receipt.version, latestVersion) < 0;
      const category: UpdateCategory = receipt.name.startsWith('@scrypted/')
        ? 'scrypted'
        : receipt.name.includes('homebridge')
          ? 'homebridge'
          : 'plugin';
      const id = `npm:${receipt.name}`;
      items.push({
        id,
        domain: receipt.name,
        title: receipt.name,
        category,
        installedVersion: receipt.version,
        latestVersion,
        updateAvailable,
        canInstall: updateAvailable,
        inProgress: this.installing.has(id),
        releaseUrl: `https://www.npmjs.com/package/${receipt.name}`,
        checkedAt,
      });
    }

    // 4. Configured HACS / Custom Integration repositories
    const entries = await this.entries.listEntries();
    const configuredCustomDomains = new Set(entries.map((e) => e.domain));
    for (const domain of configuredCustomDomains) {
      const repoInfo = KNOWN_HACS_REPOS[domain];
      if (!repoInfo) continue;
      const entry = entries.find((e) => e.domain === domain);
      const installedVersion = entry?.version ?? '0.0.0';
      const release = await this.fetchJson(
        `https://api.github.com/repos/${repoInfo.repo}/releases/latest`,
      );
      const tag = typeof release?.tag_name === 'string' ? release.tag_name : undefined;
      const latestVersion = tag ? normalizeVersion(tag) : installedVersion;
      const updateAvailable =
        Boolean(tag) && compareSemverLoose(installedVersion, latestVersion) < 0;
      const id = `hacs:${domain}`;
      items.push({
        id,
        domain,
        title: repoInfo.title,
        category: 'hacs',
        installedVersion,
        latestVersion,
        updateAvailable,
        canInstall: false,
        inProgress: this.installing.has(id),
        releaseUrl:
          typeof release?.html_url === 'string'
            ? release.html_url
            : `https://github.com/${repoInfo.repo}`,
        releaseSummary: typeof release?.name === 'string' ? release.name : undefined,
        checkedAt,
      });
    }

    const sorted = [...items].sort((a, b) => Number(b.updateAvailable) - Number(a.updateAvailable));
    const payload: UnifiedUpdatesResponse = {
      checkedAt,
      total: sorted.length,
      availableCount: sorted.filter((i) => i.updateAvailable).length,
      items: sorted,
    };
    this.cache = { expiresAt: now + UPDATE_CACHE_TTL_MS, payload };
    return payload;
  }

  async installUpdate(
    id: string,
    actorId = 'hub',
  ): Promise<{
    readonly status: string;
    readonly id: string;
    readonly version?: string;
    readonly error?: string;
  }> {
    this.installing.add(id);
    this.cache = undefined;
    try {
      if (id === 'catalog:ha-integrations') {
        const updated = await this.commissioning.catalog.refreshCatalog();
        return { status: 'updated', id, version: updated.getVersion() };
      }
      if (id.startsWith('app:') && this.homeService) {
        const appId = id.slice('app:'.length);
        const result = await this.homeService.updateApp(actorId, appId);
        return {
          status: result.status,
          id,
          error: result.status === 'error' ? result.reason : undefined,
        };
      }
      if (id.startsWith('npm:')) {
        const pkg = id.slice('npm:'.length);
        const installer = new PluginInstaller(this.getDataDirectory(), this.fetchImpl);
        const installed = await installer.install(pkg, 'latest');
        return { status: 'updated', id, version: installed.version };
      }
      return { status: 'unsupported', id, error: 'update_install_not_supported' };
    } finally {
      this.installing.delete(id);
    }
  }
}
