/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
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
  assessAppPermissions,
  resolveAppStartupOrder,
  validateAppManifest,
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
import { createStandaloneAppDriver, type InstalledAppEntry } from './app-driver.js';

export const STANDALONE_HOME_SERVICE = 'STANDALONE_HOME_SERVICE';

@Injectable()
export class StandaloneHomeService {
  public readonly devices = new DeviceRegistry();
  public readonly actionQueue = new EntityActionQueue({ maxDepthPerEntity: 64 });
  public readonly roomMoveRepo = new InMemoryRoomMoveRepository();
  public readonly roomCoordinator = new AtomicRoomMoveCoordinator('haus-home', this.roomMoveRepo);
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

  constructor(@Optional() @Inject(LIVE_SERVICE) private readonly liveService?: LiveService) {
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
    this.apps = new Apps(this.identities, {
      authorize: async (actorId) => Boolean(actorId && actorId.trim().length > 0),
    });
    this.apps.register(createStandaloneAppDriver(this.installedApps));
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
    const roomId = normalized.roomId ?? normalized.areaId ?? 'default';
    void this.roomCoordinator
      .registerRoom({ id: roomId, name: roomId })
      .then(() => this.roomCoordinator.registerDevice(normalized));
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
    }
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
    }
    for (const sceneId of patch.updatedSceneIds) {
      const scene = this.roomCoordinator.getScene(sceneId);
      if (scene) this.scenes.set(sceneId, scene);
    }
    for (const scriptId of patch.updatedScriptIds) {
      const script = this.roomCoordinator.getScript(scriptId);
      if (script) this.scripts.set(scriptId, script);
    }
    for (const ruleId of patch.updatedAutomationIds) {
      const rule = this.roomCoordinator.getAutomation(ruleId);
      if (rule) {
        this.automations.set(ruleId, rule);
        this.automationEngine.updateRule(rule);
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
      this.liveService?.publish('devices');

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

  private normalizeScene(scene: HausScene): HausScene {
    const members = (scene.members ?? []).map((member) => {
      const raw = member as object as Record<string, unknown>;
      if (raw.targetState && typeof raw.targetState === 'object') {
        return member;
      }
      const capability = typeof raw.capability === 'string' ? raw.capability : 'state';
      const params = raw.parameters as Record<string, unknown> | undefined;
      const value = params?.value ?? raw.value ?? raw.command;
      return {
        endpointId: String(raw.endpointId ?? ''),
        targetState: { [capability]: value },
      };
    });
    return { ...scene, members };
  }

  private normalizeSteps(steps: readonly unknown[]): HausScript['steps'] {
    return (steps ?? []).map((step) => {
      const raw = step as Record<string, unknown>;
      if (raw.type === 'device_command') {
        return {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: String(raw.endpointId ?? ''),
              capability: String(raw.capability ?? ''),
              command: String(raw.command ?? 'set'),
              parameters:
                raw.parameters && typeof raw.parameters === 'object'
                  ? (raw.parameters as Record<string, unknown>)
                  : undefined,
            },
          },
        };
      }
      return step as HausScript['steps'][number];
    });
  }

  registerScene(scene: HausScene): HausScene {
    const normalized = this.normalizeScene(scene);
    this.scenes.set(normalized.id, normalized);
    void this.roomCoordinator.putScene(normalized);
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
      steps: this.normalizeSteps(script.steps),
    };
    this.scripts.set(normalized.id, normalized);
    void this.roomCoordinator.putScript(normalized);
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
      actions: this.normalizeSteps(rule.actions),
    };
    this.automations.set(normalized.id, normalized);
    void this.roomCoordinator.putAutomation(normalized);
    this.automationEngine.updateRule(normalized);
    return normalized;
  }

  listAutomations(): HausAutomationRule[] {
    return Array.from(this.automations.values());
  }

  removeAutomation(ruleId: string): boolean {
    const existed = this.automations.delete(ruleId);
    this.automationEngine.unregisterRule(ruleId);
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

    this.installedApps.set(validation.manifest.id, {
      manifest: validation.manifest,
      state: 'running',
      logs: [`[${new Date().toISOString()}] Installed ${validation.manifest.id}`],
      config: {},
    });

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
    this.liveService?.publish('apps');
    return result;
  }
}
