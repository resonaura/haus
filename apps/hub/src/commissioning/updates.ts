/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { join, resolve } from 'node:path';
import {
  HacsUpdateManager,
  PluginInstaller,
  type HacsBatchUpdateResult,
  type HacsRuntimeHooks,
  type HacsUpdateOperation,
} from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { HubIntegrationEntryService } from './entries.js';
import { HaFlowBridgeService } from './ha-flow/bridge.service.js';
import { resolveHaDataDir } from './ha-flow/helpers.js';
import { CommissioningService } from './service.js';
import {
  collectInstalledAppUpdates,
  collectInstalledNpmPluginUpdates,
  syncUpstreamAddonCatalogVersion,
} from './updates/addon-upstream.js';
import { collectDeviceFirmwareUpdates } from './updates/device-firmware.js';
import { collectInstalledHacsUpdates, syncHacsCatalogEntries } from './updates/hacs-sync.js';

export type UpdateCategory =
  'core' | 'integration' | 'plugin' | 'addon' | 'homebridge' | 'scrypted' | 'hacs' | 'firmware';

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
  readonly skippedVersion?: string;
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

@Injectable()
export class HubUpdatesService implements OnModuleInit, OnModuleDestroy {
  private cache?: {
    expiresAt: number;
    catalogVersion: string;
    payload: UnifiedUpdatesResponse;
  };
  private inFlight?: Promise<UnifiedUpdatesResponse>;
  private readonly installing = new Set<string>();
  private fetchImpl: typeof fetch = fetch;
  private hacsManager?: HacsUpdateManager;
  private hacsInitialized = false;
  private customHacsHooks: Partial<HacsRuntimeHooks> = {};
  private readonly syncedHacsAppIds = new Set<string>();

  constructor(
    private readonly commissioning: CommissioningService,
    private readonly entries: HubIntegrationEntryService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(HaFlowBridgeService)
    private readonly haFlowBridge?: HaFlowBridgeService,
  ) {}

  onModuleInit(): void {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    this.hacs.defaultCatalog.startBackgroundSync(() => {
      void this.syncHacsIntoAppCatalog().catch(() => undefined);
    });
  }

  onModuleDestroy(): void {
    this.hacsManager?.defaultCatalog.stopBackgroundSync();
  }

  async syncHacsIntoAppCatalog(): Promise<number> {
    const appCatalog = this.homeService?.appManager?.catalog;
    if (!appCatalog) return 0;
    return syncHacsCatalogEntries({
      hacs: this.hacs,
      entries: this.entries,
      appCatalog,
      trackedAppIds: this.syncedHacsAppIds,
    });
  }

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
        await this.haFlowBridge?.reloadCustomComponents().catch(() => undefined);
        await this.customHacsHooks.onInstalled?.(domain, version);
      },
      onRemoved: async (domain) => {
        await this.haFlowBridge?.reloadCustomComponents().catch(() => undefined);
        await this.customHacsHooks.onRemoved?.(domain);
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
      this.hacsManager.setOnCatalogChanged(async () => {
        await this.syncHacsIntoAppCatalog().catch(() => undefined);
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

    if (!forceRefresh && this.inFlight) {
      return this.inFlight;
    }

    const job = this.computeUpdates(now, forceRefresh);
    if (!forceRefresh) {
      this.inFlight = job;
    }
    try {
      return await job;
    } finally {
      if (this.inFlight === job) this.inFlight = undefined;
    }
  }

  private async computeUpdates(
    now: number,
    forceRefresh: boolean,
  ): Promise<UnifiedUpdatesResponse> {
    const checkedAt = new Date(now).toISOString();

    const [catalogItems, appItems, npmItems, hacsItems] = await Promise.all([
      // 1. HA integration catalog version check
      (async (): Promise<UnifiedUpdateItem[]> => {
        try {
          const upstream = await this.commissioning.catalog.checkUpstreamVersion();
          return [
            {
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
            },
          ];
        } catch {
          return [];
        }
      })(),

      // 2. Installed Apps / Add-ons / Homebridge catalog apps
      (async (): Promise<UnifiedUpdateItem[]> => {
        if (!this.homeService) return [];
        try {
          return await collectInstalledAppUpdates({
            homeService: this.homeService,
            fetchImpl: this.fetchImpl,
            installing: this.installing,
            checkedAt,
          });
        } catch {
          return [];
        }
      })(),

      // 3. Kitsune npm plugin receipts (Homebridge / Scrypted packages) — parallelized
      collectInstalledNpmPluginUpdates({
        dataDir: this.getDataDirectory(),
        fetchJson: (url) => this.fetchJson(url),
        installing: this.installing,
        checkedAt,
      }),

      // 4. Configured HACS / Custom Integration repositories
      (async (): Promise<UnifiedUpdateItem[]> => {
        await this.ensureHacsInitialized();
        return collectInstalledHacsUpdates({
          hacs: this.hacs,
          entries: this.entries,
          installing: this.installing,
          forceRefresh,
          checkedAt,
        });
      })(),
    ]);

    const firmwareItems = collectDeviceFirmwareUpdates({
      homeService: this.homeService,
      installing: this.installing,
      checkedAt,
    });

    const seenIds = new Set<string>();
    const items: UnifiedUpdateItem[] = [];
    for (const group of [catalogItems, appItems, npmItems, hacsItems, firmwareItems]) {
      for (const item of group) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        items.push(item);
      }
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
      if (id.startsWith('device-update:') && this.homeService) {
        const endpointId = id.slice('device-update:'.length);
        await this.homeService.executeDeviceCommand(
          endpointId,
          'update',
          'install',
          options.version ? { version: options.version } : undefined,
        );
        return { status: 'updated', id, ...(options.version ? { version: options.version } : {}) };
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
