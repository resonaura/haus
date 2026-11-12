/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import {
  Apps,
  AppCatalog,
  assessAppPermissions,
  DockerAppLifecycle,
  DockerSocket,
  AppImageAcquirer,
  resolveAppStartupOrder,
  validateAppManifest,
  type AppAction,
  type AppCatalogEntry,
  type AppCatalogFilter,
  type AppInfo,
  type AppInventory,
  type AppManifest,
  type AppOperation,
  type AppOperationResult,
  type AppPermissionType,
  type AppUpdateCheckResult,
  type MarketplaceAppEntry,
  type ResolvedAppImage,
  type AppInstallProgressUpdate,
} from '@haus/apps';
import type { Identities } from '@haus/core/types';
import type { LiveService } from '../live/types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';
import type { AppSupervisor, AppSupervisorOptions } from './supervisor.js';
import { AppOptions, persistAppOptions } from './options.js';
import { createStandaloneAppDriver } from './standalone-driver.js';

export { createStandaloneAppDriver };

export interface InstalledAppEntry {
  manifest: AppManifest;
  state: 'running' | 'stopped';
  logs: string[];
  config: Record<string, unknown>;
  containerId?: string;
  image?: ResolvedAppImage;
  grantedPermissions?: readonly AppPermissionType[];
}

export interface AppInstallProgress extends AppInstallProgressUpdate {
  readonly appId: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
  readonly image?: ResolvedAppImage;
}

export class StandaloneAppManager {
  private supervisorConfigured = false;
  private readonly installing = new Set<string>();
  private readonly installProgress = new Map<string, AppInstallProgress>();
  private readonly progressPublishedAt = new Map<string, number>();

  constructor(
    private readonly installedApps: Map<string, InstalledAppEntry>,
    private readonly apps: Apps,
    private readonly persistence: StandaloneHomePersistence,
    private readonly liveService?: LiveService,
    public readonly lifecycle?: DockerAppLifecycle,
    private dataRoot: string = '/data/apps',
    private readonly supervisor?: AppSupervisor,
    private hostDataRoot: string = dataRoot,
    private readonly options = new AppOptions(dataRoot),
    public readonly catalog: AppCatalog = AppCatalog.createDefaultCatalog(),
  ) {}

  async configureSupervisor(options: AppSupervisorOptions): Promise<void> {
    this.dataRoot = resolve(options.dataDirectory, 'apps');
    this.options.setRoot(this.dataRoot);
    this.hostDataRoot = resolve(options.hostDataDirectory ?? options.dataDirectory, 'apps');
    this.lifecycle?.setDataRoot(this.dataRoot, this.hostDataRoot);
    await this.supervisor?.configure(options);
    this.supervisorConfigured = Boolean(this.supervisor);
    await this.restoreSupervisorApps();
  }

  async restoreSupervisorApps(): Promise<void> {
    if (!this.supervisor || !this.supervisorConfigured) return;
    for (const entry of this.installedApps.values()) {
      if (!entry.containerId) continue;
      try {
        await this.supervisor.register(entry.manifest, entry.config);
      } catch {
        process.emitWarning('app_supervisor_restore_failed');
      }
    }
  }

  handleSupervisorRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    return this.supervisor?.handleRequest(req, res) ?? Promise.resolve(false);
  }

  async close(): Promise<void> {
    await this.supervisor?.close();
  }

  async installApp(
    actorId: string,
    manifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[] = [],
    config?: Record<string, unknown>,
  ): Promise<{ appId: string; manifest: AppManifest; image?: ResolvedAppImage }> {
    const validation = validateAppManifest(manifest);
    if (!validation.valid || !validation.manifest) {
      throw new Error(`invalid_manifest: ${validation.errors.join('; ')}`);
    }
    const appId = validation.manifest.id;
    if (this.installedApps.has(appId)) throw Error('app_already_installed');
    if (this.installing.has(appId)) throw Error('app_install_in_progress');
    this.installing.add(appId);
    this.setInstallProgress(appId, { stage: 'validating' });

    try {
      const assessment = assessAppPermissions(validation.manifest, grantedPermissions);
      if (!assessment.allowed) {
        const reasons = [
          ...assessment.violations.map((v) => v.code),
          ...assessment.missingPermissions.map((p) => `missing_permission:${p}`),
        ];
        throw new Error(`policy_violation: ${reasons.join(', ')}`);
      }

      const allManifests = [
        ...Array.from(this.installedApps.values()).map((e) => e.manifest),
        validation.manifest,
      ];
      resolveAppStartupOrder(allManifests);

      if (config) {
        persistAppOptions(this.dataRoot, validation.manifest.id, config);
      }

      let containerId: string | undefined;
      let image: ResolvedAppImage | undefined;
      if (this.lifecycle) {
        const runtimeEnvironment = await this.supervisor?.register(
          validation.manifest,
          config ?? {},
        );
        try {
          const res = await this.lifecycle.install(
            validation.manifest,
            grantedPermissions,
            runtimeEnvironment,
            (progress) => this.setInstallProgress(appId, progress),
          );
          containerId = res.containerId;
          image = res.image;
          this.setInstallProgress(appId, { stage: 'starting' }, image);
          try {
            await this.lifecycle.start(containerId);
          } catch {
            throw Error('app_start_failed');
          }
        } catch (error) {
          this.supervisor?.unregister(validation.manifest.id);
          if (containerId) {
            try {
              await this.lifecycle.remove(containerId, true);
            } catch {
              // The original install/start error remains the actionable failure.
            }
          }
          throw error;
        }
      }

      const appEntry: InstalledAppEntry = {
        manifest: validation.manifest,
        state: 'running',
        logs: [`[${new Date().toISOString()}] Installed ${validation.manifest.id}`],
        config: config ?? {},
        containerId,
        image,
        grantedPermissions: [...grantedPermissions],
      };
      this.installedApps.set(validation.manifest.id, appEntry);
      await this.persistence.save('app', validation.manifest.id, appEntry);

      const inventory = await this.apps.list(actorId);
      const created = inventory.apps.find((a) => a.source.externalId === validation.manifest!.id);
      this.liveService?.publish('apps');
      this.setInstallProgress(appId, { stage: 'complete' }, image);
      return {
        appId: created?.id ?? validation.manifest.id,
        manifest: validation.manifest,
        image,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const errorCode = /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : 'app_install_failed';
      this.setInstallProgress(appId, { stage: 'failed' }, undefined, errorCode);
      throw error;
    } finally {
      this.installing.delete(appId);
    }
  }

  getInstallProgress(appId: string): AppInstallProgress | undefined {
    const progress = this.installProgress.get(appId);
    return progress ? { ...progress } : undefined;
  }

  private setInstallProgress(
    appId: string,
    update: AppInstallProgressUpdate,
    image?: ResolvedAppImage,
    errorCode?: string,
  ): void {
    this.installProgress.set(appId, {
      appId,
      ...update,
      updatedAt: new Date().toISOString(),
      ...(errorCode ? { errorCode } : {}),
      ...(image ? { image } : {}),
    });
    if (this.installProgress.size > 32) {
      const oldest = [...this.installProgress.values()].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      )[0];
      if (oldest) this.installProgress.delete(oldest.appId);
    }
    const now = Date.now();
    const lastPublished = this.progressPublishedAt.get(appId) ?? 0;
    if (now - lastPublished >= 250 || update.stage === 'complete' || update.stage === 'failed') {
      this.progressPublishedAt.set(appId, now);
      this.liveService?.publish('apps');
    }
  }

  async listApps(actorId: string, signal?: AbortSignal): Promise<AppInventory> {
    return this.apps.list(actorId, signal);
  }

  async accessoryManifest(actorId: string, appId: string): Promise<AppManifest> {
    const app = (await this.apps.list(actorId)).apps.find(
      (item) => item.id === appId || item.source.externalId === appId,
    );
    if (!app || !app.managed || !app.available || app.source.instanceId !== 'standalone-local')
      throw Error('app_accessories_unavailable');
    const entry = this.installedApps.get(app.source.externalId);
    if (!entry || entry.state !== 'running') throw Error('app_not_running');
    return entry.manifest;
  }

  async executeApp(
    actorId: string,
    appId: string,
    action: AppAction,
    signal?: AbortSignal,
  ): Promise<void> {
    const app = (await this.apps.list(actorId, signal)).apps.find(
      (item) => item.id === appId || item.source.externalId === appId,
    );
    if (!app) throw Error('unknown_app');
    await this.apps.execute(actorId, app.id, action, signal);
    this.liveService?.publish('apps');
  }

  listCatalog(filter?: AppCatalogFilter): readonly AppCatalogEntry[] {
    return this.catalog.list(filter);
  }

  getCatalogEntry(appId: string): AppCatalogEntry | undefined {
    return this.catalog.get(appId);
  }

  listMarketplace(filter?: AppCatalogFilter): readonly MarketplaceAppEntry[] {
    const installedMap = new Map<string, { manifest: AppManifest; state: 'running' | 'stopped' }>();
    for (const [id, entry] of this.installedApps) {
      installedMap.set(id, { manifest: entry.manifest, state: entry.state });
    }
    return this.catalog.toMarketplaceEntries(installedMap, filter);
  }

  checkAppUpdate(appId: string): AppUpdateCheckResult {
    const entry = this.installedApps.get(appId);
    const currentVersion = entry?.manifest.version ?? 'unknown';
    return this.catalog.checkUpdate(appId, currentVersion);
  }

  async updateApp(
    actorId: string,
    appId: string,
    grantedPermissions?: readonly AppPermissionType[],
    signal?: AbortSignal,
  ): Promise<AppOperationResult> {
    return this.operateApp(actorId, appId, 'update', { grantedPermissions }, signal);
  }

  async inspectApp(
    actorId: string,
    appId: string,
    signal?: AbortSignal,
  ): Promise<AppOperationResult<AppInfo>> {
    const app = (await this.apps.list(actorId, signal)).apps.find(
      (item) => item.id === appId || item.source.externalId === appId,
    );
    if (!app) return { status: 'error', reason: 'unknown_app' };
    return this.apps.inspect(actorId, app.id, signal);
  }

  async operateApp(
    actorId: string,
    appId: string,
    operation: AppOperation,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppOperationResult> {
    const inventory = await this.apps.list(actorId, signal);
    const app = inventory.apps.find(
      (item) => item.id === appId || item.source.externalId === appId,
    );
    if (!app) return { status: 'error', reason: 'unknown_app' };
    const result = await this.apps.operate(actorId, app.id, operation, options, signal);
    if (operation === 'remove' && result.status === 'ok')
      this.supervisor?.unregister(app.source.externalId);
    if (operation === 'configure' && result.status === 'ok') {
      const entry = this.installedApps.get(app.source.externalId);
      if (entry) await this.supervisor?.register(entry.manifest, entry.config);
    }
    for (const [manifestId, entry] of this.installedApps) {
      await this.persistence.save('app', manifestId, entry);
    }
    this.liveService?.publish('apps');
    return result;
  }
}

export function createStandaloneAppManager(
  installedApps: Map<string, InstalledAppEntry>,
  identities: Identities,
  persistence: StandaloneHomePersistence,
  liveService?: LiveService,
  supervisor?: AppSupervisor,
  catalog: AppCatalog = AppCatalog.createDefaultCatalog(),
): { apps: Apps; appManager: StandaloneAppManager } {
  const socketPath = process.env.HAUS_DOCKER_SOCKET ?? '/var/run/docker.sock';
  const dataDirectory = resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  const dataRoot = resolve(dataDirectory, 'apps');
  const hostDataRoot = resolve(process.env.HAUS_DATA_HOST_DIR ?? dataDirectory, 'apps');
  let lifecycle: DockerAppLifecycle | undefined;

  if (existsSync(socketPath)) {
    try {
      const docker = new DockerSocket(socketPath);
      lifecycle = new DockerAppLifecycle(
        docker,
        { dataRoot, hostDataRoot },
        new AppImageAcquirer(docker),
      );
    } catch {
      // Docker socket unavailable
    }
  }

  const apps = new Apps(identities, {
    authorize: async (actorId) => Boolean(actorId && actorId.trim().length > 0),
  });
  const options = new AppOptions(dataRoot);
  apps.register(createStandaloneAppDriver(installedApps, lifecycle, options, catalog));

  const appManager = new StandaloneAppManager(
    installedApps,
    apps,
    persistence,
    liveService,
    lifecycle,
    dataRoot,
    supervisor,
    hostDataRoot,
    options,
    catalog,
  );
  return { apps, appManager };
}
