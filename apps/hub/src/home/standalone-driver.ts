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
import type { AppSupervisor } from './supervisor.js';
import { redactAppConfig, resolveConfiguredAppOptions } from './apps/config.js';
import { applyObservationToAppEntry, resolveDockerContainer } from './apps/reconcile.js';

function normalizeErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : fallback;
}

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
  configuration?: Pick<AppOptions, 'save'> & Partial<Pick<AppOptions, 'read'>>,
  catalog?: AppCatalog,
  runtimeBridges?: ReadonlyMap<AppRuntimeType, StandaloneRuntimeBridge>,
  supervisor?: Pick<AppSupervisor, 'register'>,
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
      Array.from(installedApps.values()).map((entry) => {
        const bridge = resolveRuntimeBridge(entry, catalog, runtimeBridges);
        const state = bridge?.isRunning
          ? bridge.isRunning(entry.manifest.id)
            ? 'running'
            : 'stopped'
          : entry.state;
        return {
          externalId: entry.manifest.id,
          name: entry.manifest.name,
          version: entry.manifest.version,
          image: entry.manifest.image,
          state,
          managed: true,
          actions: state === 'running' ? ['stop', 'restart'] : ['start', 'restart'],
          accessories: appAccessorySupport(entry.manifest),
        };
      }),
    execute: async (externalId: string, action: AppAction): Promise<void> => {
      const entry = installedApps.get(externalId);
      if (!entry) throw new Error('unknown_app');
      const bridge = resolveRuntimeBridge(entry, catalog, runtimeBridges);
      if (bridge) {
        await bridge.execute(entry, action);
      } else if (lifecycle) {
        const resolved = await resolveDockerContainer(entry, lifecycle);
        if (resolved.status === 'ambiguous') throw new Error('app_container_ambiguous');
        if (resolved.status === 'missing') {
          if (action !== 'stop') throw new Error('app_container_not_found');
        } else if (action === 'start') {
          await lifecycle.start(resolved.containerId);
        } else if (action === 'stop') {
          await lifecycle.stop(resolved.containerId);
        } else if (action === 'restart') {
          try {
            await lifecycle.stop(resolved.containerId);
          } catch {
            // Container may already be stopped
          }
          await lifecycle.start(resolved.containerId);
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
      } else if (lifecycle) {
        try {
          const resolved = await resolveDockerContainer(entry, lifecycle);
          if (resolved.status === 'found' && !resolved.observation) {
            const obs = await lifecycle.observe(resolved.containerId);
            applyObservationToAppEntry(entry, obs);
          }
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
          if (bridge) {
            const runtimeLogs = bridge.getLogs?.(externalId) ?? [];
            return { status: 'ok', data: { lines: [...entry.logs, ...runtimeLogs] } };
          }
          if (lifecycle && typeof lifecycle.logs === 'function') {
            try {
              const resolved = await resolveDockerContainer(entry, lifecycle, signal);
              if (resolved.status === 'found') {
                const tail =
                  typeof options?.tail === 'number' && Number.isFinite(options.tail)
                    ? options.tail
                    : 200;
                const containerLogs = await lifecycle.logs(
                  resolved.containerId,
                  { tail, timestamps: true },
                  signal,
                );
                if (containerLogs.length > 0) {
                  return { status: 'ok', data: { lines: containerLogs } };
                }
              }
            } catch {
              // Fall back to recorded lifecycle events when container logs cannot be read.
            }
          }
          return { status: 'ok', data: { lines: [...entry.logs] } };
        }
        case 'info': {
          const liveConfig = configuration?.read
            ? configuration.read(entry.manifest.id, entry.config)
            : entry.config;
          const declaredSecrets = entry.manifest.secrets?.map((secret) => secret.name);
          const { config, configuredSecrets } = redactAppConfig(liveConfig, declaredSecrets);
          const nativeFields = bridge?.getNativeConfigSchema?.(entry.manifest.id);
          return {
            status: 'ok',
            data: {
              manifest: entry.manifest,
              state: entry.state,
              config,
              configuredSecrets,
              ...(nativeFields ? { nativeFields } : {}),
            },
          };
        }
        case 'configure': {
          if (!configuration) return { status: 'unsupported', reason: 'app_options_unavailable' };
          const liveConfig = configuration.read
            ? configuration.read(entry.manifest.id, entry.config)
            : entry.config;
          const declaredSecrets = entry.manifest.secrets?.map((secret) => secret.name);
          const next = resolveConfiguredAppOptions(liveConfig, options, declaredSecrets);
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
          if (lifecycle) {
            try {
              const resolved = await resolveDockerContainer(entry, lifecycle, signal);
              if (resolved.status === 'ambiguous') {
                return { status: 'error', reason: 'app_container_ambiguous' };
              }
              if (resolved.status === 'found') {
                await lifecycle.remove(resolved.containerId, true, signal);
              }
            } catch (error) {
              const reason = signal?.aborted
                ? 'app_operation_cancelled'
                : normalizeErrorCode(error, 'app_remove_failed');
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
            isMutableImageTag(entry.manifest.image) ||
            Boolean(catalogManifest && isMutableImageTag(catalogManifest.image)) ||
            options?.force === true;
          const targetManifest =
            updateCheck.targetManifest ??
            (allowMutableRefresh ? (catalogManifest ?? entry.manifest) : undefined);
          if ((!updateCheck.updateAvailable && !allowMutableRefresh) || !targetManifest) {
            return { status: 'error', reason: 'no_update_available' };
          }

          // Re-assess permissions: preserve permissions already held by the installed manifest
          // (including migrated entries without stored grantedPermissions), while still requiring
          // explicit re-authorization for any NEW permission introduced in targetManifest.
          const inheritedPermissions = assessAppPermissions(entry.manifest, []).missingPermissions;
          const existingPermissions = Array.from(
            new Set([...(entry.grantedPermissions ?? []), ...inheritedPermissions]),
          );
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
              return {
                status: 'error',
                reason: normalizeErrorCode(error, 'app_update_failed'),
              };
            }
          }

          if (!lifecycle) return { status: 'error', reason: 'app_runtime_unavailable' };

          try {
            const resolved = await resolveDockerContainer(entry, lifecycle, signal);
            if (resolved.status === 'ambiguous') {
              return { status: 'error', reason: 'app_container_ambiguous' };
            }

            const runtimeEnvironment = targetManifest.services?.length
              ? ((await supervisor?.register(targetManifest, entry.config)) ?? {})
              : {};

            const installFreshContainer = async (): Promise<AppOperationResult> => {
              if (typeof lifecycle.install !== 'function') {
                return { status: 'error', reason: 'app_container_not_found' };
              }
              const installed = await lifecycle.install(
                targetManifest,
                allGranted,
                runtimeEnvironment,
                undefined,
                signal,
              );
              if (entry.state === 'running') {
                try {
                  await lifecycle.start(installed.containerId, signal);
                } catch {
                  await lifecycle.remove(installed.containerId, true).catch(() => undefined);
                  throw Error('app_start_failed');
                }
              }
              entry.manifest = targetManifest;
              entry.containerId = installed.containerId;
              if (installed.image) entry.image = installed.image;
              entry.grantedPermissions = allGranted;
              entry.logs.push(
                `[${new Date().toISOString()}] App updated to ${targetManifest.version}`,
              );
              return {
                status: 'ok',
                data: {
                  updated: externalId,
                  version: targetManifest.version,
                  ...(installed.image ? { digest: installed.image.digest } : {}),
                },
              };
            };

            if (resolved.status === 'missing') {
              return await installFreshContainer();
            }

            let updateResult: Awaited<ReturnType<DockerAppLifecycle['update']>>;
            try {
              updateResult = await lifecycle.update(
                resolved.containerId,
                targetManifest,
                allGranted,
                runtimeEnvironment,
                undefined,
                signal,
              );
            } catch (error) {
              const code = normalizeErrorCode(error, 'app_update_failed');
              if (
                (code === 'container_not_found' || code === 'docker_request_failed') &&
                typeof lifecycle.findContainer === 'function'
              ) {
                const recovered = await lifecycle.findContainer(entry.manifest.id, signal);
                if (recovered.state === 'missing') {
                  return await installFreshContainer();
                }
                if (
                  (recovered.state === 'running' || recovered.state === 'stopped') &&
                  recovered.containerId !== resolved.containerId
                ) {
                  updateResult = await lifecycle.update(
                    recovered.containerId,
                    targetManifest,
                    allGranted,
                    runtimeEnvironment,
                    undefined,
                    signal,
                  );
                } else {
                  throw error;
                }
              } else {
                throw error;
              }
            }

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
            return {
              status: 'error',
              reason: normalizeErrorCode(error, 'app_update_failed'),
            };
          }
        }
        case 'install':
          return { status: 'ok', data: { installed: externalId } };
      }
    },
  };
}
