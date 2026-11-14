/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Apps, AppOperation, AppOperationResult } from '@haus/apps';
import type {
  AtomicRoomMoveCoordinator,
  DeviceRegistry,
  HausAutomationRule,
  HausScene,
  HausScript,
  NotificationActionPayload,
  Room,
} from '@haus/core';
import type { LiveService } from '../live/types.js';
import type { StatsCollector } from '../stats/stats.collector.js';
import type { InstalledAppEntry } from './app-driver.js';
import {
  attachHomeAppCoordinator,
  loadAndApplyHomeSnapshot,
  type HomeClusterCoordinator,
  type HomeSnapshotApplyTargets,
} from './cluster-apps.js';
import { createHomeRulesRuntime } from './home-rules.js';
import { HomeRoomsManager } from './rooms.js';
import type { StandaloneHomePersistence } from './home.persistence.js';
import type { AppSupervisor } from './supervisor.js';

export interface HomeWiringDeps {
  readonly devices: DeviceRegistry;
  readonly roomCoordinator: AtomicRoomMoveCoordinator;
  readonly rooms: Map<string, Room>;
  readonly endpointStates: Map<string, Record<string, unknown>>;
  readonly scenes: Map<string, HausScene>;
  readonly scripts: Map<string, HausScript>;
  readonly automations: Map<string, HausAutomationRule>;
  readonly installedApps: Map<string, InstalledAppEntry>;
  readonly notifications: NotificationActionPayload[];
  readonly persistence: StandaloneHomePersistence;
  readonly statsCollector?: StatsCollector;
  readonly liveService?: LiveService;
  readonly apps: Apps;
  readonly appSupervisor: AppSupervisor;
  readonly clusterCoordinator: HomeClusterCoordinator;
  readonly resolveEndpointId: (id: string) => string;
  readonly getEndpointProperty: (epId: string, prop: string) => unknown;
  readonly executeDeviceCommand: (
    id: string,
    cap: string,
    cmd: string,
    params?: Record<string, unknown>,
    dispatch?: boolean,
  ) => Promise<unknown>;
  readonly activateScene: (id: string, sig?: AbortSignal) => Promise<unknown>;
  readonly executeScript: (id: string, sig?: AbortSignal) => Promise<unknown>;
  readonly operateApp: (
    appId: string,
    op: AppOperation,
    opts?: Record<string, unknown>,
  ) => Promise<AppOperationResult>;
  readonly registerAlias: (alias: string, canonicalId: string) => Promise<void>;
  readonly publishDevices: () => void;
}

export function initializeHomeRulesAndCluster(deps: HomeWiringDeps) {
  const runtime = createHomeRulesRuntime(
    {
      getEndpointState: deps.getEndpointProperty,
      executeDeviceCommand: (id, cap, cmd, p) =>
        deps.executeDeviceCommand(id, cap, cmd, p, false).then(() => undefined),
      activateScene: (id, sig) => deps.activateScene(id, sig).then(() => undefined),
      callScript: (id, _p, sig) => deps.executeScript(id, sig).then(() => undefined),
      sendNotification: async (payload) => {
        deps.notifications.push(payload);
      },
      now: () => new Date(),
    },
    {
      scenes: deps.scenes,
      scripts: deps.scripts,
      automations: deps.automations,
      roomCoordinator: deps.roomCoordinator,
      persistence: deps.persistence,
      resolveEndpointId: deps.resolveEndpointId,
      getStatsCollector: () => deps.statsCollector,
      liveService: deps.liveService,
      onConfigChanged: (resourceId) => deps.clusterCoordinator.scheduleConfigSync(resourceId),
    },
  );
  const roomManager = new HomeRoomsManager({
    rooms: deps.rooms,
    devices: deps.devices,
    roomCoordinator: deps.roomCoordinator,
    persistence: deps.persistence,
    scenes: deps.scenes,
    scripts: deps.scripts,
    automations: deps.automations,
    onAutomationUpdated: (rule) => runtime.automationEngine.updateRule(rule),
    publishDevices: deps.publishDevices,
    registerAlias: deps.registerAlias,
    liveService: deps.liveService,
    onConfigChanged: (resourceId) => deps.clusterCoordinator.scheduleConfigSync(resourceId),
  });
  const snapshotTargets = (): HomeSnapshotApplyTargets => ({
    devices: deps.devices,
    roomCoordinator: deps.roomCoordinator,
    rooms: deps.rooms,
    endpointStates: deps.endpointStates,
    scenes: deps.scenes,
    scripts: deps.scripts,
    automations: deps.automations,
    automationEngine: runtime.automationEngine,
    installedApps: deps.installedApps,
  });
  attachHomeAppCoordinator({
    coordinator: deps.clusterCoordinator,
    installedApps: deps.installedApps,
    apps: deps.apps,
    persistence: deps.persistence,
    supervisor: deps.appSupervisor,
    liveService: deps.liveService,
    operateApp: deps.operateApp,
    reloadHomeSnapshot: async () => {
      await loadAndApplyHomeSnapshot(deps.persistence, snapshotTargets());
      deps.publishDevices();
    },
  });
  return {
    ...runtime,
    roomManager,
    loadAndApply: () => loadAndApplyHomeSnapshot(deps.persistence, snapshotTargets()),
  };
}
