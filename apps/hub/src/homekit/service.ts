/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  HAPClient,
  applyHapCharacteristicValue,
  type ConvertedHapTopology,
  type DiscoveredHomeKitAccessory,
  type HapBlePeripheral,
  type HapBleSession,
  type HapCharacteristicBinding,
  type HapEncryptedSession,
  type HapPairingRecord,
} from '@haus/homekit';
import type { HausDevice } from '@haus/core';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';

export interface PersistedHomeKitPairing extends HapPairingRecord {
  readonly name: string;
}

@Injectable()
export class HomeKitControllerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HomeKitControllerService.name);
  public readonly client = new HAPClient();
  private readonly sessions = new Map<string, HapEncryptedSession>();
  private readonly bleSessions = new Map<string, HapBleSession>();
  private readonly pairings = new Map<string, PersistedHomeKitPairing>();
  private readonly endpointBindings = new Map<string, HapCharacteristicBinding[]>();
  private readonly charIndex = new Map<string, HapCharacteristicBinding>();
  private unregisterHapIp?: () => void;
  private unregisterHomekit?: () => void;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.homeService) return;

    const handler = async (
      endpointId: string,
      capability: string,
      command: string,
      parameters?: Record<string, unknown>,
    ) => {
      await this.handleDeviceCommand(endpointId, capability, command, parameters);
    };

    this.unregisterHapIp = this.homeService.registerCommandHandler('hap-ip', handler);
    this.unregisterHomekit = this.homeService.registerCommandHandler('homekit', handler);

    const saved = await this.homeService
      .getPersistence()
      .listByKind<PersistedHomeKitPairing>('homekit_pairing');

    for (const item of saved) {
      if (!item.value?.accessoryId) continue;
      this.pairings.set(item.value.accessoryId, item.value);
      if (item.value.address.startsWith('ble:')) {
        continue;
      }
      void this.reconnectPairing(item.value).catch((err: unknown) => {
        this.logger.warn(
          `Could not connect to paired HomeKit accessory ${item.value.name} (${item.value.accessoryId}): ${err}`,
        );
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unregisterHapIp?.();
    this.unregisterHomekit?.();
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    for (const session of this.bleSessions.values()) {
      session.close();
    }
    this.bleSessions.clear();
  }

  public async discoverAccessories(timeoutMs = 2500): Promise<DiscoveredHomeKitAccessory[]> {
    return this.client.discoverFromNetwork(timeoutMs);
  }

  public listPairings(): PersistedHomeKitPairing[] {
    return Array.from(this.pairings.values());
  }

  public async pairAccessory(params: {
    accessoryId?: string;
    pin: string;
    address?: string;
    port?: number;
    name?: string;
  }): Promise<{
    pairing: PersistedHomeKitPairing;
    devices: readonly HausDevice[];
  }> {
    const rawId = params.accessoryId?.trim().toUpperCase();
    const { pairing, session, topology } = rawId
      ? await this.client.pairNetworkAccessory(rawId, {
          pin: params.pin,
          address: params.address,
          port: params.port,
          name: params.name,
        })
      : await this.client.pairByCodeOnly(params.pin, {
          address: params.address,
          port: params.port,
          name: params.name,
        });
    const cleanId = pairing.accessoryId.trim().toUpperCase();

    const persisted: PersistedHomeKitPairing = {
      ...pairing,
      name: params.name ?? topology.devices[0]?.name ?? cleanId,
    };

    this.pairings.set(cleanId, persisted);
    if (this.homeService) {
      await this.homeService.getPersistence().save('homekit_pairing', cleanId, persisted);
    }

    this.activateSession(cleanId, session, topology);
    this.logger.log(
      `Paired HomeKit accessory "${persisted.name}" (${cleanId}) with ${topology.devices.length} devices`,
    );

    return { pairing: persisted, devices: topology.devices };
  }

  public async pairBleAccessory(
    peripheral: HapBlePeripheral,
    pin: string,
    name?: string,
  ): Promise<{
    pairing: PersistedHomeKitPairing;
    devices: readonly HausDevice[];
  }> {
    const { pairing, session, device } = await this.client.pairBleAccessory(peripheral, pin);
    const cleanId = pairing.accessoryId.trim().toUpperCase();
    const persisted: PersistedHomeKitPairing = {
      ...pairing,
      name: name ?? device.name ?? cleanId,
    };

    this.pairings.set(cleanId, persisted);
    if (this.homeService) {
      await this.homeService.getPersistence().save('homekit_pairing', cleanId, persisted);
      this.homeService.registerDevice(device);
    }

    this.bleSessions.set(cleanId, session);
    this.logger.log(`Paired HAP-BLE accessory "${persisted.name}" (${cleanId})`);
    return { pairing: persisted, devices: [device] };
  }

  public async unpairAccessory(accessoryId: string): Promise<{ removedDeviceIds: string[] }> {
    const cleanId = accessoryId.trim().toUpperCase();
    const session = this.sessions.get(cleanId);
    if (session) {
      session.close();
      this.sessions.delete(cleanId);
    }
    const bleSession = this.bleSessions.get(cleanId);
    if (bleSession) {
      bleSession.close();
      this.bleSessions.delete(cleanId);
    }
    this.pairings.delete(cleanId);
    if (this.homeService) {
      await this.homeService.getPersistence().remove('homekit_pairing', cleanId);
    }

    const slugBase = cleanId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const prefix = `hk_${slugBase}_aid_`;
    const removedDeviceIds: string[] = [];

    if (this.homeService) {
      for (const dev of this.homeService.listDevices()) {
        if (dev.id.startsWith(prefix)) {
          this.homeService.removeDevice(dev.id);
          removedDeviceIds.push(dev.id);
        }
      }
    }

    return { removedDeviceIds };
  }

  private async reconnectPairing(pairing: PersistedHomeKitPairing): Promise<void> {
    const { session, topology } = await this.client.connectPairedAccessory(pairing, pairing.name);
    this.activateSession(pairing.accessoryId, session, topology);
    this.logger.log(
      `Connected to HomeKit accessory "${pairing.name}" (${pairing.accessoryId}, ${topology.devices.length} devices)`,
    );
  }

  private activateSession(
    accessoryId: string,
    session: HapEncryptedSession,
    topology: ConvertedHapTopology,
  ): void {
    const prev = this.sessions.get(accessoryId);
    if (prev && prev !== session) prev.close();
    this.sessions.set(accessoryId, session);

    if (this.homeService) {
      for (const dev of topology.devices) {
        const existing = this.homeService.getDevice(dev.id);
        const preservedRoom =
          existing?.roomId && existing.roomId !== 'unassigned' ? existing.roomId : dev.roomId;
        this.homeService.registerDevice({
          ...dev,
          roomId: preservedRoom,
          areaId: existing?.areaId ?? preservedRoom,
        });
      }
      for (const [epId, state] of topology.initialStates) {
        void this.homeService.updateEndpointState(epId, state, false);
      }
    }

    for (const binding of topology.bindings) {
      const list = this.endpointBindings.get(binding.endpointId) ?? [];
      list.push(binding);
      this.endpointBindings.set(binding.endpointId, list);
      this.charIndex.set(`${accessoryId}:${binding.aid}:${binding.iid}`, binding);
    }

    session.onEvent((events) => {
      if (!this.homeService) return;
      for (const ev of events) {
        const binding = this.charIndex.get(`${accessoryId}:${ev.aid}:${ev.iid}`);
        if (!binding || ev.value === undefined) continue;
        const patch = applyHapCharacteristicValue(binding.charType, binding.capabilityId, ev.value);
        void this.homeService.updateEndpointState(binding.endpointId, patch, true);
      }
    });
  }

  private async handleDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const bindings = this.endpointBindings.get(endpointId) ?? [];
    const target =
      bindings.find((b) => b.capabilityId === capability && b.writable) ??
      bindings.find((b) => b.writable);
    if (!target) {
      throw new Error(`homekit_writable_characteristic_not_found: ${endpointId}`);
    }

    const session = this.sessions.get(target.accessoryId);
    if (!session) {
      throw new Error(`homekit_session_offline: ${target.accessoryId}`);
    }

    const norm = command.toLowerCase();
    let value: unknown = parameters?.value;

    if (target.charType === '25') {
      if (norm === 'turn_on' || norm === 'on') value = true;
      else if (norm === 'turn_off' || norm === 'off') value = false;
      else if (norm === 'set') {
        const raw = parameters?.state ?? parameters?.on_off ?? parameters?.value;
        value = raw === true || raw === 'on' || raw === 1;
      }
    } else if (target.charType === '1E' || target.charType === '1D') {
      value = norm === 'lock' || parameters?.value === 'locked' ? 1 : 0;
    } else if (target.charType === '8' && parameters?.brightness !== undefined) {
      value = Number(parameters.brightness);
    }

    await session.putCharacteristics([{ aid: target.aid, iid: target.iid, value }]);
  }
}
