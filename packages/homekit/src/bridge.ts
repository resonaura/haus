/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice, ProtocolCommandTarget } from '@haus/core';
import { DeterministicIidManager } from './iid.js';
import { guardHomeKitTxtRecord } from './mdns-guard.js';
import { encodeHomeKitSetupUri } from './setup-payload.js';
import { HomeKitCategory, type HomeKitTxtRecord } from './types.js';

export interface HAPBridgeConfig {
  readonly name: string;
  readonly pin: string; // "XXX-XX-XXX"
  readonly setupId: string; // 4 alphanumeric chars
  readonly port?: number;
  readonly username: string; // "XX:XX:XX:XX:XX:XX"
}

export interface BridgedAccessorySummary {
  readonly id: string;
  readonly name: string;
  readonly category: HomeKitCategory;
  readonly serviceType: string;
}

/**
 * Multi-Accessory Bridge aggregating Haus devices into Apple HomeKit bridged accessories.
 */
export class HAPBridge {
  private readonly config: HAPBridgeConfig;
  private readonly iidManager: DeterministicIidManager;
  private readonly accessories = new Map<string, HausDevice>();
  private readonly commandHandler?: (target: ProtocolCommandTarget) => Promise<boolean>;
  private _running = false;
  private _configNumber = 1;

  constructor(
    config: HAPBridgeConfig,
    options: {
      iidManager?: DeterministicIidManager;
      onCommand?: (target: ProtocolCommandTarget) => Promise<boolean>;
    } = {},
  ) {
    this.config = config;
    this.iidManager = options.iidManager ?? new DeterministicIidManager();
    this.commandHandler = options.onCommand;
  }

  public get isRunning(): boolean {
    return this._running;
  }

  public get setupUri(): string {
    return encodeHomeKitSetupUri({
      pin: this.config.pin,
      setupId: this.config.setupId,
      category: HomeKitCategory.BRIDGE,
    });
  }

  public getTxtRecord(): HomeKitTxtRecord {
    const raw: HomeKitTxtRecord = {
      md: `${this.config.name} Bridge`,
      pv: '1.1',
      id: this.config.username,
      'c#': this._configNumber,
      's#': 1,
      sf: 1, // 1 = Discoverable for pairing
      ff: 0,
      ci: HomeKitCategory.BRIDGE,
    };
    return guardHomeKitTxtRecord(raw);
  }

  public static readonly MAX_BRIDGED_ACCESSORIES = 149;

  public async addDevice(device: HausDevice): Promise<BridgedAccessorySummary> {
    if (
      this.accessories.size >= HAPBridge.MAX_BRIDGED_ACCESSORIES &&
      !this.accessories.has(device.id)
    ) {
      throw new Error(
        `Cannot bridge more than ${HAPBridge.MAX_BRIDGED_ACCESSORIES} accessories on a single HAP bridge`,
      );
    }

    if (
      device.relationships?.some((r) => r.type === 'bridge') ||
      (device.category === 'network' && device.name.toLowerCase().includes('bridge'))
    ) {
      throw new Error(`Cannot bridge an accessory that is already a bridge: ${device.id}`);
    }

    this.accessories.set(device.id, device);

    const category = this.mapCategory(device);
    const serviceType = this.mapServiceType(device);

    // Allocate deterministic IIDs for accessory and its core service
    await this.iidManager.allocateIid(device.id, 'service:accessory_info');
    await this.iidManager.allocateIid(device.id, `service:${serviceType}`);

    this._configNumber++;
    return {
      id: device.id,
      name: device.name,
      category,
      serviceType,
    };
  }

  public removeDevice(deviceId: string): boolean {
    const removed = this.accessories.delete(deviceId);
    if (removed) {
      this._configNumber++;
    }
    return removed;
  }

  public getBridgedDevices(): HausDevice[] {
    return Array.from(this.accessories.values());
  }

  public async handleCharacteristicWrite(
    deviceId: string,
    endpointId: string,
    capability: string,
    value: unknown,
  ): Promise<boolean> {
    if (!this.commandHandler) return false;
    const target: ProtocolCommandTarget = {
      deviceId,
      endpointId,
      capability,
      value,
    };
    return this.commandHandler(target);
  }

  public async start(): Promise<void> {
    this._running = true;
  }

  public async stop(): Promise<void> {
    this._running = false;
  }

  private mapCategory(device: HausDevice): HomeKitCategory {
    switch (device.category) {
      case 'lighting':
        return HomeKitCategory.LIGHTBULB;
      case 'power':
        return HomeKitCategory.SWITCH;
      case 'covers':
        return HomeKitCategory.WINDOW_COVERING;
      case 'climate':
        return HomeKitCategory.THERMOSTAT;
      case 'environmental_sensors':
      case 'occupancy_sensors':
      case 'safety_sensors':
        return HomeKitCategory.SENSOR;
      case 'security':
        return HomeKitCategory.DOOR_LOCK;
      default:
        return HomeKitCategory.OTHER;
    }
  }

  private mapServiceType(device: HausDevice): string {
    switch (device.category) {
      case 'lighting':
        return 'Lightbulb';
      case 'power':
        return 'Switch';
      case 'covers':
        return 'WindowCovering';
      case 'climate':
        return 'Thermostat';
      case 'occupancy_sensors':
        return 'MotionSensor';
      case 'security':
        return 'LockMechanism';
      default:
        return 'Switch';
    }
  }
}
