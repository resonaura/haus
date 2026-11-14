/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  appAccessorySupport,
  assessAppPermissions,
  isMutableImageTag,
  type AppAction,
  type AppCatalog,
  type AppDriver,
  type AppInfo,
  type AppOperation,
  type AppOperationResult,
  type AppPermissionType,
  type AppRuntimeType,
  type DockerAppLifecycle,
  type RuntimeApp,
} from '@haus/apps';
import type { AppOptions } from './options.js';
import type { InstalledAppEntry, StandaloneRuntimeBridge } from './app-driver.js';

function resolveRuntimeBridge(
  entry: InstalledAppEntry,
  catalog?: AppCatalog,
  runtimeBridges?: ReadonlyMap<AppRuntimeType, StandaloneRuntimeBridge>,
): StandaloneRuntimeBridge | undefined {
  if (!runtimeBridges || runtimeBridges.size === 0) return undefined;
  const catalogEntry = catalog?.get(entry.manifest.id);
  if (catalogEntry?.runtimeType) {
    const byType = runtimeBridges.get(catalogEntry.runtimeType);
    if (byType?.supports(entry.manifest, catalogEntry)) return byType;
  }
  for (const bridge of runtimeBridges.values()) {
    if (bridge.supports(entry.manifest, catalogEntry)) return bridge;
  }
  return undefined;
}

export function createStandaloneAppDriver(
  installedApps: Map<string, InstalledAppEntry>,
  lifecycle?: DockerAppLifecycle,
  configuration?: Pick<AppOptions, 'save'>,
  catalog?: AppCatalog,
  runtimeBridges?: ReadonlyMap<AppRuntimeType, StandaloneRuntimeBridge>,
): AppDriver {
  return {
    id: 'standalone-local',
    capabilities: {
      lifecycle: true,
      install: true,
      remove: true,
      update: Boolean(catalog && (lifecycle || (runtimeBridges && runtimeBridges.size > 0))),
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
      const bridge = resolveRuntimeBridge(entry, catalog, runtimeBridges);
      if (bridge) {
        await bridge.execute(entry, action);
      } else if (entry.containerId && lifecycle) {
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
      const bridge = resolveRuntimeBridge(entry, catalog, runtimeBridges);
      let extraInfo: Partial<AppInfo> | undefined;
      if (bridge?.inspect) {
        try {
          extraInfo = await bridge.inspect(entry);
        } catch {
          // Keep recorded state if runtime bridge inspect fails
        }
      } else if (entry.containerId && lifecycle) {
        try {
          const obs = await lifecycle.observe(entry.containerId);
          entry.state = obs.state === 'running' ? 'running' : 'stopped';
        } catch {
          // Keep recorded state if observe fails
        }
      }

      let updatable = false;
      let updateVersion: string | undefined;
      if (catalog) {
        const updateCheck = catalog.checkUpdate(entry.manifest.id, entry.manifest.version);
        updatable = updateCheck.updateAvailable;
        updateVersion = updateCheck.latestVersion;
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
          description: extraInfo?.description ?? entry.manifest.description,
          ports: entry.manifest.ports?.map((p) => p.containerPort) ?? [],
          updatable,
          updateVersion,
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
      const bridge = resolveRuntimeBridge(entry, catalog, runtimeBridges);
      switch (operation) {
        case 'logs': {
          const runtimeLogs = bridge?.getLogs?.(externalId) ?? [];
          return { status: 'ok', data: { lines: [...entry.logs, ...runtimeLogs] } };
        }
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
          if (bridge?.configureApp) {
            await bridge.configureApp(entry, next);
          }
          return { status: 'ok', data: { configured: true } };
        }
        case 'remove':
          if (bridge) {
            await bridge.removeApp?.(entry);
            installedApps.delete(externalId);
            return { status: 'ok', data: { removed: externalId } };
          }
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
        case 'update': {
          if (!bridge && !lifecycle) return { status: 'error', reason: 'app_runtime_unavailable' };
          if (!catalog) return { status: 'unsupported', reason: 'app_catalog_unavailable' };

          // Trusted target manifest MUST come from the trusted catalog, never untrusted client payloads
          const updateCheck = catalog.checkUpdate(entry.manifest.id, entry.manifest.version);
          const catalogManifest = catalog.get(entry.manifest.id)?.manifest;
          const allowMutableRefresh =
            isMutableImageTag(entry.manifest.image) || options?.force === true;
          const targetManifest =
            updateCheck.targetManifest ??
            (allowMutableRefresh ? (catalogManifest ?? entry.manifest) : undefined);
          if ((!updateCheck.updateAvailable && !allowMutableRefresh) || !targetManifest) {
            return { status: 'error', reason: 'no_update_available' };
          }

          // Re-assess permissions: preserve existing permissions and re-authorize newly granted ones
          const existingPermissions = entry.grantedPermissions ?? [];
          const newlyGranted = Array.isArray(options?.grantedPermissions)
            ? (options.grantedPermissions as readonly AppPermissionType[])
            : [];
          const allGranted = Array.from(new Set([...existingPermissions, ...newlyGranted]));
          const assessment = assessAppPermissions(targetManifest, allGranted);
          if (assessment.missingPermissions.length > 0) {
            return {
              status: 'error',
              reason: 'reauthorization_required',
              data: { missingPermissions: assessment.missingPermissions },
            };
          }

          if (bridge) {
            try {
              const updateResult = await bridge.updateApp?.(entry, targetManifest);
              entry.manifest = targetManifest;
              entry.grantedPermissions = allGranted;
              entry.logs.push(
                `[${new Date().toISOString()}] App updated to ${targetManifest.version}`,
                ...(updateResult?.logs ?? []),
              );
              return {
                status: 'ok',
                data: { updated: externalId, version: targetManifest.version },
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : '';
              return {
                status: 'error',
                reason: /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : 'app_update_failed',
              };
            }
          }

          if (!entry.containerId || !lifecycle) {
            entry.manifest = targetManifest;
            entry.grantedPermissions = allGranted;
            return { status: 'ok', data: { updated: externalId, version: targetManifest.version } };
          }

          try {
            const updateResult = await lifecycle.update(
              entry.containerId,
              targetManifest,
              allGranted,
              {},
              undefined,
              signal,
            );
            if (updateResult.rolledBack) {
              return {
                status: 'error',
                reason: updateResult.errorCode ?? 'app_update_failed',
                data: { rolledBack: true },
              };
            }
            entry.manifest = targetManifest;
            entry.containerId = updateResult.containerId;
            if (updateResult.image) entry.image = updateResult.image;
            entry.grantedPermissions = allGranted;
            entry.logs.push(
              `[${new Date().toISOString()}] App updated to ${targetManifest.version}`,
            );
            return {
              status: 'ok',
              data: {
                updated: externalId,
                version: targetManifest.version,
                ...(updateResult.image ? { digest: updateResult.image.digest } : {}),
              },
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            return {
              status: 'error',
              reason: /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : 'app_update_failed',
            };
          }
        }
        case 'install':
          return { status: 'ok', data: { installed: externalId } };
      }
    },
  };
}
