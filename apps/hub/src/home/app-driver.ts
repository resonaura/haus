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
  appAccessorySupport,
  assessAppPermissions,
  DockerAppLifecycle,
  DockerSocket,
  AppImageAcquirer,
  resolveAppStartupOrder,
  validateAppManifest,
  type AppAction,
  type AppDriver,
  type AppInfo,
  type AppInventory,
  type AppManifest,
  type AppOperation,
  type AppOperationResult,
  type AppPermissionType,
  type RuntimeApp,
  type ResolvedAppImage,
  type AppInstallProgressUpdate,
} from '@haus/apps';
import type { Identities } from '@haus/core/types';
import type { LiveService } from '../live/types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';
import type { AppSupervisor, AppSupervisorOptions } from './supervisor.js';
import { AppOptions, persistAppOptions } from './options.js';

export interface InstalledAppEntry {
  manifest: AppManifest;
  state: 'running' | 'stopped';
  logs: string[];
  config: Record<string, unknown>;
  containerId?: string;
  image?: ResolvedAppImage;
}

export interface AppInstallProgress extends AppInstallProgressUpdate {
  readonly appId: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
  readonly image?: ResolvedAppImage;
}

export function createStandaloneAppDriver(
  installedApps: Map<string, InstalledAppEntry>,
  lifecycle?: DockerAppLifecycle,
  configuration?: Pick<AppOptions, 'save'>,
): AppDriver {
  return {
    id: 'standalone-local',
    capabilities: {
      lifecycle: true,
      install: true,
      remove: true,
      update: false,
      configure: Boolean(configuration),
      logs: true,
      info: true,
    },
    list: async (): Promise<readonly RuntimeApp[]> =>
      Array.from(installedApps.values()).map((entry) => ({
        externalId: entry.manifest.id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        image: entry.manifest.image,
        state: entry.state,
        managed: true,
        actions: entry.state === 'running' ? ['stop', 'restart'] : ['start', 'restart'],
        accessories: appAccessorySupport(entry.manifest),
      })),
    execute: async (externalId: string, action: AppAction): Promise<void> => {
      const entry = installedApps.get(externalId);
      if (!entry) throw new Error('unknown_app');
      if (entry.containerId && lifecycle) {
        if (action === 'start') {
          await lifecycle.start(entry.containerId);
        } else if (action === 'stop') {
          await lifecycle.stop(entry.containerId);
        } else if (action === 'restart') {
          try {
            await lifecycle.stop(entry.containerId);
          } catch {
            // Container may already be stopped
          }
          await lifecycle.start(entry.containerId);
        }
      }
      entry.state = action === 'stop' ? 'stopped' : 'running';
      entry.logs.push(`[${new Date().toISOString()}] App ${action}`);
    },
    inspect: async (externalId: string): Promise<AppOperationResult<AppInfo>> => {
      const entry = installedApps.get(externalId);
      if (!entry) return { status: 'error', reason: 'unknown_app' };
      if (entry.containerId && lifecycle) {
        try {
          const obs = await lifecycle.observe(entry.containerId);
          entry.state = obs.state === 'running' ? 'running' : 'stopped';
        } catch {
          // Keep recorded state if observe fails
        }
      }
      return {
        status: 'ok',
        data: {
          externalId: entry.manifest.id,
          name: entry.manifest.name,
          version: entry.manifest.version,
          image: entry.manifest.image,
          state: entry.state,
          managed: true,
          description: entry.manifest.description,
          ports: entry.manifest.ports?.map((p) => p.containerPort) ?? [],
        },
      };
    },
    operate: async (
      operation: AppOperation,
      externalId: string,
      options?: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<AppOperationResult> => {
      const entry = installedApps.get(externalId);
      if (!entry) return { status: 'error', reason: 'unknown_app' };
      switch (operation) {
        case 'logs':
          return { status: 'ok', data: { lines: [...entry.logs] } };
        case 'info':
          return { status: 'ok', data: { manifest: entry.manifest, state: entry.state } };
        case 'configure': {
          if (!configuration) return { status: 'unsupported', reason: 'app_options_unavailable' };
          const next = { ...entry.config, ...options };
          try {
            configuration.save(entry.manifest.id, next);
          } catch {
            return { status: 'error', reason: 'app_options_persist_failed' };
          }
          entry.config = next;
          return { status: 'ok', data: { configured: true } };
        }
        case 'remove':
          if (entry.containerId && !lifecycle) {
            return { status: 'error', reason: 'app_runtime_unavailable' };
          }
          if (entry.containerId && lifecycle) {
            try {
              await lifecycle.remove(entry.containerId, true, signal);
            } catch (error) {
              const message = error instanceof Error ? error.message : '';
              const reason = signal?.aborted
                ? 'app_operation_cancelled'
                : /^[a-z][a-z0-9_]{0,79}$/.test(message)
                  ? message
                  : 'app_remove_failed';
              return { status: 'error', reason };
            }
          }
          installedApps.delete(externalId);
          return { status: 'ok', data: { removed: externalId } };
        case 'update':
          return { status: 'unsupported', reason: 'app_update_requires_catalog_manifest' };
        case 'install':
          return { status: 'ok', data: { installed: externalId } };
      }
    },
  };
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
    const app = (await this.apps.list(actorId)).apps.find((item) => item.id === appId);
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
    await this.apps.list(actorId, signal);
    await this.apps.execute(actorId, appId, action, signal);
    this.liveService?.publish('apps');
  }

  async inspectApp(
    actorId: string,
    appId: string,
    signal?: AbortSignal,
  ): Promise<AppOperationResult<AppInfo>> {
    await this.apps.list(actorId, signal);
    return this.apps.inspect(actorId, appId, signal);
  }

  async operateApp(
    actorId: string,
    appId: string,
    operation: AppOperation,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppOperationResult> {
    const inventory = await this.apps.list(actorId, signal);
    const app = inventory.apps.find((item) => item.id === appId);
    const result = await this.apps.operate(actorId, appId, operation, options, signal);
    if (operation === 'remove' && result.status === 'ok' && app)
      this.supervisor?.unregister(app.source.externalId);
    if (operation === 'configure' && result.status === 'ok' && app) {
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
  apps.register(createStandaloneAppDriver(installedApps, lifecycle, options));

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
  );
  return { apps, appManager };
}
