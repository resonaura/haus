/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  compareHacsVersions,
  HacsUpdateManager,
  PluginInstaller,
  type HacsBatchUpdateResult,
  type HacsRuntimeHooks,
  type HacsUpdateOperation,
} from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { HubIntegrationEntryService } from './entries.js';
import { resolveHaDataDir } from './ha-flow/helpers.js';
import { CommissioningService } from './service.js';
import {
  collectInstalledAppUpdates,
  syncUpstreamAddonCatalogVersion,
} from './updates/addon-upstream.js';

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
  readonly hacsRepositoryId?: string;
  readonly compatibility?: 'verified' | 'unknown' | 'incompatible';
  readonly compatibilityReason?: string;
  readonly pendingRestart?: boolean;
}

export interface UnifiedUpdatesResponse {
  readonly checkedAt: string;
  readonly total: number;
  readonly availableCount: number;
  readonly items: readonly UnifiedUpdateItem[];
}

const UPDATE_CACHE_TTL_MS = 10 * 60_000;
const NETWORK_TIMEOUT_MS = 2_500;
const compareSemverLoose = compareHacsVersions;

interface InstalledReceipt {
  readonly name: string;
  readonly version: string;
}

@Injectable()
export class HubUpdatesService {
  private cache?: {
    expiresAt: number;
    catalogVersion: string;
    payload: UnifiedUpdatesResponse;
  };
  private readonly installing = new Set<string>();
  private fetchImpl: typeof fetch = fetch;
  private hacsManager?: HacsUpdateManager;
  private hacsInitialized = false;
  private customHacsHooks: Partial<HacsRuntimeHooks> = {};

  constructor(
    private readonly commissioning: CommissioningService,
    private readonly entries: HubIntegrationEntryService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {}

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
    this.hacsManager?.setFetchForTesting(fetchFn);
  }

  setHacsHooksForTesting(hooks: Partial<HacsRuntimeHooks>): void {
    this.customHacsHooks = { ...this.customHacsHooks, ...hooks };
    this.hacsManager?.setHooks(this.buildHacsHooks());
  }

  private getDataDirectory(): string {
    return resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  }

  private buildHacsHooks(): HacsRuntimeHooks {
    return {
      getRuntimeHaVersion: () =>
        this.customHacsHooks.getRuntimeHaVersion?.() ?? this.commissioning.catalog.getVersion(),
      getAffectedEntries: async (domain) => {
        if (this.customHacsHooks.getAffectedEntries) {
          return this.customHacsHooks.getAffectedEntries(domain);
        }
        const all = await this.entries.listEntries();
        return all.filter((e) => e.domain === domain).map((e) => e.entry_id);
      },
      captureEntryCheckpoint: async (domain) => {
        if (this.customHacsHooks.captureEntryCheckpoint) {
          return this.customHacsHooks.captureEntryCheckpoint(domain);
        }
        const all = await this.entries.listEntries();
        return all
          .filter((e) => e.domain === domain)
          .map((e) => ({ entryId: e.entry_id, domain: e.domain, version: e.version ?? '0.0.0' }));
      },
      restoreEntryCheckpoint: async (domain, checkpoints) => {
        if (this.customHacsHooks.restoreEntryCheckpoint) {
          await this.customHacsHooks.restoreEntryCheckpoint(domain, checkpoints);
          return;
        }
        const prevVersion = checkpoints[0]?.version;
        if (prevVersion) {
          await this.entries.setDomainVersion(domain, prevVersion);
        }
      },
      beforeActivate: this.customHacsHooks.beforeActivate,
      prepareRequirements: this.customHacsHooks.prepareRequirements,
      verifyActivation: async (domain, version, affectedEntries) => {
        if (this.customHacsHooks.verifyActivation) {
          return this.customHacsHooks.verifyActivation(domain, version, affectedEntries);
        }
        let reauthRequired = false;
        for (const entryId of affectedEntries) {
          const reloaded = await this.entries.reloadEntry(entryId);
          const state = reloaded.entry?.state;
          if (state === 'setup_error' || state === 'failed_unload') {
            return {
              ok: false,
              reason: reloaded.entry?.reason ?? `entry_reload_failed:${entryId}`,
            };
          }
          if (reloaded.entry?.reason?.toLowerCase().includes('reauth')) {
            reauthRequired = true;
          }
        }
        return { ok: true, ...(reauthRequired ? { reauthRequired: true } : {}) };
      },
      fenceCandidate: this.customHacsHooks.fenceCandidate,
      verifyRestoredRuntime: async (domain, version, affectedEntries) => {
        if (this.customHacsHooks.verifyRestoredRuntime) {
          await this.customHacsHooks.verifyRestoredRuntime(domain, version, affectedEntries);
          return;
        }
        for (const entryId of affectedEntries) {
          await this.entries.reloadEntry(entryId).catch(() => undefined);
        }
      },
      onInstalled: async (domain, version) => {
        await this.entries.setDomainVersion(domain, version);
        await this.customHacsHooks.onInstalled?.(domain, version);
      },
      onProgress: this.customHacsHooks.onProgress,
    };
  }

  private get hacs(): HacsUpdateManager {
    if (!this.hacsManager) {
      const haDir = resolveHaDataDir();
      this.hacsManager = new HacsUpdateManager({
        storageDir: join(haDir, 'hacs'),
        customComponentsDir: join(haDir, 'config', 'custom_components'),
        fetchFn: this.fetchImpl,
        networkTimeoutMs: NETWORK_TIMEOUT_MS,
        hooks: this.buildHacsHooks(),
      });
    }
    return this.hacsManager;
  }

  private async ensureHacsInitialized(): Promise<void> {
    if (this.hacsInitialized) return;
    this.hacsInitialized = true;
    await this.hacs.recoverInterruptedOperations();
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
    const activeCatalogVersion = this.commissioning.catalog.getVersion();
    if (
      !forceRefresh &&
      this.cache &&
      now < this.cache.expiresAt &&
      this.cache.catalogVersion === activeCatalogVersion
    ) {
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
        const appItems = await collectInstalledAppUpdates({
          homeService: this.homeService,
          fetchImpl: this.fetchImpl,
          installing: this.installing,
          checkedAt,
        });
        items.push(...appItems);
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
    await this.ensureHacsInitialized();
    const entries = await this.entries.listEntries();
    const configuredRefs = entries.map((e) => ({ domain: e.domain, version: e.version }));
    const hacsRepos = await this.hacs.listRepositories(configuredRefs, true);
    for (const repo of hacsRepos) {
      if (!repo.installed) continue;
      const domain = repo.domain ?? repo.id;
      const id = `hacs:${domain}`;
      if (items.some((i) => i.id === id)) continue;
      const installedVersion = repo.installed_version ?? '0.0.0';
      const latestVersion = repo.available_version ?? installedVersion;
      const updateAvailable = repo.pending_upgrade;
      const canInstall = updateAvailable && repo.can_download && repo.category === 'integration';
      items.push({
        id,
        domain,
        title: repo.name,
        category: 'hacs',
        installedVersion,
        latestVersion,
        updateAvailable,
        canInstall,
        inProgress: this.installing.has(id),
        releaseUrl: repo.release_url,
        releaseSummary: repo.release_summary,
        checkedAt,
        hacsRepositoryId: repo.id,
        compatibility: repo.compatibility,
        compatibilityReason: repo.compatibility_reason,
        pendingRestart: repo.pending_restart,
      });
    }

    const sorted = [...items].sort((a, b) => Number(b.updateAvailable) - Number(a.updateAvailable));
    const payload: UnifiedUpdatesResponse = {
      checkedAt,
      total: sorted.length,
      availableCount: sorted.filter((i) => i.updateAvailable).length,
      items: sorted,
    };
    this.cache = {
      expiresAt: now + UPDATE_CACHE_TTL_MS,
      catalogVersion: this.commissioning.catalog.getVersion(),
      payload,
    };
    return payload;
  }

  async installUpdate(
    id: string,
    actorId = 'hub',
    options: {
      readonly version?: string;
      readonly expectedDigest?: string;
      readonly activate?: boolean;
    } = {},
  ): Promise<{
    readonly status: string;
    readonly id: string;
    readonly version?: string;
    readonly error?: string;
    readonly operation?: HacsUpdateOperation;
  }> {
    this.installing.add(id);
    this.cache = undefined;
    try {
      if (id === 'catalog:ha-integrations') {
        const updated = await this.commissioning.refreshCatalog();
        return { status: 'updated', id, version: updated.getVersion() };
      }
      if (id.startsWith('app:') && this.homeService) {
        const appId = id.slice('app:'.length);
        await syncUpstreamAddonCatalogVersion(
          this.homeService.getAppCatalogEntry(appId),
          this.homeService.appManager?.catalog,
          this.fetchImpl,
        );
        const result = await this.homeService.updateApp(actorId, appId);
        const updatedVersion =
          result.status === 'ok' &&
          result.data &&
          typeof result.data === 'object' &&
          'version' in result.data &&
          typeof (result.data as { version?: unknown }).version === 'string'
            ? (result.data as { version: string }).version
            : undefined;
        return {
          status: result.status,
          id,
          ...(updatedVersion ? { version: updatedVersion } : {}),
          error: result.status === 'error' ? result.reason : undefined,
        };
      }
      if (id.startsWith('npm:')) {
        const pkg = id.slice('npm:'.length);
        const installer = new PluginInstaller(this.getDataDirectory(), this.fetchImpl);
        const installed = await installer.install(pkg, 'latest');
        return { status: 'updated', id, version: installed.version };
      }
      if (id.startsWith('hacs:')) {
        await this.ensureHacsInitialized();
        const entries = await this.entries.listEntries();
        const configuredEntries = entries.map((e) => ({ domain: e.domain, version: e.version }));
        try {
          const op = await this.hacs.installUpdate(id, {
            version: options.version,
            expectedDigest: options.expectedDigest,
            activate: options.activate,
            configuredEntries,
          });
          this.cache = undefined;
          return {
            status: op.phase === 'downloaded_not_activated' ? 'pending_restart' : 'updated',
            id: op.targetId,
            version: op.targetVersion,
            operation: op,
          };
        } catch (err: unknown) {
          this.cache = undefined;
          const message = err instanceof Error ? err.message : String(err);
          const clean = id.slice('hacs:'.length);
          const latestOp = [...this.hacs.listOperations()]
            .reverse()
            .find((o) => o.targetId === id || o.repositoryId === clean || o.domain === clean);
          return {
            status: 'error',
            id,
            error: message,
            ...(latestOp ? { operation: latestOp } : {}),
          };
        }
      }
      return { status: 'unsupported', id, error: 'update_install_not_supported' };
    } finally {
      this.installing.delete(id);
    }
  }

  async installBatch(ids: readonly string[]): Promise<HacsBatchUpdateResult> {
    await this.ensureHacsInitialized();
    const entries = await this.entries.listEntries();
    const configuredEntries = entries.map((e) => ({ domain: e.domain, version: e.version }));
    const res = await this.hacs.installBatch(ids, { configuredEntries });
    this.cache = undefined;
    return res;
  }

  async listOperations(): Promise<readonly HacsUpdateOperation[]> {
    await this.ensureHacsInitialized();
    return this.hacs.listOperations();
  }

  async getOperation(operationId: string): Promise<HacsUpdateOperation | undefined> {
    await this.ensureHacsInitialized();
    return this.hacs.getOperation(operationId);
  }

  async handleHacsCommand(command: Record<string, unknown>): Promise<unknown> {
    await this.ensureHacsInitialized();
    const entries = await this.entries.listEntries();
    const configuredEntries = entries.map((e) => ({ domain: e.domain, version: e.version }));
    const result = await this.hacs.handleHacsCommand(command, configuredEntries);
    this.cache = undefined;
    return result;
  }
}
