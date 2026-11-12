/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { acceptsReading, EndpointReadings, findEndpointDevice } from './readings.js';
import {
  AtomicRoomMoveCoordinator,
  AutomationExecutor,
  DeviceRegistry,
  EntityActionQueue,
  Identities,
  InMemoryRoomMoveRepository,
  LocalAutomationEngine,
  type AutomationExecutorEnvironment,
  type ExecutionHistoryRecord,
  type HausAutomationRule,
  type HausDevice,
  type HausScene,
  type HausScript,
  type NotificationActionPayload,
  type RoomMoveClientPatch,
  type RoomMoveRequest,
  type TriggerEvent,
} from '@haus/core';
import { HomeCommands, type DeviceCommandHandler, type DeviceCommandHandlerOptions, type DeviceCommandReceipt } from './commands.js';
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
import {
  createStandaloneAppManager,
  type StandaloneAppManager,
  type InstalledAppEntry,
} from './app-driver.js';
import {
  StandaloneHomePersistence,
  applyHomeSnapshot,
  normalizeScene,
  normalizeSteps,
} from './home.persistence.js';
import { AppSupervisor, type AppSupervisorOptions } from './supervisor.js';

export const STANDALONE_HOME_SERVICE = 'STANDALONE_HOME_SERVICE';

@Injectable()
export class StandaloneHomeService implements OnModuleInit, OnModuleDestroy {
  public readonly devices = new DeviceRegistry();
  public readonly actionQueue = new EntityActionQueue({ maxDepthPerEntity: 64 });
  public readonly roomMoveRepo = new InMemoryRoomMoveRepository();
  public readonly roomCoordinator = new AtomicRoomMoveCoordinator('haus-home', this.roomMoveRepo);
  private readonly persistence: StandaloneHomePersistence;
  private readonly commands: HomeCommands;
  private readonly endpointStates = new Map<string, Record<string, unknown>>();
  private readonly endpointReadings: EndpointReadings;
  private readonly deviceListeners = new Set<() => void>();
  private readonly scenes = new Map<string, HausScene>();
  private readonly scripts = new Map<string, HausScript>();
  private readonly automations = new Map<string, HausAutomationRule>();
  private readonly notifications: NotificationActionPayload[] = [];
  private readonly installedApps = new Map<string, InstalledAppEntry>();
  private readonly identityMap = new Map<string, string>();
  private readonly identities = new Identities(
    {
      get: (s) => this.identityMap.get(`${s.instanceId}:${s.externalId}`),
      putIfAbsent: (s, id) => {
        const k = `${s.instanceId}:${s.externalId}`;
        const ex = this.identityMap.get(k);
        if (ex) return ex;
        this.identityMap.set(k, id);
        return id;
      },
    },
    () => `app-${randomUUID()}`,
  );
  public readonly apps: Apps;
  public readonly automationExecutor: AutomationExecutor;
  public readonly automationEngine: LocalAutomationEngine;
  public readonly appManager: StandaloneAppManager;
  private readonly appSupervisor = new AppSupervisor();

  constructor(
    @Optional() @Inject(LIVE_SERVICE) private readonly liveService?: LiveService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
  ) {
    this.persistence = new StandaloneHomePersistence(transactions);
    this.endpointReadings = new EndpointReadings(this.endpointStates, this.persistence);
    this.commands = new HomeCommands(
      this.devices,
      this.actionQueue,
      this.endpointStates,
      this.persistence,
      (id) => this.resolveEndpointId(id),
      () => this.publishDevices(),
      (event) => this.dispatchAutomationEvent(event),
    );
    const env: AutomationExecutorEnvironment = {
      getEndpointState: (epId, prop) => this.getEndpointProperty(epId, prop),
      executeDeviceCommand: (id, cap, cmd, p) =>
        this.executeDeviceCommand(id, cap, cmd, p, false).then(() => {}),
      activateScene: (id, sig) => this.activateScene(id, sig).then(() => {}),
      callScript: (id, _p, sig) => this.executeScript(id, sig).then(() => {}),
      sendNotification: async (payload) => {
        this.notifications.push(payload);
      },
      now: () => new Date(),
    };
    this.automationExecutor = new AutomationExecutor(env);
    this.automationEngine = new LocalAutomationEngine(env, {
      resolveEndpointId: (id) => this.resolveEndpointId(id),
    });
    const { apps, appManager } = createStandaloneAppManager(
      this.installedApps,
      this.identities,
      this.persistence,
      this.liveService,
      this.appSupervisor,
    );
    this.apps = apps;
    this.appManager = appManager;
  }

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence.load();
    await applyHomeSnapshot(snapshot, {
      devices: this.devices,
      roomCoordinator: this.roomCoordinator,
      endpointStates: this.endpointStates,
      scenes: this.scenes,
      scripts: this.scripts,
      automations: this.automations,
      automationEngine: this.automationEngine,
      installedApps: this.installedApps,
    });
    await this.appManager.restoreSupervisorApps();
  }

  async configureSupervisor(options: AppSupervisorOptions): Promise<void> {
    await this.appManager.configureSupervisor(options);
  }

  handleSupervisorRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    return this.appManager.handleSupervisorRequest(req, res);
  }

  async onModuleDestroy(): Promise<void> {
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
    }
    if (removed) this.publishDevices();
    return removed;
  }

  getPersistence(): StandaloneHomePersistence {
    return this.persistence;
  }

  registerDevice(device: HausDevice): HausDevice {
    const previous = this.devices.getDevice(device.id);
    const normalized = this.devices.registerDevice(device);
    this.endpointReadings.replace(previous?.endpoints ?? [], normalized.endpoints);
    void this.roomCoordinator.registerDevice(normalized).catch((err: unknown) => {
      console.warn('Room coordinator device registration warning:', err);
    });
    void this.persistence.save('device', normalized.id, normalized);
    this.publishDevices();
    return normalized;
  }

  async moveDeviceRoom(request: Omit<RoomMoveRequest, 'homeId'>): Promise<RoomMoveClientPatch> {
    await this.roomCoordinator.registerRoom({
      id: request.targetRoomId,
      name: request.targetRoomId,
    });
    const patch = await this.roomCoordinator.moveDeviceToRoom({
      ...request,
      homeId: 'haus-home',
    });
    const updated = this.roomCoordinator.getDevice(request.deviceId);
    if (updated) {
      this.devices.registerDevice(updated);
      await this.persistence.save('device', updated.id, updated);
    }
    for (const id of patch.updatedSceneIds) {
      const scene = this.roomCoordinator.getScene(id);
      if (scene) {
        this.scenes.set(id, scene);
        await this.persistence.save('scene', id, scene);
      }
    }
    for (const id of patch.updatedScriptIds) {
      const script = this.roomCoordinator.getScript(id);
      if (script) {
        this.scripts.set(id, script);
        await this.persistence.save('script', id, script);
      }
    }
    for (const id of patch.updatedAutomationIds) {
      const rule = this.roomCoordinator.getAutomation(id);
      if (rule) {
        this.automations.set(id, rule);
        this.automationEngine.updateRule(rule);
        await this.persistence.save('automation', id, rule);
      }
    }
    this.publishDevices();
    this.liveService?.publish('scenes');
    return patch;
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
    await this.roomCoordinator.registerAlias(alias, canonicalId);
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

  registerScene(scene: HausScene): HausScene {
    const normalized = normalizeScene(scene);
    this.scenes.set(normalized.id, normalized);
    void this.roomCoordinator.putScene(normalized);
    void this.persistence.save('scene', normalized.id, normalized);
    this.liveService?.publish('scenes');
    return normalized;
  }

  listScenes(): HausScene[] {
    return Array.from(this.scenes.values());
  }

  async activateScene(sceneId: string, signal?: AbortSignal): Promise<ExecutionHistoryRecord> {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error('scene_not_found');
    const record = await this.automationExecutor.executeScene(scene, signal);
    this.liveService?.publish('scenes');
    return record;
  }

  registerScript(script: HausScript): HausScript {
    const normalized: HausScript = { ...script, steps: normalizeSteps(script.steps) };
    this.scripts.set(normalized.id, normalized);
    void this.roomCoordinator.putScript(normalized);
    void this.persistence.save('script', normalized.id, normalized);
    return normalized;
  }

  listScripts(): HausScript[] {
    return Array.from(this.scripts.values());
  }

  async executeScript(scriptId: string, signal?: AbortSignal): Promise<ExecutionHistoryRecord> {
    const script = this.scripts.get(scriptId);
    if (!script) throw new Error('script_not_found');
    return this.automationExecutor.executeScript(script, signal);
  }

  registerAutomation(rule: HausAutomationRule): HausAutomationRule {
    const normalized: HausAutomationRule = { ...rule, actions: normalizeSteps(rule.actions) };
    this.automations.set(normalized.id, normalized);
    void this.roomCoordinator.putAutomation(normalized);
    this.automationEngine.updateRule(normalized);
    void this.persistence.save('automation', normalized.id, normalized);
    return normalized;
  }

  listAutomations(): HausAutomationRule[] {
    return Array.from(this.automations.values());
  }

  removeAutomation(ruleId: string): boolean {
    const existed = this.automations.delete(ruleId);
    void this.roomCoordinator.removeAutomation(ruleId);
    this.automationEngine.unregisterRule(ruleId);
    void this.persistence.remove('automation', ruleId);
    return existed;
  }

  async dispatchAutomationEvent(event: TriggerEvent): Promise<readonly ExecutionHistoryRecord[]> {
    const canonicalEvent: TriggerEvent = event.endpointId
      ? { ...event, endpointId: this.resolveEndpointId(event.endpointId) }
      : event;
    const records = await this.automationEngine.dispatch(canonicalEvent);
    for (const record of records) this.automationExecutor.history.record(record);
    return records;
  }

  listExecutionHistory(sourceId?: string): readonly ExecutionHistoryRecord[] {
    return this.automationExecutor.history.list(sourceId);
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
