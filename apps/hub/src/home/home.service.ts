/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import {
  Apps,
  type AppAction,
  type AppInfo,
  type AppInventory,
  type AppManifest,
  type AppOperation,
  type AppOperationResult,
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

export type DeviceCommandHandler = (
  endpointId: string,
  capability: string,
  command: string,
  parameters?: Record<string, unknown>,
) => Promise<void> | void;

export const STANDALONE_HOME_SERVICE = 'STANDALONE_HOME_SERVICE';

@Injectable()
export class StandaloneHomeService implements OnModuleInit {
  public readonly devices = new DeviceRegistry();
  public readonly actionQueue = new EntityActionQueue({ maxDepthPerEntity: 64 });
  public readonly roomMoveRepo = new InMemoryRoomMoveRepository();
  public readonly roomCoordinator = new AtomicRoomMoveCoordinator('haus-home', this.roomMoveRepo);
  private readonly persistence: StandaloneHomePersistence;
  private readonly endpointStates = new Map<string, Record<string, unknown>>();
  private readonly scenes = new Map<string, HausScene>();
  private readonly scripts = new Map<string, HausScript>();
  private readonly automations = new Map<string, HausAutomationRule>();
  private readonly notifications: NotificationActionPayload[] = [];
  private readonly installedApps = new Map<string, InstalledAppEntry>();
  private readonly identityMap = new Map<string, string>();
  private readonly identities = new Identities(
    {
      get: (source) => this.identityMap.get(`${source.instanceId}:${source.externalId}`),
      putIfAbsent: (source, proposedId) => {
        const key = `${source.instanceId}:${source.externalId}`;
        const existing = this.identityMap.get(key);
        if (existing) return existing;
        this.identityMap.set(key, proposedId);
        return proposedId;
      },
    },
    () => `app-${randomUUID()}`,
  );
  public readonly apps: Apps;
  public readonly automationExecutor: AutomationExecutor;
  public readonly automationEngine: LocalAutomationEngine;
  private readonly appManager: StandaloneAppManager;
  private readonly commandHandlers = new Map<string, DeviceCommandHandler>();

  constructor(
    @Optional() @Inject(LIVE_SERVICE) private readonly liveService?: LiveService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
  ) {
    this.persistence = new StandaloneHomePersistence(transactions);
    const env: AutomationExecutorEnvironment = {
      getEndpointState: (epId, prop) => this.getEndpointProperty(epId, prop),
      executeDeviceCommand: async (epId, cap, cmd, params) => {
        await this.executeDeviceCommand(epId, cap, cmd, params, false);
      },
      activateScene: async (sceneId, signal) => {
        await this.activateScene(sceneId, signal);
      },
      callScript: async (scriptId, _params, signal) => {
        await this.executeScript(scriptId, signal);
      },
      sendNotification: async (payload) => {
        this.notifications.push(payload);
      },
      now: () => new Date(),
    };
    this.automationExecutor = new AutomationExecutor(env);
    this.automationEngine = new LocalAutomationEngine(env);
    const { apps, appManager } = createStandaloneAppManager(
      this.installedApps,
      this.identities,
      this.persistence,
      this.liveService,
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
  }

  private resolveEndpointId(ref: string): string {
    if (this.endpointStates.has(ref)) {
      return ref;
    }
    const resolved = this.roomCoordinator.resolveAddressOrId(ref) ?? ref;
    if (this.endpointStates.has(resolved)) {
      return resolved;
    }
    const dev = this.devices.getDevice(resolved);
    if (dev?.endpoints?.[0]?.id) {
      return dev.endpoints[0].id;
    }
    return resolved;
  }

  registerDevice(device: HausDevice): HausDevice {
    const normalized = this.devices.registerDevice(device);
    void this.roomCoordinator.registerDevice(normalized).catch((err: unknown) => {
      console.warn('Room coordinator device registration warning:', err);
    });
    for (const ep of normalized.endpoints ?? []) {
      const state: Record<string, unknown> = this.endpointStates.get(ep.id) ?? {};
      const readings = ep.readings as unknown;
      if (Array.isArray(readings)) {
        for (const r of readings as Array<{ capabilityId?: string; value?: unknown }>) {
          if (r?.capabilityId) state[r.capabilityId] = r.value;
        }
      } else if (readings && typeof readings === 'object') {
        for (const [key, reading] of Object.entries(
          readings as Record<string, { value?: unknown }>,
        )) {
          state[key] =
            reading && typeof reading === 'object' && 'value' in reading ? reading.value : reading;
        }
      }
      this.endpointStates.set(ep.id, state);
      void this.persistence.save('endpoint_state', ep.id, state);
    }
    void this.persistence.save('device', normalized.id, normalized);
    this.liveService?.publish('devices');
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
    for (const sceneId of patch.updatedSceneIds) {
      const scene = this.roomCoordinator.getScene(sceneId);
      if (scene) {
        this.scenes.set(sceneId, scene);
        await this.persistence.save('scene', sceneId, scene);
      }
    }
    for (const scriptId of patch.updatedScriptIds) {
      const script = this.roomCoordinator.getScript(scriptId);
      if (script) {
        this.scripts.set(scriptId, script);
        await this.persistence.save('script', scriptId, script);
      }
    }
    for (const ruleId of patch.updatedAutomationIds) {
      const rule = this.roomCoordinator.getAutomation(ruleId);
      if (rule) {
        this.automations.set(ruleId, rule);
        this.automationEngine.updateRule(rule);
        await this.persistence.save('automation', ruleId, rule);
      }
    }
    this.liveService?.publish('devices');
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

  getEndpointState(endpointId: string): Record<string, unknown> {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    return { ...this.endpointStates.get(canonicalEpId) };
  }

  getEndpointProperty(endpointId: string, property: string): unknown {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    const state = this.endpointStates.get(canonicalEpId);
    if (!state) return undefined;
    if (property in state) return state[property];
    return state.state ?? state.value;
  }

  registerCommandHandler(protocol: string, handler: DeviceCommandHandler): () => void {
    this.commandHandlers.set(protocol, handler);
    return () => {
      if (this.commandHandlers.get(protocol) === handler) {
        this.commandHandlers.delete(protocol);
      }
    };
  }

  async updateEndpointState(
    endpointId: string,
    patch: Record<string, unknown>,
    dispatchTriggers = true,
  ): Promise<void> {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    await this.actionQueue.run(canonicalEpId, async () => {
      const current = { ...this.endpointStates.get(canonicalEpId), ...patch };
      this.endpointStates.set(canonicalEpId, current);
      await this.persistence.save('endpoint_state', canonicalEpId, current);
      this.liveService?.publish('devices');

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
  ): Promise<{
    receiptId: string;
    endpointId: string;
    capability: string;
    command: string;
    state: Record<string, unknown>;
    triggeredExecutions: readonly ExecutionHistoryRecord[];
  }> {
    const canonicalEpId = this.resolveEndpointId(endpointId);
    return this.actionQueue.run(canonicalEpId, async () => {
      const current = { ...this.endpointStates.get(canonicalEpId) };
      const previousValue = current[capability] ?? current.state;

      let nextValue: unknown = parameters?.value;
      if (command === 'turn_on') {
        nextValue = true;
        current.state = 'on';
        current.on_off = true;
      } else if (command === 'turn_off') {
        nextValue = false;
        current.state = 'off';
        current.on_off = false;
      } else if (command === 'toggle') {
        const nextBool = !(current.on_off ?? current.state === 'on');
        nextValue = nextBool;
        current.state = nextBool ? 'on' : 'off';
        current.on_off = nextBool;
      }

      if (nextValue !== undefined) {
        current[capability] = nextValue;
      }
      if (parameters) {
        for (const [key, val] of Object.entries(parameters)) {
          if (key !== 'value') current[key] = val;
        }
      }

      this.endpointStates.set(canonicalEpId, current);
      await this.persistence.save('endpoint_state', canonicalEpId, current);
      this.liveService?.publish('devices');

      const dev = this.devices.listDevices().find((d) =>
        d.endpoints?.some((ep) => ep.id === canonicalEpId),
      );
      const protocol = dev?.sourceRefs?.[0]?.protocol ?? dev?.services?.[0]?.sourceRefs?.[0]?.protocol;
      if (protocol && this.commandHandlers.has(protocol)) {
        await this.commandHandlers.get(protocol)!(
          canonicalEpId,
          capability,
          command,
          parameters,
        );
      }

      let triggeredExecutions: readonly ExecutionHistoryRecord[] = [];
      if (dispatchTriggers) {
        const event: TriggerEvent = {
          type: 'state',
          endpointId: canonicalEpId,
          property: capability,
          from: previousValue,
          to: current[capability],
        };
        triggeredExecutions = await this.dispatchAutomationEvent(event);
      }

      return {
        receiptId: `rcpt-${randomUUID()}`,
        endpointId: canonicalEpId,
        capability,
        command,
        state: { ...current },
        triggeredExecutions,
      };
    });
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
    if (!scene) {
      throw new Error('scene_not_found');
    }
    const record = await this.automationExecutor.executeScene(scene, signal);
    this.liveService?.publish('scenes');
    return record;
  }

  registerScript(script: HausScript): HausScript {
    const normalized: HausScript = {
      ...script,
      steps: normalizeSteps(script.steps),
    };
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
    if (!script) {
      throw new Error('script_not_found');
    }
    return this.automationExecutor.executeScript(script, signal);
  }

  registerAutomation(rule: HausAutomationRule): HausAutomationRule {
    const normalized: HausAutomationRule = {
      ...rule,
      actions: normalizeSteps(rule.actions),
    };
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
    for (const record of records) {
      this.automationExecutor.history.record(record);
    }
    return records;
  }

  listExecutionHistory(sourceId?: string): readonly ExecutionHistoryRecord[] {
    return this.automationExecutor.history.list(sourceId);
  }

  listNotifications(): readonly NotificationActionPayload[] {
    return [...this.notifications];
  }

  async installApp(
    actorId: string,
    manifest: AppManifest,
    grantedPermissions: readonly AppPermissionType[] = [],
    config?: Record<string, unknown>,
  ): Promise<{ appId: string; manifest: AppManifest }> {
    return this.appManager.installApp(actorId, manifest, grantedPermissions, config);
  }

  async listApps(actorId: string, signal?: AbortSignal): Promise<AppInventory> {
    return this.appManager.listApps(actorId, signal);
  }

  async executeApp(
    actorId: string,
    appId: string,
    action: AppAction,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.appManager.executeApp(actorId, appId, action, signal);
  }

  async inspectApp(
    actorId: string,
    appId: string,
    signal?: AbortSignal,
  ): Promise<AppOperationResult<AppInfo>> {
    return this.appManager.inspectApp(actorId, appId, signal);
  }

  async operateApp(
    actorId: string,
    appId: string,
    operation: AppOperation,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppOperationResult> {
    return this.appManager.operateApp(actorId, appId, operation, options, signal);
  }
}
