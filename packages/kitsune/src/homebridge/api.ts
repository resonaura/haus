/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { HausDevice } from '@haus/core/device';
import { MockAccessory, type MockService, HAPServices, HAPCharacteristics } from './hap.js';
import type { KitsuneCommandPayload, UnsupportedCapability } from '../engine.js';
import { generateHapUuid } from './uuid.js';
import { HomebridgeAccessoryCache } from './cache.js';
import { SUPPORTED_HOMEBRIDGE_CAPABILITIES } from './types.js';
import { projectAccessoryToHausDevice, executeAccessoryCommand } from './projection.js';

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
  readonly storagePath: string;
  readonly user: { storagePath: () => string; configPath: () => string };
  readonly hap = {
    Service: HAPServices,
    Characteristic: HAPCharacteristics,
    Accessory: MockAccessory,
    uuid: { generate: generateHapUuid },
  };

  private registeredAccessories = new Map<string, AccessoryConstructor>();
  private registeredPlatforms = new Map<string, PlatformConstructor>();
  private devices = new Map<string, HausDevice>();
  private accessories = new Map<string, MockAccessory>();
  private unsupported: Omit<UnsupportedCapability, 'reportedAt'>[] = [];
  private pendingCacheOp: Promise<void> = Promise.resolve();

  constructor(options?: { storagePath?: string }) {
    super();
    this.storagePath = options?.storagePath ?? '/tmp/homebridge';
    this.user = {
      storagePath: () => this.storagePath,
      configPath: () => join(this.storagePath, 'config.json'),
    };
  }

  getPlatformConstructor(
    pluginName: string,
    platformName: string,
  ): PlatformConstructor | undefined {
    return this.registeredPlatforms.get(`${pluginName}.${platformName}`);
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

  registerPlatform(
    pluginName: string,
    platformName: string,
    constructor: PlatformConstructor,
  ): void {
    const key = `${pluginName}.${platformName}`;
    this.registeredPlatforms.set(key, constructor);
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
    for (const acc of accessories) {
      this.ingestAccessory(pluginName, acc);
    }
    this.pendingCacheOp = this.pendingCacheOp
      .then(() =>
        HomebridgeAccessoryCache.save(this.storagePath, pluginName, platformName, accessories),
      )
      .catch(() => {});
  }

  unregisterPlatformAccessories(
    _pluginName: string,
    _platformName: string,
    accessories: MockAccessory[],
  ): void {
    for (const acc of accessories) {
      const deviceId = `homebridge:${_pluginName}:${acc.UUID}`;
      this.devices.delete(deviceId);
      this.accessories.delete(deviceId);
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
    const deviceId = `homebridge:${pluginName}:${acc.UUID}`;
    this.accessories.set(deviceId, acc);

    const { device, unsupported } = projectAccessoryToHausDevice(
      pluginName,
      acc,
      (devId, endpointId, readings) => {
        const currentDevice = this.devices.get(devId);
        if (currentDevice) {
          const updatedEndpoints = currentDevice.endpoints.map((ep) =>
            ep.id === endpointId ? { ...ep, readings: { ...ep.readings, ...readings } } : ep,
          );
          this.devices.set(devId, { ...currentDevice, endpoints: updatedEndpoints });
        }
        this.emit('deviceStateChanged', devId, readings);
        this.emit('devicesChanged', this.getDevices());
      },
    );

    for (const record of unsupported) {
      this.unsupported.push(record);
      this.emit('unsupportedCapability', record);
    }

    this.devices.set(deviceId, device);
    this.emit('deviceDiscovered', device);
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
    const endpoint = device?.endpoints.find((ep) => ep.id === endpointId);
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
