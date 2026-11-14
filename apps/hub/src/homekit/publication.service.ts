/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import {
  HomeKitPublicationManager,
  type BridgedAccessorySummary,
  type DeviceHapMapping,
  type HomeKitBridgeIdentity,
  type HomeKitPublicationStorage,
  type HomeKitSetupData,
  type HomeKitStandaloneIdentity,
  type PublicationGraphAuditReport,
  type PublishedAccessoryOverview,
} from '@haus/homekit';
import type { HausDevice } from '@haus/core';
import { HomeKitIdentityStore } from './identity-store.js';
import { Transactions } from '../storage/transactions.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { ClusterSyncService } from '../cluster/sync/service.js';

class HubDatabasePublicationStorage implements HomeKitPublicationStorage {
  private readonly store?: HomeKitIdentityStore;
  private inMemoryBridge: HomeKitBridgeIdentity | null = null;
  private readonly inMemoryStandalone = new Map<string, HomeKitStandaloneIdentity>();

  constructor(
    transactions?: Transactions,
    private readonly onIdentityChanged?: (identityId: string) => void,
  ) {
    if (transactions) {
      this.store = new HomeKitIdentityStore(transactions);
    }
  }

  async getBridgeIdentity(id = 'haus-bridge'): Promise<HomeKitBridgeIdentity | null> {
    if (this.store) {
      const items = await this.store.list();
      const found = items.find((i) => i.cameraId === id);
      if (found?.value) {
        try {
          return JSON.parse(found.value) as HomeKitBridgeIdentity;
        } catch {
          return null;
        }
      }
      return null;
    }
    return this.inMemoryBridge;
  }

  async saveBridgeIdentity(identity: HomeKitBridgeIdentity): Promise<void> {
    if (this.store) {
      await this.store.save(identity.id, JSON.stringify(identity));
      this.onIdentityChanged?.(identity.id);
      return;
    }
    this.inMemoryBridge = identity;
    this.onIdentityChanged?.(identity.id);
  }

  async getStandaloneIdentity(id: string): Promise<HomeKitStandaloneIdentity | null> {
    if (this.store) {
      const items = await this.store.list();
      const found = items.find((i) => i.cameraId === `standalone:${id}`);
      if (found?.value) {
        try {
          return JSON.parse(found.value) as HomeKitStandaloneIdentity;
        } catch {
          return null;
        }
      }
      return null;
    }
    return this.inMemoryStandalone.get(id) ?? null;
  }

  async listStandaloneIdentities(): Promise<readonly HomeKitStandaloneIdentity[]> {
    if (this.store) {
      const items = await this.store.list();
      const results: HomeKitStandaloneIdentity[] = [];
      for (const item of items) {
        if (item.cameraId.startsWith('standalone:')) {
          try {
            results.push(JSON.parse(item.value) as HomeKitStandaloneIdentity);
          } catch {
            // Ignore malformed JSON
          }
        }
      }
      return results;
    }
    return Array.from(this.inMemoryStandalone.values());
  }

  async saveStandaloneIdentity(identity: HomeKitStandaloneIdentity): Promise<void> {
    if (this.store) {
      await this.store.save(`standalone:${identity.id}`, JSON.stringify(identity));
      this.onIdentityChanged?.(`standalone:${identity.id}`);
      return;
    }
    this.inMemoryStandalone.set(identity.id, identity);
    this.onIdentityChanged?.(`standalone:${identity.id}`);
  }

  async deleteStandaloneIdentity(id: string): Promise<void> {
    if (this.store) {
      await this.store.delete(`standalone:${id}`);
      this.onIdentityChanged?.(`standalone:${id}`);
      return;
    }
    this.inMemoryStandalone.delete(id);
    this.onIdentityChanged?.(`standalone:${id}`);
  }
}

@Injectable()
export class HomeKitPublicationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HomeKitPublicationService.name);
  public readonly manager: HomeKitPublicationManager;

  constructor(
    @Optional() private readonly transactions?: Transactions,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(ClusterSyncService)
    private readonly syncService?: ClusterSyncService,
  ) {
    const storage = new HubDatabasePublicationStorage(this.transactions, (identityId) => {
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange('credential', `homekit:${identityId}`)
        .catch(() => undefined);
    });
    this.manager = new HomeKitPublicationManager({ storage });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.manager.initialize();
      this.logger.log('HomeKit publication manager initialized successfully');
    } catch (err: unknown) {
      this.logger.error(`Failed to initialize HomeKit publication manager: ${err}`);
    }
  }

  public getBridgeSetup(): HomeKitSetupData {
    return this.manager.getBridgeSetupData();
  }

  public getBridgedDevices(): readonly HausDevice[] {
    return this.manager.getBridgedDevices();
  }

  public async addDeviceToBridge(deviceId: string): Promise<BridgedAccessorySummary> {
    const device = await this.resolveDevice(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return this.manager.addDeviceToBridge(device);
  }

  public async removeDeviceFromBridge(deviceId: string): Promise<boolean> {
    return this.manager.removeDeviceFromBridge(deviceId);
  }

  public async selectBridgeDevices(
    deviceIds: readonly string[],
  ): Promise<PublicationGraphAuditReport> {
    const devices: HausDevice[] = [];
    for (const id of deviceIds) {
      const d = await this.resolveDevice(id);
      if (d) devices.push(d);
    }
    return this.manager.selectBridgeDevices(devices);
  }

  public async resetBridgePairing(): Promise<HomeKitSetupData> {
    return this.manager.resetBridgePairing();
  }

  public async reauthorizeBridge(
    allowedControllerIds: readonly string[],
  ): Promise<HomeKitBridgeIdentity> {
    return this.manager.reauthorizeBridge(allowedControllerIds);
  }

  public listPublishedAccessories(): readonly PublishedAccessoryOverview[] {
    return this.manager.listPublishedAccessories();
  }

  public async getDeviceMapping(deviceId: string): Promise<DeviceHapMapping> {
    const device = await this.resolveDevice(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return this.manager.getDeviceMapping(device);
  }

  public async publishStandaloneCamera(
    deviceId: string,
    port?: number,
  ): Promise<HomeKitStandaloneIdentity> {
    const device = await this.resolveDevice(deviceId);
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return this.manager.publishStandaloneCamera(device, port);
  }

  public async unpublishStandalone(id: string): Promise<boolean> {
    return this.manager.unpublishStandalone(id);
  }

  public getStandaloneSetupData(id: string): HomeKitSetupData | null {
    return this.manager.getStandaloneSetupData(id);
  }

  public async resetStandalonePairing(id: string): Promise<HomeKitSetupData> {
    return this.manager.resetStandalonePairing(id);
  }

  public async reauthorizeStandalone(
    id: string,
    allowedControllerIds: readonly string[],
  ): Promise<HomeKitStandaloneIdentity> {
    return this.manager.reauthorizeStandalone(id, allowedControllerIds);
  }

  private async resolveDevice(deviceId: string): Promise<HausDevice | null> {
    if (!this.homeService) return null;
    const snap = await this.homeService.getDevice(deviceId);
    return snap ?? null;
  }
}
