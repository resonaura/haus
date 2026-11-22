/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { AppCatalog } from '@haus/apps';
import {
  BrandIconCache,
  resolveBrandIcon,
  resolveBrandIconWithMeta,
  type BrandIconHint,
  type BrandIconKind,
} from '@haus/ha/native/brand-icons';
import { validateBrandIconInput } from '@haus/ha/native/brand-fallbacks';
import { resolveIconTintColor, type IconAppearance, type ResolvedIconVariation } from '@haus/icons';
import {
  IconRenderService,
  type IconRenderServiceStatus,
  type IconSourceJob,
  type RenderedTileResult,
} from '@haus/icons/node';
import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { readInstalledCustomManifests } from '../commissioning/ha-flow/runtime-operations.js';
import { CommissioningService } from '../commissioning/service.js';

export interface ResolveHubBrandIconInput {
  readonly kind: BrandIconKind | string;
  readonly id: string;
  readonly dark?: boolean;
  readonly hint?: BrandIconHint;
}

export interface ResolveHubRenderedBrandIconInput extends ResolveHubBrandIconInput {
  readonly appearance: IconAppearance;
  readonly variation: ResolvedIconVariation;
  readonly tintHex?: string;
  readonly displaySize?: number;
}

function resolveDataDir(): string {
  return resolve(process.env.HAUS_DATA_DIR || process.env.HAUS_DATA || 'data');
}

@Injectable()
export class BrandsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly cache = new BrandIconCache(1600);
  private readonly appCatalog = AppCatalog.createDefaultCatalog();
  private renderService: IconRenderService | null = null;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;
  private fetchImpl?: typeof fetch;
  private localDirsOverride?: readonly string[];
  private cacheRootOverride?: string;

  constructor(
    @Optional()
    @Inject(CommissioningService)
    private readonly commissioning?: Pick<CommissioningService, 'catalog'>,
  ) {}

  onApplicationBootstrap(): void {
    const isTest = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
    if (isTest) return;
    // Wait until after Nest bootstrap + HTTP listen so startup & health checks never contend with warmup.
    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = null;
      void this.startBackgroundWarmup().catch(() => undefined);
    }, 15_000);
    this.warmupTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    if (this.renderService) {
      await this.renderService.dispose();
      this.renderService = null;
    }
  }

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
  }

  setLocalDirsForTesting(dirs: readonly string[]): void {
    this.localDirsOverride = dirs;
  }

  setCacheRootForTesting(cacheRoot: string): void {
    this.cacheRootOverride = cacheRoot;
    if (this.renderService) {
      void this.renderService.dispose();
      this.renderService = null;
    }
  }

  private getRenderService(): IconRenderService {
    if (!this.renderService) {
      const cacheRoot = this.cacheRootOverride ?? join(resolveDataDir(), 'cache', 'brand-icons');
      const cpus = availableParallelism();
      this.renderService = new IconRenderService({
        cacheRoot,
        tileSize: 256,
        concurrency: cpus <= 4 ? 2 : 6,
        workerThreads: cpus <= 4 ? 2 : 4,
      });
    }
    return this.renderService;
  }

  private getLocalIntegrationDirs(): readonly string[] {
    if (this.localDirsOverride) return this.localDirsOverride;
    const candidates: string[] = [];
    const overlay = this.commissioning?.catalog.getComponentsOverlayDir();
    if (overlay) candidates.push(overlay);

    const dataDir = resolveDataDir();
    const haCustom = join(dataDir, 'ha-flow', 'config', 'custom_components');
    if (existsSync(haCustom)) candidates.push(haCustom);

    const repoCustom = resolve('custom_components');
    if (existsSync(repoCustom)) candidates.push(repoCustom);
    return candidates;
  }

  private getLocalPluginDirs(): readonly string[] {
    const candidates: string[] = [];
    const dataDir = resolveDataDir();
    const hbRoot = join(dataDir, 'kitsune', 'homebridge');
    if (existsSync(hbRoot)) candidates.push(hbRoot);
    const hbNodeModules = join(hbRoot, 'node_modules');
    if (existsSync(hbNodeModules)) candidates.push(hbNodeModules);
    return candidates;
  }

  private getLocalAddonDirs(): readonly string[] {
    const candidates: string[] = [];
    const dataDir = resolveDataDir();
    for (const dir of [join(dataDir, 'apps'), join(dataDir, 'addons'), '/addons']) {
      if (existsSync(dir)) candidates.push(dir);
    }
    return candidates;
  }

  private enrichHint(id: string, hint?: BrandIconHint): BrandIconHint | undefined {
    const cleanId = id.trim();
    const manifest = this.commissioning?.catalog.getCatalog().getManifest(cleanId.toLowerCase());
    const appEntry = this.appCatalog.get(cleanId) ?? this.appCatalog.get(cleanId.toLowerCase());

    const supportedBy = hint?.supportedBy ?? manifest?.supported_by;
    const repositoryUrl = hint?.repositoryUrl ?? appEntry?.repositoryUrl;
    const repository = hint?.repository;
    const name = hint?.name ?? manifest?.name ?? appEntry?.manifest.name;
    const category = hint?.category ?? appEntry?.category;
    const addonSlug = hint?.addonSlug;
    const addonConfigPath = hint?.addonConfigPath ?? appEntry?.addonConfigPath;

    if (
      !supportedBy &&
      !repositoryUrl &&
      !repository &&
      !name &&
      !category &&
      !addonSlug &&
      !addonConfigPath
    ) {
      return undefined;
    }
    return {
      ...(name ? { name } : {}),
      ...(supportedBy ? { supportedBy } : {}),
      ...(repositoryUrl ? { repositoryUrl } : {}),
      ...(repository ? { repository } : {}),
      ...(category ? { category } : {}),
      ...(addonSlug ? { addonSlug } : {}),
      ...(addonConfigPath ? { addonConfigPath } : {}),
    };
  }

  private buildSourceJob(
    kind: BrandIconKind,
    id: string,
    hint: BrandIconHint | undefined,
  ): IconSourceJob {
    const enrichedHint = this.enrichHint(id, hint);
    const hintKey = `${enrichedHint?.supportedBy ?? ''}:${enrichedHint?.repositoryUrl ?? ''}:${enrichedHint?.repository ?? ''}:${enrichedHint?.addonSlug ?? ''}:${enrichedHint?.addonConfigPath ?? ''}`;
    const key = `${kind}:${id}:${hintKey}`;
    return {
      key,
      label: `${kind}:${id}`,
      fetchSource: () =>
        resolveBrandIconWithMeta({
          kind,
          id,
          // Always fetch canonical light/original brand source once — the 1:1 GNOME
          // engine generates Default, Dark, Clear, and Tinted cleanly from source pixels!
          dark: false,
          hint: enrichedHint,
          localIntegrationDirs: this.getLocalIntegrationDirs(),
          localPluginDirs: this.getLocalPluginDirs(),
          localAddonDirs: this.getLocalAddonDirs(),
          fetchFn: this.fetchImpl,
          cache: this.cache,
        }),
    };
  }

  /** Backward-compatible raw source resolver. */
  async resolve(input: ResolveHubBrandIconInput): Promise<string | null> {
    const enrichedHint = this.enrichHint(input.id, input.hint);
    return resolveBrandIcon({
      kind: input.kind,
      id: input.id,
      dark: input.dark === true,
      hint: enrichedHint,
      localIntegrationDirs: this.getLocalIntegrationDirs(),
      localPluginDirs: this.getLocalPluginDirs(),
      localAddonDirs: this.getLocalAddonDirs(),
      fetchFn: this.fetchImpl,
      cache: this.cache,
    });
  }

  /** Resolves a pre-rendered, versioned 1:1 GNOME tile PNG for the requested style. */
  async resolveRendered(input: ResolveHubRenderedBrandIconInput): Promise<RenderedTileResult> {
    const valid = validateBrandIconInput(input.kind, input.id);
    const service = this.getRenderService();
    const source = this.buildSourceJob(valid.kind, valid.id, input.hint);
    const tintHex = resolveIconTintColor(input.tintHex ?? '#0a84ff');
    return service.resolveTile({
      source,
      appearance: input.appearance,
      variation: input.variation,
      tintHex,
      displaySize: input.displaySize ?? 44,
    });
  }

  getStatus(): IconRenderServiceStatus {
    return this.getRenderService().getStatus();
  }

  /**
   * Queues prioritized background icon generation across:
   * 1. Configured HA integrations & installed Homebridge plugins
   * 2. Built-in App / Add-on catalog entries
   * 3. All 1,300+ Home Assistant catalog integrations
   */
  async startBackgroundWarmup(): Promise<{ queued: number; total: number }> {
    const service = this.getRenderService();
    await service.init();

    const jobs: IconSourceJob[] = [];
    const seen = new Set<string>();
    const addJob = (kind: BrandIconKind, id: string, hint?: BrandIconHint) => {
      if (!id || id.trim().length === 0) return;
      try {
        const valid = validateBrandIconInput(kind, id);
        const job = this.buildSourceJob(valid.kind, valid.id, hint);
        if (seen.has(job.key)) return;
        seen.add(job.key);
        jobs.push(job);
      } catch {
        // skip invalid identifiers
      }
    };

    // Priority 1: Locally installed custom components (HACS / custom_components).
    try {
      for (const custom of readInstalledCustomManifests()) {
        if (custom?.domain) {
          addJob('integration', custom.domain, { name: custom.name });
        }
      }
    } catch {
      // ignore if custom components directory unavailable
    }

    // Priority 2: Built-in Apps, Bridges, Homebridge & Add-on catalog entries.
    for (const app of this.appCatalog.list()) {
      const kind: BrandIconKind =
        app.runtimeType === 'homebridge'
          ? 'homebridge'
          : app.runtimeType === 'scrypted'
            ? 'scrypted'
            : app.runtimeType === 'hacs'
              ? 'hacs'
              : app.addonConfigPath
                ? 'addon'
                : 'app';
      addJob(kind, app.manifest.id, {
        name: app.manifest.name,
        category: app.category,
        repositoryUrl: app.repositoryUrl,
        addonConfigPath: app.addonConfigPath,
      });
    }

    // Priority 2b: Locally installed Homebridge plugins in kitsune/homebridge.
    for (const dir of this.getLocalPluginDirs()) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('homebridge-')) {
            addJob('homebridge', entry.name);
          } else if (entry.name.startsWith('@')) {
            for (const scoped of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
              if (scoped.isDirectory() && scoped.name.includes('homebridge')) {
                addJob('homebridge', `${entry.name}/${scoped.name}`);
              }
            }
          }
        }
      } catch {
        // ignore unreadable plugin directory
      }
    }

    // Priority 3: All 1,300+ Home Assistant catalog integrations.
    const catalog = this.commissioning?.catalog.getCatalog();
    if (catalog) {
      for (const manifest of catalog.getAllManifests()) {
        addJob('integration', manifest.domain, {
          name: manifest.name,
          ...(manifest.supported_by ? { supportedBy: manifest.supported_by } : {}),
        });
      }
    }

    const queued = service.enqueueBackground(jobs);
    return { queued, total: jobs.length };
  }
}
