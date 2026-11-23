/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { HausDevice } from '@haus/core/device';
import {
  EcosystemPluginCatalog,
  KitsuneCompatibilityEngine,
  vendorCatalog,
  vendorRoute,
  type CompatibilityMatrixEntry,
  type CompatibilityRuntimeKind,
  type DeviceRecord,
  type DriverRoute,
  type HomebridgeVirtualApi,
  type Json,
  type KitsuneEngineDiagnostic,
  type SessionOwnershipLease,
  type UnsupportedCapability,
  type VendorPreset,
} from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import type { IKitsuneService, WebhookResult } from './kitsune.controller.js';
import type { KitsuneVendorItemDto } from './kitsune.dto.js';
import { HomebridgeAppSupervisor } from './homebridge-runtime.js';
import { attachEcosystemCatalogProvider } from './scrypted-helpers.js';
import { ScryptedAppSupervisor } from './scrypted-runtime.js';
import {
  buildKitsuneCommandPayload,
  normalizeKitsuneDeviceForHome,
  resolveKitsuneCommandTarget,
  syncKitsuneDevicesToHome,
} from './homebridge-sync.js';

export type WebhookHandler = (
  subpath: string | undefined,
  request: { method: string; url: string; headers: Record<string, string>; body: string },
) => Promise<WebhookResult> | WebhookResult;

export interface KitsuneCompatibilitySnapshot {
  matrix: readonly CompatibilityMatrixEntry[];
  sessions: SessionOwnershipLease[];
  devices: HausDevice[];
  unsupportedCapabilities: UnsupportedCapability[];
  diagnostics: KitsuneEngineDiagnostic[];
}

@Injectable()
export class StandaloneKitsuneService implements IKitsuneService, OnModuleInit, OnModuleDestroy {
  readonly engine: KitsuneCompatibilityEngine;
  readonly homebridgeRuntime: HomebridgeAppSupervisor;
  readonly scryptedRuntime: ScryptedAppSupervisor;
  readonly ecosystemCatalog: EcosystemPluginCatalog;
  private readonly defaultOwnerId = 'haus-hub-standalone';
  private readonly enabledVendors = new Set<string>();
  private readonly routeOverrides: Record<string, DriverRoute> = {};
  private readonly onboardedConfigs = new Map<string, Record<string, string>>();
  private readonly webhookTokens = new Map<string, string>();
  private readonly webhookHandlers = new Map<string, WebhookHandler>();
  private readonly knownSessions = new Set<string>();
  private readonly syncedDeviceIds = new Set<string>();
  private readonly pendingAliases = new Set<Promise<void>>();
  private deviceCounter = 0;
  private unregisterCommandHandler?: () => void;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {
    this.engine = new KitsuneCompatibilityEngine();
    const syncDevices = () => this.syncDevicesToHome(this.engine.getDevices());
    this.homebridgeRuntime = new HomebridgeAppSupervisor(
      this.engine,
      this.homeService,
      syncDevices,
    );
    this.scryptedRuntime = new ScryptedAppSupervisor(this.engine, this.homeService, syncDevices);
    const dataDir = resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
    this.ecosystemCatalog = new EcosystemPluginCatalog(dataDir);
    if (this.homeService) {
      attachEcosystemCatalogProvider(this.homeService.appManager.catalog, this.ecosystemCatalog);
      this.homeService.appManager.registerRuntimeBridge('homebridge', this.homebridgeRuntime);
      this.homeService.appManager.registerRuntimeBridge('scrypted', this.scryptedRuntime);
    }
    this.engine.on('devicesChanged', (devices: readonly HausDevice[]) => {
      this.syncDevicesToHome(devices);
    });
    if (this.homeService) {
      this.unregisterCommandHandler = this.homeService.registerCommandHandler(
        'virtual',
        async (endpointId, capability, command, parameters) => {
          await this.handleDeviceCommand(endpointId, capability, command, parameters);
        },
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.homeService) {
      const appCatalog = this.homeService.appManager.catalog;
      if (await this.ecosystemCatalog.loadDiskCache()) {
        this.ecosystemCatalog.syncIntoAppCatalog(appCatalog);
      }
      if (process.env.NODE_ENV !== 'test') {
        this.ecosystemCatalog.startBackgroundIndexing(appCatalog);
      }
    }
    await this.homeService?.appManager.restoreRuntimeBridges();
  }

  async onModuleDestroy(): Promise<void> {
    this.ecosystemCatalog.stopBackgroundIndexing();
    this.unregisterCommandHandler?.();
    await Promise.allSettled([this.homebridgeRuntime.close(), this.scryptedRuntime.close()]);
  }

  async flushPendingReconciliations(): Promise<void> {
    await Promise.allSettled(this.pendingAliases);
  }

  private findVendorPreset(vendor: string): VendorPreset {
    const preset = vendorCatalog.find((item) => item.id === vendor);
    if (!preset) {
      throw new Error('kitsune_unknown_vendor');
    }
    return preset;
  }

  private ensureVendorSession(
    vendor: string,
    ownerId = this.defaultOwnerId,
  ): SessionOwnershipLease {
    const existing = this.engine.getSession('scrypted', vendor);
    if (existing && existing.status === 'active' && existing.ownerId === ownerId) {
      return existing;
    }
    const lease = this.engine.acquireSession('scrypted', vendor, ownerId);
    this.knownSessions.add(`scrypted:${vendor}`);
    return lease;
  }

  private syncDevicesToHome(devices: readonly HausDevice[]): void {
    syncKitsuneDevicesToHome({
      homeService: this.homeService,
      syncedDeviceIds: this.syncedDeviceIds,
      pendingAliases: this.pendingAliases,
      devices,
    });
  }

  catalog(): KitsuneVendorItemDto[] {
    return vendorCatalog.map((preset) => ({
      id: preset.id,
      name: preset.name,
      enabled: this.enabledVendors.has(preset.id),
      route: { ...vendorRoute(preset.id, this.routeOverrides) },
    }));
  }

  async enable(vendor: string): Promise<Record<string, unknown>> {
    const preset = this.findVendorPreset(vendor);
    const session = this.ensureVendorSession(preset.id);
    this.enabledVendors.add(preset.id);
    return {
      vendor: preset.id,
      enabled: true,
      route: vendorRoute(preset.id, this.routeOverrides),
      session,
    };
  }

  async settings(vendor: string): Promise<unknown> {
    const preset = this.findVendorPreset(vendor);
    return {
      vendor: preset.id,
      name: preset.name,
      driver: preset.driver,
      fields: preset.fields,
      route: vendorRoute(preset.id, this.routeOverrides),
    };
  }

  async onboard(vendor: string, fields: Record<string, string>): Promise<unknown> {
    const preset = this.findVendorPreset(vendor);
    if (!fields || typeof fields !== 'object') {
      throw new Error('kitsune_invalid_onboard_fields');
    }

    for (const field of preset.fields) {
      const val = fields[field.key];
      if (field.required && (typeof val !== 'string' || val.trim().length === 0)) {
        throw new Error(`kitsune_missing_field:${field.key}`);
      }
    }

    const storedConfig: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== 'string') continue;
      const fieldMeta = preset.fields.find((f) => f.key === key);
      const isSecret = fieldMeta?.type === 'password' || /password|secret|token|key/i.test(key);
      if (isSecret && value.length > 0) {
        this.engine.secrets.setSecret('scrypted', preset.id, key, value);
        storedConfig[key] = '[REDACTED]';
      } else {
        storedConfig[key] = value;
      }
    }

    const session = this.ensureVendorSession(preset.id);
    this.enabledVendors.add(preset.id);
    this.onboardedConfigs.set(preset.id, storedConfig);
    this.engine.recordDiagnostic(preset.id, 'info', 'vendor_onboarded', {
      vendor: preset.id,
      fields: storedConfig,
    });

    return {
      vendor: preset.id,
      success: true,
      enabled: true,
      configuredFields: Object.keys(fields),
      session,
    };
  }

  async create(vendor: string, settings: Record<string, unknown>): Promise<unknown> {
    const preset = this.findVendorPreset(vendor);
    if (!settings || typeof settings !== 'object') {
      throw new Error('kitsune_invalid_device_settings');
    }

    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'string' && /password|secret|token|key/i.test(key) && value.length > 0) {
        this.engine.secrets.setSecret('scrypted', preset.id, key, value);
      }
    }

    const session = this.ensureVendorSession(preset.id);
    this.enabledVendors.add(preset.id);
    this.deviceCounter += 1;

    const nativeId =
      typeof settings.nativeId === 'string' && settings.nativeId.trim().length > 0
        ? settings.nativeId.trim()
        : typeof settings.id === 'string' && settings.id.trim().length > 0
          ? settings.id.trim()
          : `${preset.id}-${this.deviceCounter}`;
    const name =
      typeof settings.name === 'string' && settings.name.trim().length > 0
        ? settings.name.trim()
        : `${preset.name} ${this.deviceCounter}`;
    const interfaces = Array.isArray(settings.interfaces)
      ? settings.interfaces.filter((item): item is string => typeof item === 'string')
      : ['VideoCamera', 'MotionSensor'];
    const rawState =
      settings.state && typeof settings.state === 'object' && !Array.isArray(settings.state)
        ? (settings.state as Record<string, Json>)
        : { online: true };

    const record: DeviceRecord = {
      id: nativeId,
      nativeId,
      name,
      interfaces,
      state: rawState,
    };

    const rawDevice = this.engine.registerScryptedDevice(
      preset.id,
      session.ownerId,
      session.epoch,
      record,
    );
    const existing = this.homeService?.getDevice(rawDevice.id);
    const roomId =
      typeof settings.roomId === 'string' && settings.roomId.trim().length > 0
        ? settings.roomId.trim()
        : (existing?.roomId ?? 'default');
    const normalized = normalizeKitsuneDeviceForHome({
      ...rawDevice,
      roomId,
      areaId: roomId,
    });
    const registered = this.homeService ? this.homeService.registerDevice(normalized) : normalized;

    return {
      vendor: preset.id,
      deviceId: registered.id,
      device: registered,
      session,
    };
  }

  registerWebhookToken(plugin: string, token: string, handler?: WebhookHandler): void {
    if (!plugin || !token) {
      throw new Error('kitsune_invalid_webhook_registration');
    }
    this.webhookTokens.set(plugin, token);
    this.engine.secrets.setSecret('scrypted', plugin, 'webhook_token', token);
    if (handler) {
      this.webhookHandlers.set(plugin, handler);
    }
  }

  canWebhook(plugin: string, token: string): boolean {
    const expected = this.webhookTokens.get(plugin);
    if (!expected || !token) return false;
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(token, 'utf8');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  async webhook(
    plugin: string,
    subpath: string | undefined,
    request: { method: string; url: string; headers: Record<string, string>; body: string },
    _token: string,
  ): Promise<WebhookResult> {
    this.engine.recordDiagnostic(plugin, 'info', 'webhook_received', {
      subpath: subpath ?? '',
      method: request.method,
    });
    const handler = this.webhookHandlers.get(plugin);
    if (handler) {
      return await handler(subpath, request);
    }
    return {
      code: 200,
      headers: {
        'content-type': 'application/json',
        'x-handled-by': plugin,
      },
      body: JSON.stringify({
        handled: true,
        plugin,
        subpath: subpath ?? null,
        method: request.method,
      }),
    };
  }

  acquireSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
  ): SessionOwnershipLease {
    const lease = this.engine.acquireSession(runtime, pluginId, ownerId);
    this.knownSessions.add(`${runtime}:${pluginId}`);
    return lease;
  }

  restartSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
  ): SessionOwnershipLease {
    const lease = this.engine.restartSession(runtime, pluginId, ownerId);
    this.knownSessions.add(`${runtime}:${pluginId}`);
    return lease;
  }

  releaseSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
  ): SessionOwnershipLease {
    return this.engine.releaseSession(runtime, pluginId, ownerId);
  }

  listSessions(): SessionOwnershipLease[] {
    const leases: SessionOwnershipLease[] = [];
    for (const key of this.knownSessions) {
      const [runtime, ...rest] = key.split(':');
      const pluginId = rest.join(':');
      const lease = this.engine.getSession(runtime as CompatibilityRuntimeKind, pluginId);
      if (lease) leases.push(lease);
    }
    return leases;
  }

  attachHomebridgeApi(
    pluginId: string,
    ownerId: string,
    _epoch: number,
    api: HomebridgeVirtualApi,
  ): void {
    let session = this.engine.getSession('homebridge', pluginId);
    if (!session || session.status !== 'active') {
      session = this.engine.acquireSession('homebridge', pluginId, ownerId);
    }
    this.engine.attachHomebridgeApi(pluginId, session.ownerId, session.epoch, api);
    this.knownSessions.add(`homebridge:${pluginId}`);
    this.syncDevicesToHome(this.engine.getDevices());
  }

  async handleDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const { targetDevice, isKitsuneDevice, runtime, pluginId } = resolveKitsuneCommandTarget(
      this.engine.getDevices(),
      endpointId,
    );
    if (!isKitsuneDevice) {
      // Generic standalone device without attached Kitsune adapter; state updated optimistically.
      return;
    }

    if (runtime === 'homebridge') {
      if (!this.engine.hasAttachedAdapter('homebridge', pluginId)) {
        await this.homebridgeRuntime.ensureRunning(pluginId);
      }
      const session = this.engine.getSession('homebridge', pluginId);
      if (
        !session ||
        session.status !== 'active' ||
        !this.engine.hasAttachedAdapter('homebridge', pluginId)
      ) {
        throw new ServiceUnavailableException({
          error: 'kitsune_adapter_not_attached',
          runtime,
          pluginId,
        });
      }
      const payload = buildKitsuneCommandPayload({
        targetDevice,
        endpointId,
        capability,
        command,
        parameters,
      });
      await this.engine.executeCommand(runtime, pluginId, session.ownerId, session.epoch, payload);
      return;
    }

    const payload = buildKitsuneCommandPayload({
      targetDevice,
      endpointId,
      capability,
      command,
      parameters,
    });
    if (
      runtime === 'scrypted' &&
      (this.scryptedRuntime.isRunning(pluginId) ||
        this.homeService?.appManager.getInstalledApp(pluginId))
    ) {
      await this.scryptedRuntime.executeDeviceCommand(pluginId, payload);
      return;
    }
    let session = this.engine.getSession(runtime, pluginId);
    if (!session || session.status !== 'active') {
      session = this.engine.acquireSession(runtime, pluginId, this.defaultOwnerId);
      this.knownSessions.add(`${runtime}:${pluginId}`);
    }
    await this.engine.executeCommand(runtime, pluginId, session.ownerId, session.epoch, payload);
  }

  compatibility(): KitsuneCompatibilitySnapshot {
    return {
      matrix: this.engine.getCompatibilityMatrix(),
      sessions: this.listSessions(),
      devices: this.engine.getDevices(),
      unsupportedCapabilities: this.engine.getUnsupportedCapabilities(),
      diagnostics: this.engine.getDiagnostics(),
    };
  }
}
