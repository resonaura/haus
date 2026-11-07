/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  AppAction,
  AppDriver,
  AppInfo,
  AppManifest,
  AppOperation,
  AppOperationResult,
  RuntimeApp,
} from '@haus/apps';

export interface InstalledAppEntry {
  manifest: AppManifest;
  state: 'running' | 'stopped';
  logs: string[];
  config: Record<string, unknown>;
}

export function createStandaloneAppDriver(
  installedApps: Map<string, InstalledAppEntry>,
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
      entry.state = action === 'stop' ? 'stopped' : 'running';
      entry.logs.push(`[${new Date().toISOString()}] App ${action}`);
    },
    inspect: async (externalId: string): Promise<AppOperationResult<AppInfo>> => {
      const entry = installedApps.get(externalId);
      if (!entry) return { status: 'error', reason: 'unknown_app' };
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
