/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Apps, AppAction, AppOperation, AppOperationResult } from '@haus/apps';
import type { HausDevice } from '@haus/core';
import type { LiveService } from '../live/types.js';
import type { ClusterLeaseService } from '../cluster/coordination/leases.js';
import type { ClusterOrchestrator } from '../cluster/coordination/orchestrator.js';
import { deriveRequirementsFromWorkloadMeta } from '../cluster/coordination/placement.js';
import type { ClusterSyncService } from '../cluster/sync/service.js';
import type { InstalledAppEntry } from './app-driver.js';
import { applyHomeSnapshot, type StandaloneHomePersistence } from './home.persistence.js';
import type { AppSupervisor } from './supervisor.js';

export type HomeSnapshotApplyTargets = Parameters<typeof applyHomeSnapshot>[1];

export async function loadAndApplyHomeSnapshot(
  persistence: StandaloneHomePersistence,
  targets: HomeSnapshotApplyTargets,
) {
  const snapshot = await persistence.load();
  await applyHomeSnapshot(snapshot, targets);
  return snapshot;
}

export interface HomeAppClusterBindings {
  readonly installedApps: Map<string, InstalledAppEntry>;
  readonly apps: Apps;
  readonly persistence: StandaloneHomePersistence;
  readonly supervisor?: AppSupervisor;
  readonly liveService?: LiveService;
  readonly startLocalApp: (appId: string) => Promise<void>;
  readonly stopLocalApp: (appId: string) => Promise<void>;
  readonly operateLocalApp: (
    appId: string,
    operation: AppOperation,
    options?: Record<string, unknown>,
  ) => Promise<AppOperationResult>;
  readonly reloadHomeSnapshot: () => Promise<void>;
}

/**
 * Integrates StandaloneHomeService and StandaloneAppManager with cluster single-active leases,
 * encrypted standby replication, and transparent peer command forwarding.
 */
export class HomeClusterCoordinator {
  private syncTimer?: NodeJS.Timeout;
  private cacheSyncTimer?: NodeJS.Timeout;
  private unsubscribeSnapshot?: () => void;
  private bindings?: HomeAppClusterBindings;
  private destroyed = false;

  constructor(
    private readonly leaseService?: ClusterLeaseService,
    private readonly syncService?: ClusterSyncService,
    private readonly orchestrator?: ClusterOrchestrator,
  ) {}

  attachBindings(bindings: HomeAppClusterBindings): void {
    this.bindings = bindings;
    if (this.syncService && !this.unsubscribeSnapshot) {
      this.unsubscribeSnapshot = this.syncService.onSnapshotApplied(async () => {
        if (this.destroyed) return;
        await this.bindings?.reloadHomeSnapshot();
        await this.reconcileAppsWithLeases();
      });
    }
  }

  dispose(): void {
    this.destroyed = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }
    if (this.cacheSyncTimer) {
      clearTimeout(this.cacheSyncTimer);
      this.cacheSyncTimer = undefined;
    }
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = undefined;
  }

  scheduleConfigSync(resourceId = 'home'): void {
    if (this.destroyed || !this.syncService || this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      if (this.destroyed) return;
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange('config', resourceId)
        .catch(() => undefined);
    }, 100);
    this.syncTimer.unref();
  }

  scheduleCacheSync(resourceId = 'endpoint_states'): void {
    if (this.destroyed || !this.syncService || this.cacheSyncTimer) return;
    this.cacheSyncTimer = setTimeout(() => {
      this.cacheSyncTimer = undefined;
      if (this.destroyed) return;
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange('cache', resourceId)
        .catch(() => undefined);
    }, 1000);
    this.cacheSyncTimer.unref();
  }

  registerAppController(entry: InstalledAppEntry): void {
    if (!this.leaseService || !this.bindings) return;
    const appId = entry.manifest.id;
    const workloadId = `app:${appId}`;
    const bindings = this.bindings;

    this.leaseService.registerWorkloadController(workloadId, {
      kind: 'app',
      name: entry.manifest.name,
      requirements: deriveRequirementsFromWorkloadMeta({
        kind: 'app',
        id: appId,
        name: entry.manifest.name,
      }),
      getLocalStatus: () =>
        bindings.installedApps.get(appId)?.state === 'running' ? 'running' : 'stopped',
      startLocal: async () => {
        await bindings.startLocalApp(appId);
      },
      stopLocal: async () => {
        await bindings.stopLocalApp(appId);
      },
      executeRemote: async (action, payload) => {
        if (action === 'execute_app') {
          const appAction = (payload?.action as AppAction | undefined) ?? 'restart';
          if (appAction === 'start') await bindings.startLocalApp(appId);
          else if (appAction === 'stop') await bindings.stopLocalApp(appId);
          else {
            await bindings.stopLocalApp(appId);
            await bindings.startLocalApp(appId);
          }
          return { executed: true, action: appAction };
        }
        if (action === 'operate_app') {
          const op = (payload?.operation as AppOperation | undefined) ?? 'configure';
          return bindings.operateLocalApp(
            appId,
            op,
            payload?.options as Record<string, unknown> | undefined,
          );
        }
        return { ignored: true };
      },
    });
  }

  async ensureAllAppsTracked(entries: Iterable<InstalledAppEntry>): Promise<{
    readonly runnableIds: Set<string>;
    readonly parkedIds: Set<string>;
  }> {
    const runnableIds = new Set<string>();
    const parkedIds = new Set<string>();

    for (const entry of entries) {
      const appId = entry.manifest.id;
      const workloadId = `app:${appId}`;
      this.registerAppController(entry);
      if (this.leaseService) {
        await this.leaseService.ensureLocalOwnership({
          workloadId,
          kind: 'app',
          name: entry.manifest.name,
          requirements: deriveRequirementsFromWorkloadMeta({
            kind: 'app',
            id: appId,
            name: entry.manifest.name,
          }),
          active: entry.state === 'running',
        });
        if (!this.leaseService.shouldRunLocally(workloadId)) {
          entry.state = 'stopped';
          entry.containerId = undefined;
          parkedIds.add(appId);
          continue;
        }
      }
      runnableIds.add(appId);
    }

    return { runnableIds, parkedIds };
  }

  canExecuteAppLocally(appId: string): boolean {
    if (!this.leaseService) return true;
    const workloadId = `app:${appId}`;
    const existing = this.leaseService
      .listDecodedWorkloads()
      .find((w) => w.workloadId === workloadId);
    if (!existing) return true;
    return this.leaseService.shouldRunLocally(workloadId) || !this.orchestrator;
  }

  async forwardAppExecution(appId: string, action: AppAction): Promise<boolean> {
    if (!this.leaseService || !this.orchestrator) return false;
    const workloadId = `app:${appId}`;
    const wl = this.leaseService.listDecodedWorkloads().find((w) => w.workloadId === workloadId);
    if (!wl || this.leaseService.shouldRunLocally(workloadId)) return false;
    await this.orchestrator.forwardWorkloadCommand(workloadId, 'execute_app', { action });
    return true;
  }

  async forwardAppOperation(
    appId: string,
    operation: AppOperation,
    options?: Record<string, unknown>,
  ): Promise<AppOperationResult | undefined> {
    if (!this.leaseService || !this.orchestrator) return undefined;
    const workloadId = `app:${appId}`;
    const wl = this.leaseService.listDecodedWorkloads().find((w) => w.workloadId === workloadId);
    if (!wl || this.leaseService.shouldRunLocally(workloadId)) return undefined;
    return (await this.orchestrator.forwardWorkloadCommand(workloadId, 'operate_app', {
      operation,
      options,
    })) as AppOperationResult;
  }

  async reconcileAppsWithLeases(): Promise<void> {
    if (!this.bindings || !this.leaseService) return;
    for (const [appId, entry] of this.bindings.installedApps) {
      const workloadId = `app:${appId}`;
      this.registerAppController(entry);
      const localShouldRun = this.leaseService.shouldRunLocally(workloadId);
      if (!localShouldRun && entry.state === 'running') {
        await this.bindings.stopLocalApp(appId).catch(() => undefined);
      } else if (localShouldRun && entry.state !== 'running') {
        const wl = this.leaseService
          .listDecodedWorkloads()
          .find((w) => w.workloadId === workloadId);
        if (wl?.state === 'active') {
          await this.bindings.startLocalApp(appId).catch(() => undefined);
        }
      }
    }
    this.bindings.liveService?.publish('apps');
  }

  resolveDeviceOwnerWorkloadId(device: HausDevice, endpointId: string): string | undefined {
    const ep = device.endpoints.find((item) => item.id === endpointId);
    const owner = ep?.sourceOwner ?? device.sourceRefs?.[0];
    const ownerDomain = owner && 'domain' in owner ? owner.domain : undefined;
    if (ownerDomain === 'tuya' && owner?.externalId) {
      return `integration:tuya:${owner.externalId}`;
    }
    if (
      owner?.externalId &&
      this.leaseService
        ?.listDecodedWorkloads()
        .some((w) => w.workloadId === `integration:${owner.externalId}`)
    ) {
      return `integration:${owner.externalId}`;
    }
    if (owner?.externalId) {
      const appCandidate = `app:${owner.externalId}`;
      if (this.leaseService?.listDecodedWorkloads().some((w) => w.workloadId === appCandidate)) {
        return appCandidate;
      }
    }
    return undefined;
  }

  async forwardDeviceCommand(
    device: HausDevice,
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.orchestrator || !this.leaseService) return false;
    const workloadId = this.resolveDeviceOwnerWorkloadId(device, endpointId);
    if (!workloadId || this.leaseService.shouldRunLocally(workloadId)) {
      return false;
    }
    await this.orchestrator.forwardWorkloadCommand(workloadId, 'execute_device_command', {
      endpointId,
      capability,
      command,
      parameters,
    });
    return true;
  }
}

export function attachHomeAppCoordinator(params: {
  readonly coordinator: HomeClusterCoordinator;
  readonly installedApps: Map<string, InstalledAppEntry>;
  readonly apps: Apps;
  readonly persistence: StandaloneHomePersistence;
  readonly supervisor?: AppSupervisor;
  readonly liveService?: LiveService;
  readonly operateApp: (
    appId: string,
    op: AppOperation,
    opt?: Record<string, unknown>,
  ) => Promise<AppOperationResult>;
  readonly reloadHomeSnapshot: () => Promise<void>;
}): void {
  params.coordinator.attachBindings({
    installedApps: params.installedApps,
    apps: params.apps,
    persistence: params.persistence,
    supervisor: params.supervisor,
    liveService: params.liveService,
    operateLocalApp: (_appId, op, options) => params.operateApp(_appId, op, options),
    reloadHomeSnapshot: params.reloadHomeSnapshot,
    startLocalApp: async (appId) => {
      const inv = await params.apps.list('cluster');
      const match = inv.apps.find((a) => a.id === appId || a.source.externalId === appId);
      if (!match) return;
      await params.apps.execute('cluster', match.id, 'start');
      const entry = params.installedApps.get(match.source.externalId);
      if (entry) await params.persistence.save('app', match.source.externalId, entry);
      params.liveService?.publish('apps');
    },
    stopLocalApp: async (appId) => {
      const entry = params.installedApps.get(appId);
      const inv = await params.apps.list('cluster').catch(() => undefined);
      const match = inv?.apps.find((a) => a.id === appId || a.source.externalId === appId);
      if (match) await params.apps.execute('cluster', match.id, 'stop').catch(() => undefined);
      if (entry) {
        entry.state = 'stopped';
        entry.containerId = undefined;
        await params.persistence.save('app', appId, entry);
      }
      params.liveService?.publish('apps');
    },
  });
}
