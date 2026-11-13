/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { EventEmitter } from 'node:events';
import type { HausDevice } from '@haus/core/device';
import type { DeviceRecord } from './contracts.js';
import {
  inspectScryptedDevice,
  executeScryptedCommand,
  type ScryptedCommandTarget,
} from './scrypted/adapter.js';
import type { HomebridgeVirtualApi } from './homebridge/api.js';
import type { HomebridgeChildBridge } from './homebridge/child.js';
import type { HacsVirtualizer } from './hacs/virtualizer.js';
import type { SupervisorApiServer } from './supervisor/server.js';
import {
  COMPATIBILITY_MATRIX,
  PluginSecretVault,
  type CompatibilityMatrixEntry,
  type CompatibilityRuntimeKind,
  type KitsuneCommandPayload,
  type KitsuneEngineDiagnostic,
  type SessionOwnershipLease,
  type UnsupportedCapability,
} from './secrets.js';

export * from './secrets.js';

export interface KitsuneCompatibilityEngineOptions {
  maxAdapters?: number;
  maxDevicesPerPlugin?: number;
  maxUnsupportedRecords?: number;
  maxDiagnostics?: number;
  secretVault?: PluginSecretVault;
}

export class KitsuneCompatibilityEngine extends EventEmitter {
  private readonly maxAdapters: number;
  private readonly maxDevicesPerPlugin: number;
  private readonly maxUnsupportedRecords: number;
  private readonly maxDiagnostics: number;
  readonly secrets: PluginSecretVault;

  private readonly leases = new Map<string, SessionOwnershipLease>();
  private readonly devicesBySession = new Map<string, Map<string, HausDevice>>();
  private readonly scryptedTargets = new Map<string, ScryptedCommandTarget>();
  private readonly homebridgeApis = new Map<string, HomebridgeVirtualApi>();
  private readonly homebridgeBridges = new Map<string, HomebridgeChildBridge>();
  private readonly hacsVirtualizers = new Map<string, HacsVirtualizer>();
  private readonly supervisorServers = new Map<string, SupervisorApiServer>();
  private readonly unsupported: UnsupportedCapability[] = [];
  private readonly diagnostics: KitsuneEngineDiagnostic[] = [];

  constructor(options: KitsuneCompatibilityEngineOptions = {}) {
    super();
    this.maxAdapters = options.maxAdapters ?? 32;
    this.maxDevicesPerPlugin = options.maxDevicesPerPlugin ?? 256;
    this.maxUnsupportedRecords = options.maxUnsupportedRecords ?? 500;
    this.maxDiagnostics = options.maxDiagnostics ?? 500;
    this.secrets = options.secretVault ?? new PluginSecretVault();
  }

  private sessionKey(runtime: CompatibilityRuntimeKind, pluginId: string): string {
    return `${runtime}:${pluginId}`;
  }

  acquireSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
  ): SessionOwnershipLease {
    const key = this.sessionKey(runtime, pluginId);
    const existing = this.leases.get(key);
    if (existing && existing.status !== 'released') {
      if (existing.ownerId !== ownerId) {
        this.recordDiagnostic(pluginId, 'warn', 'session_conflict', {
          runtime,
          requestedOwner: ownerId,
          activeOwner: existing.ownerId,
          epoch: existing.epoch,
        });
        throw new Error('kitsune_session_conflict');
      }
      return { ...existing };
    }

    const activeCount = Array.from(this.leases.values()).filter(
      (l) => l.status !== 'released',
    ).length;
    if (!existing && activeCount >= this.maxAdapters) {
      throw new Error('kitsune_adapter_limit_exceeded');
    }

    const now = new Date().toISOString();
    const lease: SessionOwnershipLease = {
      sessionKey: key,
      runtime,
      pluginId,
      ownerId,
      epoch: existing ? existing.epoch + 1 : 1,
      status: 'active',
      acquiredAt: existing ? existing.acquiredAt : now,
      updatedAt: now,
    };
    this.leases.set(key, lease);
    this.recordDiagnostic(pluginId, 'info', 'session_acquired', {
      runtime,
      ownerId,
      epoch: lease.epoch,
    });
    return { ...lease };
  }

  restartSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
  ): SessionOwnershipLease {
    const key = this.sessionKey(runtime, pluginId);
    const existing = this.leases.get(key);
    if (!existing) {
      return this.acquireSession(runtime, pluginId, ownerId);
    }
    if (existing.status !== 'released' && existing.ownerId !== ownerId) {
      this.recordDiagnostic(pluginId, 'warn', 'session_restart_conflict', {
        runtime,
        requestedOwner: ownerId,
        activeOwner: existing.ownerId,
      });
      throw new Error('kitsune_session_conflict');
    }

    const now = new Date().toISOString();
    const updated: SessionOwnershipLease = {
      ...existing,
      ownerId,
      epoch: existing.epoch + 1,
      status: 'active',
      updatedAt: now,
    };
    this.leases.set(key, updated);
    this.recordDiagnostic(pluginId, 'info', 'session_restarted', {
      runtime,
      ownerId,
      epoch: updated.epoch,
    });
    return { ...updated };
  }

  releaseSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
  ): SessionOwnershipLease {
    const key = this.sessionKey(runtime, pluginId);
    const existing = this.leases.get(key);
    if (!existing) {
      throw new Error('kitsune_session_not_found');
    }
    if (existing.ownerId !== ownerId) {
      throw new Error('kitsune_session_conflict');
    }
    const released: SessionOwnershipLease = {
      ...existing,
      status: 'released',
      updatedAt: new Date().toISOString(),
    };
    this.leases.set(key, released);
    if (runtime === 'homebridge') {
      this.homebridgeApis.delete(key);
      this.homebridgeBridges.delete(key);
    }
    this.recordDiagnostic(pluginId, 'info', 'session_released', {
      runtime,
      ownerId,
      epoch: released.epoch,
    });
    return { ...released };
  }

  assertSessionEpoch(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
    epoch: number,
  ): SessionOwnershipLease {
    const key = this.sessionKey(runtime, pluginId);
    const lease = this.leases.get(key);
    if (!lease || lease.status !== 'active') {
      throw new Error('kitsune_session_inactive');
    }
    if (lease.ownerId !== ownerId) {
      throw new Error('kitsune_session_conflict');
    }
    if (lease.epoch !== epoch) {
      this.recordDiagnostic(pluginId, 'warn', 'stale_session_epoch_fenced', {
        runtime,
        ownerId,
        attemptedEpoch: epoch,
        activeEpoch: lease.epoch,
      });
      throw new Error('kitsune_stale_session_epoch');
    }
    return lease;
  }

  getSession(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
  ): SessionOwnershipLease | undefined {
    const lease = this.leases.get(this.sessionKey(runtime, pluginId));
    return lease ? { ...lease } : undefined;
  }

  recordUnsupportedCapability(entry: Omit<UnsupportedCapability, 'reportedAt'>): void {
    const exists = this.unsupported.some(
      (u) =>
        u.runtime === entry.runtime &&
        u.pluginId === entry.pluginId &&
        u.deviceId === entry.deviceId &&
        u.capability === entry.capability,
    );
    if (exists) return;

    const record: UnsupportedCapability = {
      ...entry,
      reportedAt: new Date().toISOString(),
    };
    if (this.unsupported.length >= this.maxUnsupportedRecords) {
      this.unsupported.shift();
    }
    this.unsupported.push(record);
    this.recordDiagnostic(entry.pluginId, 'warn', 'unsupported_capability', {
      runtime: entry.runtime,
      deviceId: entry.deviceId,
      capability: entry.capability,
      reason: entry.reason,
    });
    this.emit('unsupportedCapability', record);
  }

  recordDiagnostic(
    pluginId: string,
    level: KitsuneEngineDiagnostic['level'],
    event: string,
    detail?: Record<string, unknown>,
  ): void {
    const entry: KitsuneEngineDiagnostic = {
      timestamp: new Date().toISOString(),
      pluginId,
      level,
      event: this.secrets.redactText(event),
      detail: detail ? this.secrets.redactValue(detail) : undefined,
    };
    if (this.diagnostics.length >= this.maxDiagnostics) {
      this.diagnostics.shift();
    }
    this.diagnostics.push(entry);
  }

  private putSessionDevices(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    devices: readonly HausDevice[],
  ): void {
    if (devices.length > this.maxDevicesPerPlugin) {
      throw new Error('kitsune_device_limit_exceeded');
    }
    const key = this.sessionKey(runtime, pluginId);
    const map = new Map<string, HausDevice>();
    for (const dev of devices) {
      map.set(dev.id, dev);
    }
    this.devicesBySession.set(key, map);
    this.emit('devicesChanged', this.getDevices());
  }

  registerScryptedDevice(
    pluginId: string,
    ownerId: string,
    epoch: number,
    record: DeviceRecord,
    target?: ScryptedCommandTarget,
  ): HausDevice {
    this.assertSessionEpoch('scrypted', pluginId, ownerId, epoch);
    const key = this.sessionKey('scrypted', pluginId);
    let bucket = this.devicesBySession.get(key);
    if (!bucket) {
      bucket = new Map<string, HausDevice>();
      this.devicesBySession.set(key, bucket);
    }
    const inspected = inspectScryptedDevice(record, pluginId);
    if (!bucket.has(inspected.device.id) && bucket.size >= this.maxDevicesPerPlugin) {
      throw new Error('kitsune_device_limit_exceeded');
    }
    for (const item of inspected.unsupportedCapabilities) {
      this.recordUnsupportedCapability(item);
    }
    bucket.set(inspected.device.id, inspected.device);
    if (target) {
      this.scryptedTargets.set(key, target);
    }
    this.emit('devicesChanged', this.getDevices());
    return inspected.device;
  }

  attachHomebridgeApi(
    pluginId: string,
    ownerId: string,
    epoch: number,
    api: HomebridgeVirtualApi,
  ): void {
    this.assertSessionEpoch('homebridge', pluginId, ownerId, epoch);
    const key = this.sessionKey('homebridge', pluginId);
    this.homebridgeBridges.delete(key);
    this.homebridgeApis.set(key, api);

    const sync = (devices: readonly HausDevice[]) => {
      const current = this.leases.get(key);
      if (!current || current.status !== 'active' || this.homebridgeApis.get(key) !== api) return;
      for (const item of api.getUnsupportedCapabilities(pluginId)) {
        this.recordUnsupportedCapability(item);
      }
      this.putSessionDevices('homebridge', pluginId, devices);
    };

    api.on('unsupportedCapability', (item: Omit<UnsupportedCapability, 'reportedAt'>) => {
      const current = this.leases.get(key);
      if (!current || current.status !== 'active' || this.homebridgeApis.get(key) !== api) return;
      this.recordUnsupportedCapability({ ...item, pluginId });
    });
    api.on('devicesChanged', (devices: HausDevice[]) => sync(devices));
    sync(api.getHausDevices());
  }

  attachHomebridgeBridge(
    pluginId: string,
    ownerId: string,
    epoch: number,
    bridge: HomebridgeChildBridge,
  ): void {
    this.assertSessionEpoch('homebridge', pluginId, ownerId, epoch);
    const key = this.sessionKey('homebridge', pluginId);
    this.homebridgeApis.delete(key);
    this.homebridgeBridges.set(key, bridge);

    const isCurrent = () => {
      const current = this.leases.get(key);
      return (
        Boolean(current) &&
        current?.status === 'active' &&
        current.epoch === epoch &&
        this.homebridgeBridges.get(key) === bridge
      );
    };

    bridge.on('unsupportedCapability', (item: Omit<UnsupportedCapability, 'reportedAt'>) => {
      if (!isCurrent()) return;
      this.recordUnsupportedCapability({ ...item, pluginId });
    });
    bridge.on('devicesChanged', (devices: HausDevice[]) => {
      if (!isCurrent()) return;
      this.putSessionDevices('homebridge', pluginId, devices);
    });
  }

  attachHacsVirtualizer(
    pluginId: string,
    ownerId: string,
    epoch: number,
    virtualizer: HacsVirtualizer,
  ): void {
    this.assertSessionEpoch('hacs', pluginId, ownerId, epoch);
    const key = this.sessionKey('hacs', pluginId);
    this.hacsVirtualizers.set(key, virtualizer);

    const sync = () => {
      const current = this.leases.get(key);
      if (!current || current.status !== 'active' || current.epoch !== epoch) return;
      for (const item of virtualizer.getUnsupportedCapabilities(pluginId)) {
        this.recordUnsupportedCapability(item);
      }
      this.putSessionDevices('hacs', pluginId, virtualizer.getHausDevices());
    };

    virtualizer.on('unsupportedCapability', (item: Omit<UnsupportedCapability, 'reportedAt'>) => {
      const current = this.leases.get(key);
      if (!current || current.status !== 'active' || current.epoch !== epoch) return;
      this.recordUnsupportedCapability({ ...item, pluginId });
    });
    virtualizer.on('stateChanged', () => sync());
    sync();
  }

  attachSupervisorServer(
    pluginId: string,
    ownerId: string,
    epoch: number,
    server: SupervisorApiServer,
  ): void {
    this.assertSessionEpoch('supervisor', pluginId, ownerId, epoch);
    const key = this.sessionKey('supervisor', pluginId);
    this.supervisorServers.set(key, server);

    server.on('unsupportedCapability', (item: Omit<UnsupportedCapability, 'reportedAt'>) => {
      const current = this.leases.get(key);
      if (!current || current.status !== 'active' || current.epoch !== epoch) return;
      this.recordUnsupportedCapability(item);
    });
  }

  async executeCommand(
    runtime: CompatibilityRuntimeKind,
    pluginId: string,
    ownerId: string,
    epoch: number,
    command: KitsuneCommandPayload,
  ): Promise<unknown> {
    this.assertSessionEpoch(runtime, pluginId, ownerId, epoch);
    const key = this.sessionKey(runtime, pluginId);

    if (runtime === 'scrypted') {
      const target = this.scryptedTargets.get(key);
      if (!target) throw new Error('kitsune_adapter_not_attached');
      const nativeId = command.deviceId.replace(`kitsune:${pluginId}:`, '');
      return executeScryptedCommand(target, nativeId, command.capability, command.value);
    }

    if (runtime === 'homebridge') {
      const api = this.homebridgeApis.get(key);
      if (api) {
        await api.executeCommand(command);
        return { ok: true };
      }
      const bridge = this.homebridgeBridges.get(key);
      if (bridge) {
        await bridge.executeCommand(command);
        return { ok: true };
      }
      throw new Error('kitsune_adapter_not_attached');
    }

    if (runtime === 'hacs') {
      const virtualizer = this.hacsVirtualizers.get(key);
      if (!virtualizer) throw new Error('kitsune_adapter_not_attached');
      await virtualizer.executeCommand(command);
      return { ok: true };
    }

    throw new Error(`kitsune_unsupported_runtime_command:${runtime}`);
  }

  getDevices(runtime?: CompatibilityRuntimeKind, pluginId?: string): HausDevice[] {
    if (runtime && pluginId) {
      const bucket = this.devicesBySession.get(this.sessionKey(runtime, pluginId));
      return bucket ? Array.from(bucket.values()) : [];
    }
    const all: HausDevice[] = [];
    for (const [key, bucket] of this.devicesBySession.entries()) {
      const lease = this.leases.get(key);
      if (lease && lease.status === 'released') continue;
      if (runtime && !key.startsWith(`${runtime}:`)) continue;
      all.push(...bucket.values());
    }
    return all;
  }

  getUnsupportedCapabilities(
    runtime?: CompatibilityRuntimeKind,
    pluginId?: string,
  ): UnsupportedCapability[] {
    return this.unsupported.filter(
      (u) => (!runtime || u.runtime === runtime) && (!pluginId || u.pluginId === pluginId),
    );
  }

  getCompatibilityMatrix(): readonly CompatibilityMatrixEntry[] {
    return COMPATIBILITY_MATRIX;
  }

  getDiagnostics(pluginId?: string): KitsuneEngineDiagnostic[] {
    return this.diagnostics
      .filter((d) => !pluginId || d.pluginId === pluginId)
      .map((d) => this.secrets.redactValue(d));
  }
}
