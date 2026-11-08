/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Apps,
  assessAppPermissions,
  DockerAppLifecycle,
  DockerSocket,
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
} from '@haus/apps';
import type { Identities } from '@haus/core/types';
import type { LiveService } from '../live/types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';

export interface InstalledAppEntry {
  manifest: AppManifest;
  state: 'running' | 'stopped';
  logs: string[];
  config: Record<string, unknown>;
  containerId?: string;
}

export function createStandaloneAppDriver(
  installedApps: Map<string, InstalledAppEntry>,
  lifecycle?: DockerAppLifecycle,
): AppDriver {
  return {
    id: 'standalone-local',
    capabilities: {
      lifecycle: true,
      install: true,
      remove: true,
      update: true,
      configure: true,
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
    ): Promise<AppOperationResult> => {
      const entry = installedApps.get(externalId);
      if (!entry) return { status: 'error', reason: 'unknown_app' };
      switch (operation) {
        case 'logs':
          return { status: 'ok', data: { lines: [...entry.logs] } };
        case 'info':
          return { status: 'ok', data: { manifest: entry.manifest, state: entry.state } };
        case 'configure':
          entry.config = { ...entry.config, ...options };
          return { status: 'ok', data: { config: entry.config } };
        case 'remove':
          if (entry.containerId && lifecycle) {
            try {
              await lifecycle.remove(entry.containerId, true);
            } catch {
              // Best-effort cleanup
            }
          }
          installedApps.delete(externalId);
          return { status: 'ok', data: { removed: externalId } };
        case 'update':
          if (typeof options?.version === 'string') {
            entry.manifest = { ...entry.manifest, version: options.version };
          }
          return { status: 'ok', data: { version: entry.manifest.version } };
        case 'install':
          return { status: 'ok', data: { installed: externalId } };
      }
    },
  };
}

export class StandaloneAppManager {
  constructor(
    private readonly installedApps: Map<string, InstalledAppEntry>,
    private readonly apps: Apps,
    private readonly persistence: StandaloneHomePersistence,
    private readonly liveService?: LiveService,
    public readonly lifecycle?: DockerAppLifecycle,
    private readonly dataRoot: string = '/data/apps',
  ) {}

  async installApp(
    actorId: string,
    manifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[] = [],
    config?: Record<string, unknown>,
  ): Promise<{ appId: string; manifest: AppManifest }> {
    const validation = validateAppManifest(manifest);
    if (!validation.valid || !validation.manifest) {
      throw new Error(`invalid_manifest: ${validation.errors.join('; ')}`);
    }
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
      try {
        const appDataDir = join(this.dataRoot, validation.manifest.id, 'data');
        mkdirSync(appDataDir, { recursive: true });
        writeFileSync(join(appDataDir, 'options.json'), JSON.stringify(config, null, 2));
      } catch {
        // Continue if host filesystem access fails
      }
    }

    let containerId: string | undefined;
    if (this.lifecycle) {
      const res = await this.lifecycle.install(validation.manifest, grantedPermissions);
      containerId = res.containerId;
      await this.lifecycle.start(containerId);
    }

    const appEntry: InstalledAppEntry = {
      manifest: validation.manifest,
      state: 'running',
      logs: [`[${new Date().toISOString()}] Installed ${validation.manifest.id}`],
      config: config ?? {},
      containerId,
    };
    this.installedApps.set(validation.manifest.id, appEntry);
    await this.persistence.save('app', validation.manifest.id, appEntry);

    const inventory = await this.apps.list(actorId);
    const created = inventory.apps.find((a) => a.source.externalId === validation.manifest!.id);
    this.liveService?.publish('apps');
    return {
      appId: created?.id ?? validation.manifest.id,
      manifest: validation.manifest,
    };
  }

  async listApps(actorId: string, signal?: AbortSignal): Promise<AppInventory> {
    return this.apps.list(actorId, signal);
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
    await this.apps.list(actorId, signal);
    const result = await this.apps.operate(actorId, appId, operation, options, signal);
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
): { apps: Apps; appManager: StandaloneAppManager } {
  const socketPath = process.env.HAUS_DOCKER_SOCKET ?? '/var/run/docker.sock';
  const dataRoot = process.env.HAUS_DATA ? `${process.env.HAUS_DATA}/apps` : '/data/apps';
  let lifecycle: DockerAppLifecycle | undefined;

  if (existsSync(socketPath)) {
    try {
      lifecycle = new DockerAppLifecycle(new DockerSocket(socketPath), { dataRoot });
    } catch {
      // Docker socket unavailable
    }
  }

  const apps = new Apps(identities, {
    authorize: async (actorId) => Boolean(actorId && actorId.trim().length > 0),
  });
  apps.register(createStandaloneAppDriver(installedApps, lifecycle));

  const appManager = new StandaloneAppManager(
    installedApps,
    apps,
    persistence,
    liveService,
    lifecycle,
    dataRoot,
  );
  return { apps, appManager };
}
