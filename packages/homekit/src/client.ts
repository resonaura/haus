/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '@haus/core';
import { onOffCapability } from '@haus/core';
import { normalizeHomeKitPin } from './setup-payload.js';
import type { HapBatchUpdateRequest, HapBatchUpdateResponse, HomeKitCategory } from './types.js';

export interface DiscoveredHomeKitAccessory {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly port: number;
  readonly category: HomeKitCategory;
  readonly paired: boolean;
  readonly configNumber: number;
}

export interface HAPPairingOptions {
  readonly pin: string; // "XXX-XX-XXX"
}

export class HAPClient {
  private readonly discovered = new Map<string, DiscoveredHomeKitAccessory>();
  private readonly pairedDevices = new Map<string, HausDevice>();

  public registerDiscovered(accessory: DiscoveredHomeKitAccessory): void {
    this.discovered.set(accessory.id, accessory);
  }

  public getDiscovered(): DiscoveredHomeKitAccessory[] {
    return Array.from(this.discovered.values());
  }

  public async pairAccessory(accessoryId: string, options: HAPPairingOptions): Promise<HausDevice> {
    const accessory = this.discovered.get(accessoryId);
    if (!accessory) {
      throw new Error(`HomeKit accessory '${accessoryId}' not found in discovery list`);
    }

    const pin = normalizeHomeKitPin(options.pin);
    if (!pin) {
      throw new Error(`Invalid HomeKit PIN format: '${options.pin}'`);
    }

    // Convert paired HomeKit accessory into unified HausDevice
    const device: HausDevice = {
      id: `hk-${accessory.id.replace(/:/g, '').toLowerCase()}`,
      source: { instanceId: 'homekit-client', externalId: accessory.id },
      name: accessory.name,
      category: 'power',
      connectivity: {
        protocol: 'homekit',
        address: `${accessory.address}:${accessory.port}`,
      },
      availability: 'online',
      endpoints: [
        {
          id: 'primary',
          name: accessory.name,
          capabilities: [onOffCapability],
          readings: {
            on_off: { value: false, freshness: 'live', observedAt: new Date().toISOString() },
          },
        },
      ],
    };

    this.pairedDevices.set(accessoryId, device);
    return device;
  }

  public unpairAccessory(accessoryId: string): boolean {
    return this.pairedDevices.delete(accessoryId);
  }

  public getPairedDevices(): HausDevice[] {
    return Array.from(this.pairedDevices.values());
  }

  /**
   * Decomposes batch PUT /characteristics requests into per-characteristic updates,
   * returning individual statuses to prevent whole-batch failure when one characteristic fails.
   */
  public async executeBatchUpdate(
    request: HapBatchUpdateRequest,
    updater: (aid: number, iid: number, value: unknown) => Promise<boolean>,
  ): Promise<HapBatchUpdateResponse> {
    const results = await Promise.all(
      request.characteristics.map(async (char) => {
        try {
          const success = await updater(char.aid, char.iid, char.value);
          return {
            aid: char.aid,
            iid: char.iid,
            status: success ? 0 : -70402, // 0 = Success, -70402 = Resource busy/failed
          };
        } catch {
          return {
            aid: char.aid,
            iid: char.iid,
            status: -70402,
          };
        }
      }),
    );

    return { characteristics: results };
  }
}
