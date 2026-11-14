/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { acceptsReading, EndpointReadings, findEndpointDevice } from './readings.js';
import type { HomeRoomsManager } from './rooms.js';
import type { HomeRulesManager } from './home-rules.js';
import { HomeStatsTracker, type EndpointHistoryEntry } from './home-stats.js';
import { STATS_COLLECTOR } from '../stats/tokens.js';
import type { StatsCollector } from '../stats/stats.collector.js';
import {
  AtomicRoomMoveCoordinator,
  type AutomationExecutor,
  DeviceRegistry,
  EntityActionQueue,
  InMemoryRoomMoveRepository,
  type LocalAutomationEngine,
  type HausAutomationRule,
  type HausDevice,
  type HausScene,
  type HausScript,
  type NotificationActionPayload,
  type Room,
  type RoomMoveClientPatch,
  type RoomMoveRequest,
  type TriggerEvent,
} from '@haus/core';
import {
  HomeCommands,
  type DeviceCommandHandler,
  type DeviceCommandHandlerOptions,
  type DeviceCommandReceipt,
} from './commands.js';
import {
  Apps,
  type AppAction,
  type AppCatalogFilter,
  type AppManifest,
  type AppOperation,
  type AppPermissionType,
} from '@haus/apps';
import { LIVE_SERVICE } from '../live/tokens.js';
import type { LiveService } from '../live/types.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import type { StandaloneAppManager, InstalledAppEntry } from './app-driver.js';
import { createStandaloneAppManager } from './app-factory.js';
import { StandaloneHomePersistence, createAppIdentities } from './home.persistence.js';
import { AppSupervisor, type AppSupervisorOptions } from './supervisor.js';
import { ClusterLeaseService } from '../cluster/coordination/leases.js';
import { ClusterOrchestrator } from '../cluster/coordination/orchestrator.js';
import { ClusterSyncService } from '../cluster/sync/service.js';
import { HomeClusterCoordinator } from './cluster-apps.js';
import { initializeHomeRulesAndCluster } from './home-wiring.js';

export const STANDALONE_HOME_SERVICE = 'STANDALONE_HOME_SERVICE';

@Injectable()
export class StandaloneHomeService implements OnModuleInit, OnModuleDestroy {
  public readonly devices = new DeviceRegistry();
  public readonly actionQueue = new EntityActionQueue({ maxDepthPerEntity: 64 });
  public readonly roomMoveRepo = new InMemoryRoomMoveRepository();
  public readonly roomCoordinator = new AtomicRoomMoveCoordinator('haus-home', this.roomMoveRepo);
  public readonly rooms = new Map<string, Room>();
  public readonly roomManager: HomeRoomsManager;
  private readonly persistence: StandaloneHomePersistence;
  private readonly statsTracker: HomeStatsTracker;
  private readonly rulesManager: HomeRulesManager;
  private readonly commands: HomeCommands;
  private readonly endpointStates = new Map<string, Record<string, unknown>>();
  private readonly endpointReadings: EndpointReadings;
  private readonly deviceListeners = new Set<() => void>();
  private readonly scenes = new Map<string, HausScene>();
  private readonly scripts = new Map<string, HausScript>();
  private readonly automations = new Map<string, HausAutomationRule>();
  private readonly notifications: NotificationActionPayload[] = [];
  private readonly installedApps = new Map<string, InstalledAppEntry>();
  private readonly identities = createAppIdentities();
  public readonly apps: Apps;
  public readonly automationExecutor: AutomationExecutor;
  public readonly automationEngine: LocalAutomationEngine;
  public readonly appManager: StandaloneAppManager;
  private readonly appSupervisor = new AppSupervisor();
  private readonly clusterCoordinator: HomeClusterCoordinator;
  private readonly loadAndApplySnapshot: ReturnType<
    typeof initializeHomeRulesAndCluster
  >['loadAndApply'];

  constructor(
    @Optional() @Inject(LIVE_SERVICE) private readonly liveService?: LiveService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(STATS_COLLECTOR) private readonly statsCollector?: StatsCollector,
    @Optional() @Inject(ClusterLeaseService) clusterLeases?: ClusterLeaseService,
    @Optional() @Inject(ClusterSyncService) clusterSync?: ClusterSyncService,
    @Optional() @Inject(ClusterOrchestrator) clusterOrchestrator?: ClusterOrchestrator,
  ) {
    this.clusterCoordinator = new HomeClusterCoordinator(
      clusterLeases,
      clusterSync,
      clusterOrchestrator,
    );
    this.persistence = new StandaloneHomePersistence(transactions);
    this.statsTracker = new HomeStatsTracker({
      listDevices: () => this.devices.listDevices(),
      persistence: this.persistence,
      getCollector: () => this.statsCollector,
    });
    const onStateUpdated = (
      endpointId: string,
      fullState: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => {
      this.statsTracker.recordUpdate(endpointId, fullState, patch);
      this.clusterCoordinator.scheduleCacheSync(`endpoint:${endpointId}`);
    };
    this.endpointReadings = new EndpointReadings(
      this.endpointStates,
      this.persistence,
      onStateUpdated,
    );
    this.commands = new HomeCommands(
      this.devices,
      this.actionQueue,
      this.endpointStates,
      this.persistence,
      (id) => this.resolveEndpointId(id),
      () => this.publishDevices(),
      (event) => this.dispatchAutomationEvent(event),
      onStateUpdated,
      (dev, epId, cap, cmd, params) =>
        this.clusterCoordinator.forwardDeviceCommand(dev, epId, cap, cmd, params),
    );
    const { apps, appManager } = createStandaloneAppManager(
      this.installedApps,
      this.identities,
      this.persistence,
      this.liveService,
      this.appSupervisor,
    );
    this.apps = apps;
    this.appManager = appManager;
    this.appManager.setClusterCoordinator(this.clusterCoordinator);
    const wired = initializeHomeRulesAndCluster({
      devices: this.devices,
      roomCoordinator: this.roomCoordinator,
      rooms: this.rooms,
      endpointStates: this.endpointStates,
      scenes: this.scenes,
      scripts: this.scripts,
      automations: this.automations,
      installedApps: this.installedApps,
      notifications: this.notifications,
      persistence: this.persistence,
      statsCollector: this.statsCollector,
      liveService: this.liveService,
      apps: this.apps,
      appSupervisor: this.appSupervisor,
      clusterCoordinator: this.clusterCoordinator,
      resolveEndpointId: (id) => this.resolveEndpointId(id),
      getEndpointProperty: (epId, prop) => this.getEndpointProperty(epId, prop),
      executeDeviceCommand: (id, cap, cmd, p, d) => this.executeDeviceCommand(id, cap, cmd, p, d),
      activateScene: (id, sig) => this.activateScene(id, sig),
      executeScript: (id, sig) => this.executeScript(id, sig),
      operateApp: (appId, op, opts) => this.operateApp('cluster', appId, op, opts),
      registerAlias: (alias, canonicalId) => this.registerAlias(alias, canonicalId),
      publishDevices: () => this.publishDevices(),
    });
    this.roomManager = wired.roomManager;
    this.automationExecutor = wired.automationExecutor;
    this.automationEngine = wired.automationEngine;
    this.rulesManager = wired.rulesManager;
    this.loadAndApplySnapshot = wired.loadAndApply;
  }

  async onModuleInit(): Promise<void> {
    const snapshot = await this.loadAndApplySnapshot();
    this.statsTracker.seedFromSnapshot(this.endpointStates.entries(), snapshot.endpointHistory);
    await this.clusterCoordinator.ensureAllAppsTracked(this.installedApps.values());
    await this.appManager.restoreSupervisorApps();
  }

  async configureSupervisor(options: AppSupervisorOptions): Promise<void> {
    await this.appManager.configureSupervisor(options);
  }

  handleSupervisorRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    return this.appManager.handleSupervisorRequest(req, res);
  }

  async onModuleDestroy(): Promise<void> {
    this.clusterCoordinator.dispose();
    if (this.publishDevicesTimer) {
      clearTimeout(this.publishDevicesTimer);
      this.publishDevicesTimer = undefined;
    }
    this.persistence.close();
    await this.appManager.close();
  }

  private resolveEndpointId(ref: string): string {
    if (this.endpointStates.has(ref)) return ref;
    const resolved = this.roomCoordinator.resolveAddressOrId(ref) ?? ref;
    if (this.endpointStates.has(resolved)) return resolved;
    const dev = this.devices.getDevice(resolved);
    return dev?.endpoints?.[0]?.id ?? resolved;
  }

  private publishDevicesTimer?: NodeJS.Timeout;

  subscribeDevices(listener: () => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  private publishDevices(): void {
    if (this.publishDevicesTimer) return;
    this.publishDevicesTimer = setTimeout(() => {
      this.publishDevicesTimer = undefined;
      this.liveService?.publish('devices');
      for (const listener of this.deviceListeners) {
        try {
          listener();
        } catch {
          process.emitWarning('home_device_listener_failed');
        }
      }
    }, 25);
    this.publishDevicesTimer.unref();
  }

  removeDevice(deviceId: string): boolean {
    const existing = this.devices.getDevice(deviceId);
    const removed = this.devices.removeDevice(deviceId);
    void this.persistence.remove('device', deviceId);
    for (const ep of existing?.endpoints ?? []) {
      this.endpointReadings.remove(ep.id);
      this.statsTracker.remove(ep.id);
    }
    if (removed) {
      this.publishDevices();
      this.clusterCoordinator.scheduleConfigSync(`device:${deviceId}`);
    }
    return removed;
  }

  getPersistence(): StandaloneHomePersistence {
    return this.persistence;
  }

  registerDevice(device: HausDevice): HausDevice {
    const previous = this.devices.getDevice(device.id);
    const normalized = this.devices.registerDevice(device);
    this.roomManager.ensureRoomForDevice(normalized);
    if (previous && isDeepStrictEqual(previous, normalized)) return normalized;
    this.endpointReadings.replace(previous?.endpoints ?? [], normalized.endpoints);
    void this.roomCoordinator.registerDevice(normalized).catch((err: unknown) => {
      console.warn('Room coordinator device registration warning:', err);
    });
    void this.persistence.save('device', normalized.id, normalized);
    this.clusterCoordinator.scheduleConfigSync(`device:${normalized.id}`);
    this.publishDevices();
    return normalized;
  }

  moveDeviceRoom(request: Omit<RoomMoveRequest, 'homeId'>): Promise<RoomMoveClientPatch> {
    return this.roomManager.moveDeviceRoom(request);
  }

  listDevices(areaId?: string): readonly HausDevice[] {
    return areaId ? this.devices.getDevicesByArea(areaId) : this.devices.listDevices();
  }

  getDevice(deviceId: string): HausDevice | undefined {
    const direct = this.devices.getDevice(deviceId);
    if (direct) return direct;
    const resolved = this.roomCoordinator.resolveAddressOrId(deviceId);
    return resolved ? this.devices.getDevice(resolved) : undefined;
  }

  async registerAlias(alias: string, canonicalId: string): Promise<void> {
    await this.persistence.save('device_alias', alias, { canonicalId });
    await this.roomCoordinator.registerAlias(alias, canonicalId);
    this.clusterCoordinator?.scheduleConfigSync('device_aliases');
  }

  getEndpointState(endpointId: string): Record<string, unknown> {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    return { ...this.endpointStates.get(canonicalEpId) };
  }

  /** Current state of every endpoint, keyed by canonical endpoint id. */
  listEndpointStates(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
      [...this.endpointStates].map(([endpointId, state]) => [endpointId, { ...state }]),
    );
  }

  getEndpointProperty(endpointId: string, property: string): unknown {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    const state = this.endpointStates.get(canonicalEpId);
    if (!state) return undefined;
    if (property in state) return state[property];
    return state.state ?? state.value;
  }

  registerCommandHandler(
    protocol: string | import('@haus/core').SourceServiceRef,
    handler: DeviceCommandHandler,
    options?: DeviceCommandHandlerOptions,
  ): () => void {
    return this.commands.register(protocol, handler, options);
  }

  removeEndpointState(endpointId: string): void {
    this.endpointReadings.remove(endpointId);
    this.statsTracker.remove(endpointId);
  }

  getEndpointHistory(
    endpointIds: readonly string[],
    fromMs: number,
    toMs: number,
  ): Record<string, EndpointHistoryEntry[]> {
    return this.statsTracker.query(
      endpointIds.map((id) => this.resolveEndpointId(id)),
      fromMs,
      toMs,
    );
  }

  async updateEndpointState(
    endpointId: string,
    patch: Record<string, unknown>,
    dispatchTriggers = true,
    source?: import('@haus/core').SourceServiceRef,
  ): Promise<void> {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    await this.actionQueue.run(canonicalEpId, async () => {
      if (!acceptsReading(this.devices.listDevices(), canonicalEpId, source)) return;
      const current = { ...this.endpointStates.get(canonicalEpId), ...patch };
      this.endpointStates.set(canonicalEpId, current);
      void this.persistence.save('endpoint_state', canonicalEpId, current);
      this.statsTracker.recordUpdate(canonicalEpId, current, patch);
      this.clusterCoordinator.scheduleCacheSync(`endpoint:${canonicalEpId}`);
      if (!findEndpointDevice(this.devices.listDevices(), canonicalEpId)) return;
      this.publishDevices();

      if (dispatchTriggers) {
        for (const [prop, val] of Object.entries(patch)) {
          const event: TriggerEvent = {
            type: 'state',
            endpointId: canonicalEpId,
            property: prop,
            to: val,
          };
          await this.dispatchAutomationEvent(event);
        }
      }
    });
  }

  async executeDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
    dispatchTriggers = true,
  ): Promise<DeviceCommandReceipt> {
    return this.commands.execute(endpointId, capability, command, parameters, dispatchTriggers);
  }

  async executeObservedDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<DeviceCommandReceipt> {
    return this.commands.executeObserved(endpointId, capability, command, parameters);
  }

  registerScene(scene: HausScene) {
    return this.rulesManager.registerScene(scene);
  }
  listScenes() {
    return this.rulesManager.listScenes();
  }
  removeScene(sceneId: string) {
    return this.rulesManager.removeScene(sceneId);
  }
  activateScene(sceneId: string, signal?: AbortSignal) {
    return this.rulesManager.activateScene(sceneId, signal);
  }
  registerScript(script: HausScript) {
    return this.rulesManager.registerScript(script);
  }
  listScripts() {
    return this.rulesManager.listScripts();
  }
  removeScript(scriptId: string) {
    return this.rulesManager.removeScript(scriptId);
  }
  executeScript(scriptId: string, signal?: AbortSignal) {
    return this.rulesManager.executeScript(scriptId, signal);
  }
  registerAutomation(rule: HausAutomationRule) {
    return this.rulesManager.registerAutomation(rule);
  }
  listAutomations() {
    return this.rulesManager.listAutomations();
  }
  removeAutomation(ruleId: string) {
    return this.rulesManager.removeAutomation(ruleId);
  }
  triggerAutomation(ruleId: string, signal?: AbortSignal) {
    return this.rulesManager.triggerAutomation(ruleId, signal);
  }
  dispatchAutomationEvent(event: TriggerEvent) {
    return this.rulesManager.dispatchAutomationEvent(event);
  }
  listExecutionHistory(sourceId?: string) {
    return this.rulesManager.listExecutionHistory(sourceId);
  }
  listNotifications(): readonly NotificationActionPayload[] {
    return [...this.notifications];
  }

  installApp(
    actorId: string,
    manifest: AppManifest,
    perms: readonly AppPermissionType[] = [],
    config?: Record<string, unknown>,
  ) {
    return this.appManager.installApp(actorId, manifest, perms, config);
  }

  getAppInstallProgress(id: string) {
    return this.appManager.getInstallProgress(id);
  }

  listApps(actorId: string, signal?: AbortSignal) {
    return this.appManager.listApps(actorId, signal);
  }

  appAccessoryManifest(actorId: string, id: string) {
    return this.appManager.accessoryManifest(actorId, id);
  }

  executeApp(actorId: string, id: string, action: AppAction, sig?: AbortSignal) {
    return this.appManager.executeApp(actorId, id, action, sig);
  }

  inspectApp(actorId: string, id: string, sig?: AbortSignal) {
    return this.appManager.inspectApp(actorId, id, sig);
  }

  operateApp(
    actorId: string,
    id: string,
    op: AppOperation,
    opt?: Record<string, unknown>,
    sig?: AbortSignal,
  ) {
    return this.appManager.operateApp(actorId, id, op, opt, sig);
  }

  listAppCatalog(filter?: AppCatalogFilter) {
    return this.appManager.listCatalog(filter);
  }

  getAppCatalogEntry(id: string) {
    return this.appManager.getCatalogEntry(id);
  }

  listMarketplace(filter?: AppCatalogFilter) {
    return this.appManager.listMarketplace(filter);
  }

  checkAppUpdate(id: string) {
    return this.appManager.checkAppUpdate(id);
  }

  updateApp(actorId: string, id: string, perms?: readonly AppPermissionType[], sig?: AbortSignal) {
    return this.appManager.updateApp(actorId, id, perms, sig);
  }
}
