/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { HausDevice } from '@haus/core/device';
import { MockAccessory, type MockService } from './hap.js';
import type { KitsuneCommandPayload, UnsupportedCapability } from '../engine.js';
import { generateHapUuid } from './uuid.js';
import { HomebridgeAccessoryCache } from './cache.js';
import { SUPPORTED_HOMEBRIDGE_CAPABILITIES } from './types.js';
import { projectAccessoryToHausDevice, executeAccessoryCommand } from './projection.js';
import {
  AdaptiveLightingController,
  Categories,
  Formats,
  HAPLibraryVersion,
  HAPStatus,
  HapCharacteristicRegistry,
  HapServiceRegistry,
  HapStatusError,
  Perms,
  Units,
} from './hap-compat.js';

export { SUPPORTED_HOMEBRIDGE_CAPABILITIES };

export interface HomebridgePluginModule {
  (api: HomebridgeVirtualApi): void;
}

export type AccessoryConstructor = new (
  log: (msg: string) => void,
  config: Record<string, unknown>,
  api: HomebridgeVirtualApi,
) => {
  getServices?(): MockService[];
};

export type PlatformConstructor = new (
  log: (msg: string) => void,
  config: Record<string, unknown>,
  api: HomebridgeVirtualApi,
) => {
  configureAccessory?(accessory: MockAccessory): void;
  accessories?(callback: (foundAccessories: MockAccessory[]) => void): void;
};

export class HomebridgeVirtualApi extends EventEmitter {
  readonly platformAccessory = MockAccessory;
  readonly version = '2.0.0';
  readonly serverVersion = '1.8.4';
  readonly storagePath: string;
  readonly user: {
    storagePath: () => string;
    configPath: () => string;
    persistPath: () => string;
    cachedAccessoryPath: () => string;
  };
  readonly hap = {
    Service: HapServiceRegistry,
    Characteristic: HapCharacteristicRegistry,
    Accessory: MockAccessory,
    Formats,
    Perms,
    Units,
    Categories,
    HAPStatus,
    HapStatusError,
    HAPLibraryVersion,
    AdaptiveLightingController,
    uuid: { generate: generateHapUuid },
  };

  private registeredAccessories = new Map<string, AccessoryConstructor>();
  private registeredPlatforms = new Map<string, PlatformConstructor>();
  private devices = new Map<string, HausDevice>();
  private accessories = new Map<string, MockAccessory>();
  private accessoryPlugins = new Map<string, string>();
  private reprojectingUuids = new Set<string>();
  private unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] = [];
  private pendingCacheOp: Promise<void> = Promise.resolve();
  private readonly canonicalPluginId?: string;

  constructor(options?: { storagePath?: string; pluginId?: string }) {
    super();
    this.storagePath = options?.storagePath ?? '/tmp/homebridge';
    this.canonicalPluginId = options?.pluginId?.trim() || undefined;
    this.user = {
      storagePath: () => this.storagePath,
      configPath: () => join(this.storagePath, 'config.json'),
      persistPath: () => join(this.storagePath, 'persist'),
      cachedAccessoryPath: () => join(this.storagePath, 'accessories'),
    };
  }

  private resolveCanonicalPluginName(pluginName: string): string {
    return this.canonicalPluginId ?? pluginName;
  }

  getPlatformConstructor(
    pluginName: string,
    platformName: string,
  ): PlatformConstructor | undefined {
    const direct =
      this.registeredPlatforms.get(`${pluginName}.${platformName}`) ??
      this.registeredPlatforms.get(platformName) ??
      this.registeredPlatforms.get(pluginName);
    if (direct) return direct;

    const lowerTarget = platformName.toLowerCase();
    for (const [key, ctor] of this.registeredPlatforms.entries()) {
      const suffix = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
      if (suffix.toLowerCase() === lowerTarget) return ctor;
    }

    const unique = new Set(this.registeredPlatforms.values());
    if (unique.size === 1) {
      return [...unique][0];
    }
    return undefined;
  }

  restoreCachedAccessory(pluginName: string, acc: MockAccessory): HausDevice {
    return this.ingestAccessory(pluginName, acc);
  }

  getAccessories(): MockAccessory[] {
    return Array.from(this.accessories.values());
  }

  registerAccessory(
    pluginName: string,
    accessoryName: string,
    constructor: AccessoryConstructor,
  ): void {
    const key = `${pluginName}.${accessoryName}`;
    this.registeredAccessories.set(key, constructor);
  }

  versionGreaterOrEqual(minVersion: string): boolean {
    const parse = (v: string) =>
      v
        .replace(/^v/, '')
        .split('.')
        .map((n) => Number.parseInt(n, 10) || 0);
    const a = parse(this.serverVersion);
    const b = parse(minVersion);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return true;
  }

  registerPlatform(
    pluginNameOrPlatformName: string,
    platformNameOrConstructor: string | PlatformConstructor,
    maybeConstructor?: PlatformConstructor,
  ): void {
    if (typeof platformNameOrConstructor === 'function') {
      const key = `${pluginNameOrPlatformName}.${pluginNameOrPlatformName}`;
      this.registeredPlatforms.set(key, platformNameOrConstructor);
      this.registeredPlatforms.set(pluginNameOrPlatformName, platformNameOrConstructor);
      return;
    }
    if (!maybeConstructor) return;
    const key = `${pluginNameOrPlatformName}.${platformNameOrConstructor}`;
    this.registeredPlatforms.set(key, maybeConstructor);
    this.registeredPlatforms.set(platformNameOrConstructor, maybeConstructor);
  }

  publishExternalAccessories(pluginName: string, accessories: MockAccessory[]): void {
    for (const acc of accessories) {
      this.ingestAccessory(pluginName, acc);
    }
  }

  async flushCache(): Promise<void> {
    await this.pendingCacheOp;
  }

  registerPlatformAccessories(
    pluginName: string,
    platformName: string,
    accessories: MockAccessory[],
  ): void {
    const canonical = this.resolveCanonicalPluginName(pluginName);
    for (const acc of accessories) {
      this.ingestAccessory(canonical, acc);
    }
    this.pendingCacheOp = this.pendingCacheOp
      .then(() =>
        HomebridgeAccessoryCache.save(this.storagePath, canonical, platformName, accessories),
      )
      .catch(() => {});
  }

  updatePlatformAccessories(accessories: MockAccessory[]): void {
    for (const acc of accessories) {
      const pluginName = this.accessoryPlugins.get(acc.UUID);
      if (pluginName) {
        this.ingestAccessory(pluginName, acc);
      }
    }
  }

  unregisterPlatformAccessories(
    pluginName: string,
    _platformName: string,
    accessories: MockAccessory[],
  ): void {
    const canonical = this.resolveCanonicalPluginName(pluginName);
    for (const acc of accessories) {
      const deviceId = `homebridge:${canonical}:${acc.UUID}`;
      this.devices.delete(deviceId);
      this.accessories.delete(deviceId);
      this.accessoryPlugins.delete(acc.UUID);
      this.pendingCacheOp = this.pendingCacheOp
        .then(() => HomebridgeAccessoryCache.remove(this.storagePath, acc.UUID))
        .catch(() => {});
      this.emit('deviceRemoved', deviceId);
      this.emit('devicesChanged', this.getDevices());
    }
  }

  getDevices(): HausDevice[] {
    return Array.from(this.devices.values());
  }

  getHausDevices(): HausDevice[] {
    return this.getDevices();
  }

  getDevice(id: string): HausDevice | undefined {
    return this.devices.get(id);
  }

  getUnsupportedCapabilities(pluginId?: string): Omit<UnsupportedCapability, 'reportedAt'>[] {
    if (!pluginId) return [...this.unsupported];
    return this.unsupported.filter((u) => u.pluginId === pluginId);
  }

  ingestAccessory(pluginName: string, acc: MockAccessory): HausDevice {
    const canonical = this.resolveCanonicalPluginName(pluginName);
    const deviceId = `homebridge:${canonical}:${acc.UUID}`;
    const wasPresent = this.devices.has(deviceId);
    this.accessories.set(deviceId, acc);
    this.accessoryPlugins.set(acc.UUID, canonical);
    acc.setMutationHandler(() => {
      if (!this.reprojectingUuids.has(acc.UUID)) {
        this.ingestAccessory(canonical, acc);
      }
    });

    this.reprojectingUuids.add(acc.UUID);
    let projected: ReturnType<typeof projectAccessoryToHausDevice>;
    try {
      projected = projectAccessoryToHausDevice(canonical, acc, (devId, endpointId, readings) => {
        const currentDevice = this.devices.get(devId);
        if (currentDevice) {
          const updatedEndpoints = currentDevice.endpoints.map((ep) =>
            ep.id === endpointId ? { ...ep, readings: { ...ep.readings, ...readings } } : ep,
          );
          this.devices.set(devId, { ...currentDevice, endpoints: updatedEndpoints });
        }
        this.emit('deviceStateChanged', devId, readings);
        this.emit('devicesChanged', this.getDevices());
      });
    } finally {
      this.reprojectingUuids.delete(acc.UUID);
    }

    const { device, unsupported } = projected;
    if (!wasPresent) {
      for (const record of unsupported) {
        this.unsupported.push(record);
        this.emit('unsupportedCapability', record);
      }
    }

    this.devices.set(deviceId, device);
    if (!wasPresent) {
      this.emit('deviceDiscovered', device);
    } else {
      this.emit('deviceUpdated', device);
    }
    this.emit('devicesChanged', this.getDevices());
    return device;
  }

  executeCommand(command: KitsuneCommandPayload): boolean | Promise<boolean>;
  executeCommand(
    deviceId: string,
    endpointId: string,
    capabilityKind: string,
    value: unknown,
  ): boolean | Promise<boolean>;
  executeCommand(
    deviceIdOrCmd: string | KitsuneCommandPayload,
    _endpointId?: string,
    capabilityKindArg?: string,
    valueArg?: unknown,
  ): boolean | Promise<boolean> {
    const isCommandObj = typeof deviceIdOrCmd === 'object' && deviceIdOrCmd !== null;
    const deviceId = isCommandObj ? deviceIdOrCmd.deviceId : deviceIdOrCmd;
    const capabilityKind = isCommandObj ? deviceIdOrCmd.capability : (capabilityKindArg ?? '');
    const value = isCommandObj ? deviceIdOrCmd.value : valueArg;
    const endpointId = isCommandObj ? deviceIdOrCmd.endpointId : _endpointId;

    const device = this.devices.get(deviceId);
    const normalizedEndpointId =
      endpointId && endpointId.startsWith(`${deviceId}:`)
        ? endpointId.slice(deviceId.length + 1)
        : endpointId;
    const endpoint = device?.endpoints.find(
      (ep) =>
        ep.id === endpointId ||
        (normalizedEndpointId !== undefined && ep.id === normalizedEndpointId),
    );
    const endpointSupports = endpoint
      ? endpoint.capabilities.some((c) => {
          if (c.id === capabilityKind || c.kind === capabilityKind) return true;
          if (capabilityKind === 'color' && (c.id === 'color_hsv' || c.kind === 'color_hsv'))
            return true;
          if (capabilityKind === 'color_hsv' && (c.id === 'color' || c.kind === 'color'))
            return true;
          if (capabilityKind === 'remote' && (c.id === 'remote_key' || c.kind === 'remote_key'))
            return true;
          if (capabilityKind === 'remote_key' && (c.id === 'remote' || c.kind === 'remote'))
            return true;
          return false;
        })
      : true;

    if (!SUPPORTED_HOMEBRIDGE_CAPABILITIES.has(capabilityKind) || !endpointSupports) {
      const record: Omit<UnsupportedCapability, 'reportedAt'> = {
        runtime: 'homebridge',
        pluginId: deviceId.split(':')[1] ?? 'unknown',
        deviceId,
        capability: capabilityKind,
        reason: 'unsupported_hap_capability_command',
      };
      this.unsupported.push(record);
      this.emit('unsupportedCapability', record);
      if (isCommandObj) {
        throw new Error(`kitsune_unsupported_capability:${capabilityKind}`);
      }
      return false;
    }

    const acc = this.accessories.get(deviceId);
    if (!acc) return false;

    const res = executeAccessoryCommand(
      acc,
      capabilityKind,
      value,
      isCommandObj ? deviceIdOrCmd.parameters : undefined,
      normalizedEndpointId,
    );
    if (res instanceof Promise) {
      return res.then((handled) => {
        if (!handled && isCommandObj) {
          throw new Error(`kitsune_unsupported_capability:${capabilityKind}`);
        }
        return handled;
      });
    }
    if (!res && isCommandObj) {
      throw new Error(`kitsune_unsupported_capability:${capabilityKind}`);
    }
    return res;
  }
}
