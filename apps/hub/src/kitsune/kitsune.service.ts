/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { HausDevice } from '@haus/core/device';
import {
  KitsuneCompatibilityEngine,
  vendorCatalog,
  vendorRoute,
  type CompatibilityMatrixEntry,
  type CompatibilityRuntimeKind,
  type DeviceRecord,
  type DriverRoute,
  type Json,
  type KitsuneEngineDiagnostic,
  type SessionOwnershipLease,
  type UnsupportedCapability,
  type VendorPreset,
} from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import type { IKitsuneService, WebhookResult } from './kitsune.controller.js';
import type { KitsuneVendorItemDto } from './kitsune.dto.js';

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
export class StandaloneKitsuneService implements IKitsuneService {
  readonly engine: KitsuneCompatibilityEngine;
  private readonly defaultOwnerId = 'haus-hub-standalone';
  private readonly enabledVendors = new Set<string>();
  private readonly routeOverrides: Record<string, DriverRoute> = {};
  private readonly onboardedConfigs = new Map<string, Record<string, string>>();
  private readonly webhookTokens = new Map<string, string>();
  private readonly webhookHandlers = new Map<string, WebhookHandler>();
  private readonly knownSessions = new Set<string>();
  private deviceCounter = 0;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {
    this.engine = new KitsuneCompatibilityEngine();
    this.engine.on('devicesChanged', (devices: readonly HausDevice[]) => {
      this.syncDevicesToHome(devices);
    });
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

  private normalizeDeviceForHome(device: HausDevice): HausDevice {
    const prefix = `${device.id}:`;
    return {
      ...device,
      endpoints: device.endpoints.map((ep) => ({
        ...ep,
        id: ep.id.startsWith(prefix) ? ep.id : `${prefix}${ep.id}`,
      })),
    };
  }

  private syncDevicesToHome(devices: readonly HausDevice[]): void {
    if (!this.homeService) return;
    for (const dev of devices) {
      this.homeService.registerDevice(this.normalizeDeviceForHome(dev));
    }
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
    const roomId =
      typeof settings.roomId === 'string' && settings.roomId.trim().length > 0
        ? settings.roomId.trim()
        : 'default';
    const normalized = this.normalizeDeviceForHome({
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
