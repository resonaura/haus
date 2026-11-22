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
import type { RemoteForwardResult } from './commands.js';
import { applyHomeSnapshot, type StandaloneHomePersistence } from './home.persistence.js';
import type { AppSupervisor } from './supervisor.js';

export type HomeSnapshotApplyTargets = Parameters<typeof applyHomeSnapshot>[1];

export async function loadAndApplyHomeSnapshot(
  persistence: StandaloneHomePersistence,
  targets: HomeSnapshotApplyTargets,
  options?: { readonly pruneMissing?: boolean },
) {
  const snapshot = await persistence.load();
  await applyHomeSnapshot(snapshot, targets, options);
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
  readonly reloadEndpointStates?: () => Promise<void>;
}

/**
 * Integrates StandaloneHomeService and StandaloneAppManager with cluster single-active leases,
 * encrypted standby replication, and transparent peer command forwarding.
 */
export class HomeClusterCoordinator {
  private syncTimer?: NodeJS.Timeout;
  private bgConfigSyncTimer?: NodeJS.Timeout;
  private cacheSyncTimer?: NodeJS.Timeout;
  private unsubscribeSnapshot?: () => void;
  private bindings?: HomeAppClusterBindings;
  private destroyed = false;
  private applyingSnapshot = false;

  constructor(
    private readonly leaseService?: ClusterLeaseService,
    private readonly syncService?: ClusterSyncService,
    private readonly orchestrator?: ClusterOrchestrator,
  ) {}

  attachBindings(bindings: HomeAppClusterBindings): void {
    this.bindings = bindings;
    if (this.syncService && !this.unsubscribeSnapshot) {
      this.unsubscribeSnapshot = this.syncService.onSnapshotApplied(async (appliedKinds) => {
        if (this.destroyed) return;
        this.applyingSnapshot = true;
        try {
          const configOrCredChanged = appliedKinds.has('config') || appliedKinds.has('credential');
          if (
            !configOrCredChanged &&
            appliedKinds.has('cache') &&
            this.bindings?.reloadEndpointStates
          ) {
            await this.bindings.reloadEndpointStates();
          } else {
            await this.bindings?.reloadHomeSnapshot();
            await this.reconcileAppsWithLeases();
          }
        } finally {
          this.applyingSnapshot = false;
        }
      });
    }
  }

  dispose(): void {
    this.destroyed = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }
    if (this.bgConfigSyncTimer) {
      clearTimeout(this.bgConfigSyncTimer);
      this.bgConfigSyncTimer = undefined;
    }
    if (this.cacheSyncTimer) {
      clearTimeout(this.cacheSyncTimer);
      this.cacheSyncTimer = undefined;
    }
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = undefined;
  }

  scheduleConfigSync(resourceId = 'home'): void {
    if (this.destroyed || this.applyingSnapshot || !this.syncService || this.syncTimer) return;
    if (this.bgConfigSyncTimer) {
      clearTimeout(this.bgConfigSyncTimer);
      this.bgConfigSyncTimer = undefined;
    }
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      if (this.destroyed || this.applyingSnapshot) return;
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange('config', resourceId)
        .catch(() => undefined);
    }, 250);
    this.syncTimer.unref();
  }

  scheduleBackgroundConfigSync(resourceId = 'home'): void {
    if (
      this.destroyed ||
      this.applyingSnapshot ||
      !this.syncService ||
      this.syncTimer ||
      this.bgConfigSyncTimer
    ) {
      return;
    }
    this.bgConfigSyncTimer = setTimeout(() => {
      this.bgConfigSyncTimer = undefined;
      if (this.destroyed || this.applyingSnapshot) return;
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange('config', resourceId)
        .catch(() => undefined);
    }, 5_000);
    this.bgConfigSyncTimer.unref();
  }

  scheduleDeviceSync(previous: HausDevice | undefined, next: HausDevice): void {
    const sameStructure =
      previous !== undefined &&
      previous.name === next.name &&
      previous.areaId === next.areaId &&
      previous.roomId === next.roomId &&
      previous.category === next.category &&
      previous.endpoints.length === next.endpoints.length &&
      previous.endpoints.every(
        (ep, idx) => ep.id === next.endpoints[idx]?.id && ep.name === next.endpoints[idx]?.name,
      );
    if (sameStructure) {
      this.scheduleBackgroundConfigSync(`device:${next.id}`);
    } else {
      this.scheduleConfigSync(`device:${next.id}`);
    }
  }

  scheduleCacheSync(resourceId = 'endpoint_states'): void {
    if (this.destroyed || this.applyingSnapshot || !this.syncService || this.cacheSyncTimer) return;
    this.cacheSyncTimer = setTimeout(() => {
      this.cacheSyncTimer = undefined;
      if (this.destroyed || this.applyingSnapshot) return;
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange('cache', resourceId)
        .catch(() => undefined);
    }, 5_000);
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
    if (!this.leaseService.hasWorkload(workloadId)) return true;
    return this.leaseService.shouldRunLocally(workloadId) || !this.orchestrator;
  }

  async forwardAppExecution(appId: string, action: AppAction): Promise<boolean> {
    if (!this.leaseService || !this.orchestrator) return false;
    const workloadId = `app:${appId}`;
    if (
      !this.leaseService.hasWorkload(workloadId) ||
      this.leaseService.shouldRunLocally(workloadId)
    ) {
      return false;
    }
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
    if (
      !this.leaseService.hasWorkload(workloadId) ||
      this.leaseService.shouldRunLocally(workloadId)
    ) {
      return undefined;
    }
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
        const wl = this.leaseService.getWorkloadRow(workloadId);
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
    if (owner?.externalId && this.leaseService?.hasWorkload(`integration:${owner.externalId}`)) {
      return `integration:${owner.externalId}`;
    }
    if (owner?.externalId && this.leaseService?.hasWorkload(`app:${owner.externalId}`)) {
      return `app:${owner.externalId}`;
    }
    return undefined;
  }

  async forwardDeviceCommand(
    device: HausDevice,
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<RemoteForwardResult> {
    if (!this.orchestrator || !this.leaseService) return { forwarded: false };
    const workloadId = this.resolveDeviceOwnerWorkloadId(device, endpointId);
    if (!workloadId || this.leaseService.shouldRunLocally(workloadId)) {
      return { forwarded: false };
    }
    const result = await this.orchestrator.forwardWorkloadCommand(
      workloadId,
      'execute_device_command',
      { endpointId, capability, command, parameters },
    );
    const state =
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      'state' in result &&
      result.state &&
      typeof result.state === 'object' &&
      !Array.isArray(result.state)
        ? (result.state as Record<string, unknown>)
        : undefined;
    return { forwarded: true, ...(state ? { state } : {}) };
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
  readonly reloadEndpointStates?: () => Promise<void>;
}): void {
  params.coordinator.attachBindings({
    installedApps: params.installedApps,
    apps: params.apps,
    persistence: params.persistence,
    supervisor: params.supervisor,
    liveService: params.liveService,
    operateLocalApp: (_appId, op, options) => params.operateApp(_appId, op, options),
    reloadHomeSnapshot: params.reloadHomeSnapshot,
    reloadEndpointStates: params.reloadEndpointStates,
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
        await params.persistence.save('app', appId, entry);
      }
      params.liveService?.publish('apps');
    },
  });
}
