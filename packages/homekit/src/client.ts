/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { HapClient as HomebridgeHapClient } from '@homebridge/hap-client';
import type { HausDevice } from '@haus/core';
import { onOffCapability } from '@haus/core';
import { decodeHomeKitSetupUri, normalizeHomeKitPin } from './setup-payload.js';
import {
  HomeKitCategory,
  type HapBatchUpdateRequest,
  type HapBatchUpdateResponse,
} from './types.js';
import { createBonjour, type BonjourService } from './hap-client/crypto.js';
import {
  computeHomeKitSetupHash,
  sweepHomeKitMdns,
  type DiscoveredHomeKitWithHash,
} from './hap-client/mdns-sweep.js';
import {
  HapEncryptedSession,
  performHapPairSetup,
  type HapPairingRecord,
} from './hap-client/session.js';
import {
  Characteristics,
  Services,
  applyHapCharacteristicValue,
  convertHapAccessoriesToHaus,
  normalizeHapUuid,
  type ConvertedHapTopology,
  type HapCharacteristicBinding,
} from './hap-client/converter.js';

export {
  HomebridgeHapClient,
  Characteristics,
  Services,
  HapEncryptedSession,
  performHapPairSetup,
  convertHapAccessoriesToHaus,
  applyHapCharacteristicValue,
  normalizeHapUuid,
  type HapPairingRecord,
  type ConvertedHapTopology,
  type HapCharacteristicBinding,
};

export interface DiscoveredHomeKitAccessory {
  readonly id: string;
  readonly name: string;
  readonly model?: string;
  readonly address: string;
  readonly port: number;
  readonly category: HomeKitCategory;
  readonly paired: boolean;
  readonly configNumber: number;
  readonly setupHash?: string;
}

export interface HAPPairingOptions {
  readonly pin: string; // "XXX-XX-XXX", "XXXXXXXX", or "X-HM://..."
  readonly address?: string;
  readonly port?: number;
  readonly name?: string;
}

function selectIPv4Address(service: BonjourService): string | undefined {
  const addresses = service.addresses ?? [];
  return (
    addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('127.')) ??
    addresses[0] ??
    service.host
  );
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

  /**
   * Scans the local network for `_hap._tcp` accessories using both `bonjour-hap`
   * multicast and unicast UDP-5353 subnet sweep (so Docker/WSL2 and multi-subnet
   * Wi-Fi meshes discover accessories reliably).
   */
  public async discoverFromNetwork(timeoutMs = 2500): Promise<DiscoveredHomeKitAccessory[]> {
    const bonjour = createBonjour();
    const bonjourPromise = new Promise<void>((resolve) => {
      const browser = bonjour.find({ type: 'hap' }, (service: BonjourService) => {
        const txt = service.txt ?? {};
        const id = (txt.id ?? txt.ID ?? '').toUpperCase();
        const address = selectIPv4Address(service);
        if (!id || !address || !service.port) return;

        const sf = parseInt(txt.sf ?? '1', 10);
        const ci = parseInt(txt.ci ?? '1', 10);
        const cNum = parseInt(txt['c#'] ?? '1', 10);

        const entry: DiscoveredHomeKitAccessory = {
          id,
          name: service.name || txt.md || id,
          model: txt.md,
          address,
          port: service.port,
          category: (Number.isFinite(ci) ? ci : HomeKitCategory.OTHER) as HomeKitCategory,
          paired: sf === 0,
          configNumber: Number.isFinite(cNum) ? cNum : 1,
          setupHash: txt.sh ?? txt.SH,
        };
        this.discovered.set(id, entry);
      });

      browser.start();
      setTimeout(() => {
        try {
          browser.stop();
          bonjour.destroy();
        } catch {
          // ignore cleanup error
        }
        resolve();
      }, timeoutMs);
    });

    const swept: DiscoveredHomeKitWithHash[] = await Promise.all([
      sweepHomeKitMdns(timeoutMs).catch(() => []),
      bonjourPromise,
    ]).then(([s]) => s);

    for (const item of swept) {
      this.discovered.set(item.id.toUpperCase(), item);
    }

    return this.getDiscovered();
  }

  /**
   * Pairs a HomeKit accessory using ONLY a Setup Code (`8169 1935` / `816-91-935`)
   * or Setup URI (`X-HM://...`) without requiring `accessoryId`, `address`, or `port` upfront.
   */
  public async pairByCodeOnly(
    codeOrUri: string,
    options?: { address?: string; port?: number; name?: string; timeoutMs?: number },
  ): Promise<{
    pairing: HapPairingRecord;
    session: HapEncryptedSession;
    topology: ConvertedHapTopology;
  }> {
    let rawPin = codeOrUri.trim();
    let setupId: string | undefined;

    if (rawPin.toUpperCase().startsWith('X-HM://')) {
      const decoded = decodeHomeKitSetupUri(rawPin.toUpperCase());
      rawPin = decoded.pin;
      setupId = decoded.setupId;
    }

    const pin = normalizeHomeKitPin(rawPin.replace(/\s+/g, ''));
    if (!pin) {
      throw new Error(`Invalid HomeKit PIN format: '${codeOrUri}'`);
    }

    if (options?.address && options?.port) {
      const syntheticId = `MANUAL-${options.address}-${options.port}`;
      return this.pairNetworkAccessory(syntheticId, {
        pin,
        address: options.address,
        port: options.port,
        name: options.name,
      });
    }

    const discovered = await this.discoverFromNetwork(options?.timeoutMs ?? 2500);
    const unpaired = discovered.filter((d) => !d.paired);
    if (unpaired.length === 0) {
      throw new Error(
        'No unpaired HomeKit accessories (sf=1) found on the local network. Ensure the accessory is powered on, connected to Wi-Fi/LAN, and in HomeKit pairing mode.',
      );
    }

    // Prioritize accessories matching the X-HM:// setupHash if present
    const candidates = [...unpaired].sort((a, b) => {
      if (!setupId) return 0;
      const aMatch = a.setupHash && computeHomeKitSetupHash(setupId, a.id) === a.setupHash ? -1 : 0;
      const bMatch = b.setupHash && computeHomeKitSetupHash(setupId, b.id) === b.setupHash ? -1 : 0;
      return aMatch - bMatch;
    });

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        return await this.pairNetworkAccessory(candidate.id, {
          pin,
          address: candidate.address,
          port: candidate.port,
          name: options?.name ?? candidate.name,
        });
      } catch (err) {
        errors.push(
          `${candidate.name} (${candidate.address}:${candidate.port}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    throw new Error(`Failed to pair with any discovered HomeKit accessory: ${errors.join('; ')}`);
  }

  /**
   * Executes real HAP Pair-Setup (M1..M6), Pair-Verify (M1..M4), and GET /accessories
   * against a live HomeKit accessory or bridge over TCP.
   */
  public async pairNetworkAccessory(
    accessoryId: string,
    options: HAPPairingOptions,
  ): Promise<{
    pairing: HapPairingRecord;
    session: HapEncryptedSession;
    topology: ConvertedHapTopology;
  }> {
    const disc = this.discovered.get(accessoryId);
    const address = options.address ?? disc?.address;
    const port = options.port ?? disc?.port;
    const name = options.name ?? disc?.name ?? accessoryId;

    if (!address || !port) {
      throw new Error(`HomeKit accessory '${accessoryId}' address/port not known`);
    }

    const pin = normalizeHomeKitPin(options.pin.replace(/\s+/g, ''));
    if (!pin) {
      throw new Error(`Invalid HomeKit PIN format: '${options.pin}'`);
    }

    const pairing = await performHapPairSetup({
      accessoryId,
      address,
      port,
      pin,
    });

    const { session, topology } = await this.connectPairedAccessory(pairing, name);
    for (const dev of topology.devices) {
      this.pairedDevices.set(dev.id, dev);
    }
    return { pairing, session, topology };
  }

  /**
   * Connects to an already-paired HomeKit accessory/bridge via Pair-Verify,
   * fetches `/accessories`, and subscribes to characteristic events.
   */
  public async connectPairedAccessory(
    pairing: HapPairingRecord,
    nameFallback = pairing.accessoryId,
  ): Promise<{
    session: HapEncryptedSession;
    topology: ConvertedHapTopology;
  }> {
    const session = new HapEncryptedSession(pairing);
    await session.connect();
    const rawAccessories = await session.getAccessories();
    const topology = convertHapAccessoriesToHaus(
      pairing.accessoryId,
      nameFallback,
      pairing.address,
      pairing.port,
      rawAccessories,
    );

    const eventTargets = topology.bindings
      .filter((b) => b.eventable)
      .map((b) => ({ aid: b.aid, iid: b.iid, ev: true }));

    if (eventTargets.length > 0) {
      try {
        await session.putCharacteristics(eventTargets);
      } catch {
        // Non-fatal if an accessory rejects batch event subscription
      }
    }

    return { session, topology };
  }

  public async pairAccessory(accessoryId: string, options: HAPPairingOptions): Promise<HausDevice> {
    const accessory = this.discovered.get(accessoryId);
    if (!accessory) {
      throw new Error(`HomeKit accessory '${accessoryId}' not found in discovery list`);
    }

    const pin = normalizeHomeKitPin(options.pin.replace(/\s+/g, ''));
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
