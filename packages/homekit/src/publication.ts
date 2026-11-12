/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '@haus/core';
import { HAPBridge, type BridgedAccessorySummary } from './bridge.js';
import { HAPStandalone } from './standalone.js';
import { HomeKitCategory } from './types.js';
import { encodeHomeKitSetupUri } from './setup-payload.js';
import {
  auditPublicationGraph,
  evaluatePublicationRoute,
  type PublicationGraphAuditReport,
} from './publication-graph.js';
import { mapDeviceToHap, type DeviceHapMapping } from './mapping.js';

export interface HomeKitPairedController {
  readonly id: string;
  readonly publicKey: string;
  readonly permissions: number;
}

export interface HomeKitBridgeIdentity {
  readonly id: string;
  readonly name: string;
  readonly username: string; // MAC format "XX:XX:XX:XX:XX:XX"
  readonly pin: string; // "XXX-XX-XXX"
  readonly setupId: string; // 4 alphanumeric chars
  readonly port: number;
  readonly configNumber: number;
  readonly pairedControllers: readonly HomeKitPairedController[];
}

export interface HomeKitStandaloneIdentity {
  readonly id: string;
  readonly name: string;
  readonly category: HomeKitCategory;
  readonly username: string;
  readonly pin: string;
  readonly setupId: string;
  readonly port: number;
  readonly configNumber: number;
  readonly pairedControllers: readonly HomeKitPairedController[];
}

export interface HomeKitPublicationStorage {
  getBridgeIdentity(id?: string): Promise<HomeKitBridgeIdentity | null>;
  saveBridgeIdentity(identity: HomeKitBridgeIdentity): Promise<void>;
  getStandaloneIdentity(id: string): Promise<HomeKitStandaloneIdentity | null>;
  listStandaloneIdentities(): Promise<readonly HomeKitStandaloneIdentity[]>;
  saveStandaloneIdentity(identity: HomeKitStandaloneIdentity): Promise<void>;
  deleteStandaloneIdentity(id: string): Promise<void>;
}

export interface HomeKitSetupData {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly pin: string;
  readonly setupId: string;
  readonly setupUri: string;
  readonly paired: boolean;
  readonly controllerCount: number;
  readonly category: HomeKitCategory;
}

export interface PublishedAccessoryOverview {
  readonly id: string;
  readonly name: string;
  readonly kind: 'bridge' | 'standalone';
  readonly paired: boolean;
  readonly controllerCount: number;
  readonly setupUri: string;
  readonly mapping: DeviceHapMapping | null;
}

/**
 * Unified Apple HomeKit Publication Manager.
 * Orchestrates multi-accessory bridge publishing, standalone camera publication,
 * persistent identities and pairing states, removal/reset/reauthorization,
 * and transparent capability-to-characteristic mapping.
 */
export class HomeKitPublicationManager {
  private readonly storage: HomeKitPublicationStorage;
  private bridgeIdentity!: HomeKitBridgeIdentity;
  private readonly standaloneIdentities = new Map<string, HomeKitStandaloneIdentity>();
  private hapBridge!: HAPBridge;
  private readonly hapStandalone = new HAPStandalone();
  private readonly bridgedDevices = new Map<string, HausDevice>();

  constructor(options: { storage: HomeKitPublicationStorage }) {
    this.storage = options.storage;
  }

  public async initialize(): Promise<void> {
    // 1. Load or initialize bridge identity
    let loadedBridge = await this.storage.getBridgeIdentity('haus-bridge');
    if (!loadedBridge) {
      loadedBridge = {
        id: 'haus-bridge',
        name: 'Haus Bridge',
        username: '00:11:22:33:44:55',
        pin: '031-45-154',
        setupId: 'HAUS',
        port: 51826,
        configNumber: 1,
        pairedControllers: [],
      };
      await this.storage.saveBridgeIdentity(loadedBridge);
    }
    this.bridgeIdentity = loadedBridge;

    this.hapBridge = new HAPBridge({
      name: this.bridgeIdentity.name,
      pin: this.bridgeIdentity.pin,
      setupId: this.bridgeIdentity.setupId,
      username: this.bridgeIdentity.username,
      port: this.bridgeIdentity.port,
    });

    // 2. Load standalone identities
    const standaloneList = await this.storage.listStandaloneIdentities();
    for (const item of standaloneList) {
      this.standaloneIdentities.set(item.id, item);
      this.hapStandalone.register({
        id: item.id,
        name: item.name,
        category: item.category,
        pin: item.pin,
        setupId: item.setupId,
        username: item.username,
        port: item.port,
      });
    }
  }

  public getBridgeSetupData(): HomeKitSetupData {
    return {
      id: this.bridgeIdentity.id,
      name: this.bridgeIdentity.name,
      username: this.bridgeIdentity.username,
      pin: this.bridgeIdentity.pin,
      setupId: this.bridgeIdentity.setupId,
      setupUri: this.hapBridge.setupUri,
      paired: this.bridgeIdentity.pairedControllers.length > 0,
      controllerCount: this.bridgeIdentity.pairedControllers.length,
      category: HomeKitCategory.BRIDGE,
    };
  }

  public getBridgedDevices(): readonly HausDevice[] {
    return Array.from(this.bridgedDevices.values());
  }

  public async addDeviceToBridge(device: HausDevice): Promise<BridgedAccessorySummary> {
    const summary = await this.hapBridge.addDevice(device);
    this.bridgedDevices.set(device.id, device);

    this.bridgeIdentity = {
      ...this.bridgeIdentity,
      configNumber: this.bridgeIdentity.configNumber + 1,
    };
    await this.storage.saveBridgeIdentity(this.bridgeIdentity);

    return summary;
  }

  public async removeDeviceFromBridge(deviceId: string): Promise<boolean> {
    const removedFromBridge = this.hapBridge.removeDevice(deviceId);
    const removedFromMap = this.bridgedDevices.delete(deviceId);

    if (removedFromBridge || removedFromMap) {
      this.bridgeIdentity = {
        ...this.bridgeIdentity,
        configNumber: this.bridgeIdentity.configNumber + 1,
      };
      await this.storage.saveBridgeIdentity(this.bridgeIdentity);
      return true;
    }
    return false;
  }

  public async selectBridgeDevices(
    devices: readonly HausDevice[],
  ): Promise<PublicationGraphAuditReport> {
    const candidateIds = new Set(devices.map((d) => d.id));
    const standaloneIds = new Set(this.standaloneIdentities.keys());

    const audit = auditPublicationGraph(devices, {
      bridgeDeviceIds: candidateIds,
      standaloneDeviceIds: standaloneIds,
    });

    if (!audit.valid) {
      return audit;
    }

    // Clear existing bridge devices and add verified candidates
    for (const existingId of Array.from(this.bridgedDevices.keys())) {
      this.hapBridge.removeDevice(existingId);
      this.bridgedDevices.delete(existingId);
    }

    for (const device of devices) {
      const evaluation = evaluatePublicationRoute(device);
      if (evaluation.eligibleForBridge) {
        await this.hapBridge.addDevice(device);
        this.bridgedDevices.set(device.id, device);
      }
    }

    this.bridgeIdentity = {
      ...this.bridgeIdentity,
      configNumber: this.bridgeIdentity.configNumber + 1,
    };
    await this.storage.saveBridgeIdentity(this.bridgeIdentity);

    return audit;
  }

  public async resetBridgePairing(): Promise<HomeKitSetupData> {
    const nextSetupId = this.generateSetupId();
    const nextPin = this.generatePin();

    this.bridgeIdentity = {
      ...this.bridgeIdentity,
      pin: nextPin,
      setupId: nextSetupId,
      configNumber: this.bridgeIdentity.configNumber + 1,
      pairedControllers: [],
    };
    await this.storage.saveBridgeIdentity(this.bridgeIdentity);

    // Reinstantiate HAPBridge with clean pairing state
    this.hapBridge = new HAPBridge({
      name: this.bridgeIdentity.name,
      pin: this.bridgeIdentity.pin,
      setupId: this.bridgeIdentity.setupId,
      username: this.bridgeIdentity.username,
      port: this.bridgeIdentity.port,
    });

    // Re-bridge existing devices
    for (const device of this.bridgedDevices.values()) {
      await this.hapBridge.addDevice(device);
    }

    return this.getBridgeSetupData();
  }

  public async reauthorizeBridge(
    allowedControllerIds: readonly string[],
  ): Promise<HomeKitBridgeIdentity> {
    const allowedSet = new Set(allowedControllerIds);
    const retained = this.bridgeIdentity.pairedControllers.filter((c) => allowedSet.has(c.id));

    this.bridgeIdentity = {
      ...this.bridgeIdentity,
      pairedControllers: retained,
    };
    await this.storage.saveBridgeIdentity(this.bridgeIdentity);
    return this.bridgeIdentity;
  }

  public async publishStandaloneCamera(
    device: HausDevice,
    port = 51830,
  ): Promise<HomeKitStandaloneIdentity> {
    const existing = this.standaloneIdentities.get(device.id);
    if (existing) {
      return existing;
    }

    const pin = this.generatePin();
    const setupId = this.generateSetupId();
    const macSuffix = Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
    const username = `00:11:22:33:44:${macSuffix}`.toUpperCase();

    const identity: HomeKitStandaloneIdentity = {
      id: device.id,
      name: device.name,
      category: HomeKitCategory.IP_CAMERA,
      username,
      pin,
      setupId,
      port,
      configNumber: 1,
      pairedControllers: [],
    };

    this.hapStandalone.registerDevice(device, {
      pin,
      setupId,
      username,
      port,
    });

    this.standaloneIdentities.set(device.id, identity);
    await this.storage.saveStandaloneIdentity(identity);

    return identity;
  }

  public async unpublishStandalone(id: string): Promise<boolean> {
    await this.hapStandalone.stop(id);
    const deleted = this.standaloneIdentities.delete(id);
    if (deleted) {
      await this.storage.deleteStandaloneIdentity(id);
    }
    return deleted;
  }

  public getStandaloneSetupData(id: string): HomeKitSetupData | null {
    const identity = this.standaloneIdentities.get(id);
    if (!identity) return null;

    const setupUri = encodeHomeKitSetupUri({
      pin: identity.pin,
      setupId: identity.setupId,
      category: identity.category,
    });

    return {
      id: identity.id,
      name: identity.name,
      username: identity.username,
      pin: identity.pin,
      setupId: identity.setupId,
      setupUri,
      paired: identity.pairedControllers.length > 0,
      controllerCount: identity.pairedControllers.length,
      category: identity.category,
    };
  }

  public async resetStandalonePairing(id: string): Promise<HomeKitSetupData> {
    const identity = this.standaloneIdentities.get(id);
    if (!identity) {
      throw new Error(`Standalone accessory not found: ${id}`);
    }

    const nextPin = this.generatePin();
    const nextSetupId = this.generateSetupId();

    const updated: HomeKitStandaloneIdentity = {
      ...identity,
      pin: nextPin,
      setupId: nextSetupId,
      configNumber: identity.configNumber + 1,
      pairedControllers: [],
    };

    this.standaloneIdentities.set(id, updated);
    await this.storage.saveStandaloneIdentity(updated);

    this.hapStandalone.register({
      id: updated.id,
      name: updated.name,
      category: updated.category,
      pin: updated.pin,
      setupId: updated.setupId,
      username: updated.username,
      port: updated.port,
    });

    const setupData = this.getStandaloneSetupData(id);
    if (!setupData) throw new Error(`Failed to generate setup data for ${id}`);
    return setupData;
  }

  public async reauthorizeStandalone(
    id: string,
    allowedControllerIds: readonly string[],
  ): Promise<HomeKitStandaloneIdentity> {
    const identity = this.standaloneIdentities.get(id);
    if (!identity) {
      throw new Error(`Standalone accessory not found: ${id}`);
    }

    const allowedSet = new Set(allowedControllerIds);
    const retained = identity.pairedControllers.filter((c) => allowedSet.has(c.id));

    const updated: HomeKitStandaloneIdentity = {
      ...identity,
      pairedControllers: retained,
    };

    this.standaloneIdentities.set(id, updated);
    await this.storage.saveStandaloneIdentity(updated);
    return updated;
  }

  public listPublishedAccessories(): readonly PublishedAccessoryOverview[] {
    const list: PublishedAccessoryOverview[] = [];

    // Add bridge
    const bridgeSetup = this.getBridgeSetupData();
    list.push({
      id: bridgeSetup.id,
      name: bridgeSetup.name,
      kind: 'bridge',
      paired: bridgeSetup.paired,
      controllerCount: bridgeSetup.controllerCount,
      setupUri: bridgeSetup.setupUri,
      mapping: null,
    });

    // Add standalone accessories
    for (const identity of this.standaloneIdentities.values()) {
      const setup = this.getStandaloneSetupData(identity.id);
      list.push({
        id: identity.id,
        name: identity.name,
        kind: 'standalone',
        paired: identity.pairedControllers.length > 0,
        controllerCount: identity.pairedControllers.length,
        setupUri: setup?.setupUri ?? '',
        mapping: null,
      });
    }

    return list;
  }

  public getDeviceMapping(device: HausDevice): DeviceHapMapping {
    return mapDeviceToHap(device);
  }

  private generatePin(): string {
    const n = Math.floor(10000000 + Math.random() * 90000000).toString();
    return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5, 8)}`;
  }

  private generateSetupId(): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let res = '';
    for (let i = 0; i < 4; i++) {
      res += chars[Math.floor(Math.random() * chars.length)];
    }
    return res;
  }
}
