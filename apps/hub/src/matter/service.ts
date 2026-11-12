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
  MatterWsTransport,
  type MatterWsTransportOptions,
  type MatterAttributeChange,
} from '@haus/matter';
import type { DeviceCategory, HausDevice, SourceDeviceRef } from '@haus/core';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from '../home/home.service.js';
import { HAUS_MATTER_OPTIONS } from './tokens.js';

interface MatterEndpointMapping {
  readonly nodeId: string;
  readonly endpointId: number;
  readonly deviceId: string;
  readonly clusterId: number;
  readonly capabilityId: string;
  readonly deviceType: 'switch' | 'contact' | 'leak' | 'motion' | 'vibration';
}

@Injectable()
export class MatterService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MatterService.name);
  public readonly transport?: MatterWsTransport;
  private readonly endpointMappings = new Map<string, MatterEndpointMapping>(); // hausEndpointId -> mapping
  private readonly pathIndex = new Map<string, string>(); // 'nodeId/ep/cluster/attr' -> hausEndpointId
  private readonly ignoredNodes = new Set<string>();
  private unregisterCommandHandler?: () => void;
  private unsubscribeTransport?: () => void;
  private isStarted = false;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(HAUS_MATTER_OPTIONS)
    options?: MatterWsTransportOptions,
  ) {
    const url = options?.url?.trim() ?? process.env.HAUS_MATTER_URL?.trim();
    this.transport = url ? new MatterWsTransport({ url }) : undefined;
  }

  get isConfigured(): boolean {
    return this.transport !== undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.isStarted) return;
    const transport = this.transport;
    if (!transport) {
      this.logger.log('Matter Server integration is not configured; skipping discovery.');
      return;
    }
    this.isStarted = true;

    if (this.homeService) {
      const savedIgnored = await this.homeService
        .getPersistence()
        .listByKind<{ ignored: boolean }>('ignored_matter_node');
      for (const item of savedIgnored) {
        if (item.value?.ignored) {
          this.ignoredNodes.add(item.entryId);
          this.purgeNodeDevicesFromRegistry(item.entryId);
        }
      }

      this.unregisterCommandHandler = this.homeService.registerCommandHandler(
        'matter',
        async (endpointId, capability, command, parameters) => {
          await this.handleDeviceCommand(endpointId, capability, command, parameters);
        },
      );
    }

    this.unsubscribeTransport = transport.subscribe((change) => {
      this.handleAttributeChange(change);
    });

    try {
      await transport.connect();
      this.logger.log('Connected to Matter Server, discovering Matter nodes...');
      await this.discoverNodes();
    } catch (err) {
      this.logger.warn(
        `Could not connect to Matter Server on initial bootstrap: ${err}. Will retry in background.`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStarted = false;
    if (this.unregisterCommandHandler) {
      this.unregisterCommandHandler();
      this.unregisterCommandHandler = undefined;
    }
    if (this.unsubscribeTransport) {
      this.unsubscribeTransport();
      this.unsubscribeTransport = undefined;
    }
    this.transport?.close();
  }

  public async refreshNodes(): Promise<void> {
    if (!this.transport) throw new Error('matter_server_not_configured');
    await this.discoverNodes();
  }

  public async removeNode(nodeId: string): Promise<{ removedDeviceIds: string[] }> {
    if (!this.transport) throw new Error('matter_server_not_configured');
    const cleanId = String(nodeId).trim();
    this.ignoredNodes.add(cleanId);
    if (this.homeService) {
      await this.homeService
        .getPersistence()
        .save('ignored_matter_node', cleanId, { ignored: true });
    }
    const removedDeviceIds = this.purgeNodeDevicesFromRegistry(cleanId);
    this.logger.log(`Removed Matter node ${cleanId} (${removedDeviceIds.length} devices)`);
    return { removedDeviceIds };
  }

  private purgeNodeDevicesFromRegistry(nodeId: string): string[] {
    if (!this.homeService) return [];
    const prefix = `matter_node_${nodeId}_`;
    const removed: string[] = [];
    for (const dev of this.homeService.listDevices()) {
      if (dev.id.startsWith(prefix)) {
        this.homeService.removeDevice(dev.id);
        removed.push(dev.id);
      }
    }
    return removed;
  }

  private async discoverNodes(): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error('matter_server_not_configured');
    const rawNodes = await transport.getNodes();
    for (const raw of rawNodes) {
      const node = raw as Record<string, unknown>;
      const nodeId = String(node.node_id ?? '');
      if (!nodeId) continue;
      if (this.ignoredNodes.has(nodeId)) {
        this.purgeNodeDevicesFromRegistry(nodeId);
        continue;
      }

      const attrs = (node.attributes as Record<string, unknown>) ?? {};
      this.registerDevicesForNode(nodeId, node, attrs);
    }
  }

  private registerDevicesForNode(
    nodeId: string,
    node: Record<string, unknown>,
    attrs: Record<string, unknown>,
  ): void {
    if (!this.homeService) return;

    const rawPartsList = attrs['0/29/3'];
    const validParts = Array.isArray(rawPartsList)
      ? new Set<number>([0, ...rawPartsList.map((p) => Number(p))])
      : undefined;

    // Discover unique endpoints on this node
    const endpointsSet = new Set<number>();
    for (const key of Object.keys(attrs)) {
      const parts = key.split('/');
      if (parts.length >= 2) {
        const ep = parseInt(parts[0], 10);
        if (!validParts || validParts.has(ep)) {
          endpointsSet.add(ep);
        }
      }
    }

    // Prune stale endpoints no longer in PartsList
    if (validParts) {
      const prefix = `matter_node_${nodeId}_ep_`;
      for (const dev of this.homeService.listDevices()) {
        if (dev.id.startsWith(prefix)) {
          const epNum = parseInt(dev.id.slice(prefix.length), 10);
          if (!validParts.has(epNum)) {
            this.homeService.removeDevice(dev.id);
          }
        }
      }
    }

    // Pre-calculate product name frequencies to disambiguate duplicated names
    const nameCounts = new Map<string, number>();
    for (const ep of endpointsSet) {
      if (ep === 0) continue;
      const rawName = String(attrs[`${ep}/57/3`] ?? attrs[`${ep}/40/3`] ?? `Matter Device ${ep}`);
      nameCounts.set(rawName, (nameCounts.get(rawName) ?? 0) + 1);
    }

    for (const ep of endpointsSet) {
      this.registerEndpointDevice(nodeId, ep, attrs, nameCounts);
    }
  }

  private registerEndpointDevice(
    nodeId: string,
    ep: number,
    attrs: Record<string, unknown>,
    nameCounts?: Map<string, number>,
  ): void {
    if (!this.homeService) return;

    const vendorName = String(attrs[`${ep}/57/1`] ?? attrs[`${ep}/40/1`] ?? 'Aqara');
    const rawProductName = String(
      attrs[`${ep}/57/3`] ??
        attrs[`${ep}/40/3`] ??
        (ep === 0 ? 'Aqara Hub M2' : `Matter Device ${ep}`),
    );
    const productName =
      ep === 0
        ? rawProductName
        : (nameCounts?.get(rawProductName) ?? 0) > 1
          ? `${rawProductName} ${ep}`
          : rawProductName;
    const model = String(attrs[`${ep}/57/5`] ?? attrs[`${ep}/40/5`] ?? productName);
    const serial = String(attrs[`${ep}/57/15`] ?? attrs[`${ep}/40/15`] ?? `${nodeId}-${ep}`);

    const clusters = new Set<number>();
    for (const key of Object.keys(attrs)) {
      if (key.startsWith(`${ep}/`)) {
        const parts = key.split('/');
        if (parts.length >= 2) {
          clusters.add(parseInt(parts[1], 10));
        }
      }
    }

    if (ep === 0) {
      // Root bridge
      const deviceId = `matter_node_${nodeId}_bridge`;
      const sourceRef: SourceDeviceRef = {
        protocol: 'matter',
        externalId: `node_${nodeId}_root`,
      };
      const device: HausDevice = {
        id: deviceId,
        source: { instanceId: 'haus-matter', externalId: `node_${nodeId}_root` },
        name: productName,
        category: 'network',
        roomId: 'unassigned',
        availability: 'online',
        connectivity: { protocol: 'matter' },
        manufacturer: vendorName,
        model,
        sourceRefs: [sourceRef],
        endpoints: [],
      };
      this.homeService.registerDevice(device);
      this.logger.log(`Discovered Matter Bridge "${productName}" (${deviceId})`);
      return;
    }

    // Determine device classification from clusters and model
    let deviceType: 'switch' | 'contact' | 'leak' | 'motion' | 'vibration' | undefined;
    let clusterId = 0;
    let attributeId = 0;
    let capabilityId = '';
    let category: DeviceCategory = 'security';

    if (clusters.has(6)) {
      // OnOff cluster (0x0006)
      deviceType = 'switch';
      clusterId = 6;
      attributeId = 0;
      capabilityId = 'power';
      category = 'power';
    } else if (clusters.has(69)) {
      // BooleanState cluster (0x0045)
      clusterId = 69;
      attributeId = 0;
      category = 'security';
      if (model.toLowerCase().includes('door') || model.toLowerCase().includes('window')) {
        deviceType = 'contact';
        capabilityId = 'contact';
      } else {
        deviceType = 'leak';
        capabilityId = 'leak';
      }
    } else if (clusters.has(1030)) {
      // OccupancySensing cluster (0x0406)
      clusterId = 1030;
      attributeId = 0;
      category = 'security';
      if (model.toLowerCase().includes('vibration')) {
        deviceType = 'vibration';
        capabilityId = 'vibration';
      } else {
        deviceType = 'motion';
        capabilityId = 'motion';
      }
    }

    if (!deviceType) return;

    const deviceId = `matter_node_${nodeId}_ep_${ep}`;
    const hausEndpointId = `ep_${deviceId}`;

    const device: HausDevice = {
      id: deviceId,
      source: { instanceId: 'haus-matter', externalId: serial },
      name: productName,
      category,
      roomId: 'unassigned',
      availability: 'online',
      connectivity: { protocol: 'matter' },
      manufacturer: vendorName,
      model,
      sourceRefs: [{ protocol: 'matter', externalId: serial }],
      endpoints: [
        {
          id: hausEndpointId,
          name: productName,
          capabilities: [
            {
              id: capabilityId,
              kind: 'binary',
              readable: true,
              operations: deviceType === 'switch' ? ['set', 'turn_on', 'turn_off'] : [],
            },
          ],
          readings: {},
        },
      ],
    };

    this.homeService.registerDevice(device);

    const mapping: MatterEndpointMapping = {
      nodeId,
      endpointId: ep,
      deviceId,
      clusterId,
      capabilityId,
      deviceType,
    };
    this.endpointMappings.set(hausEndpointId, mapping);
    this.pathIndex.set(`${nodeId}/${ep}/${clusterId}/${attributeId}`, hausEndpointId);

    // Apply initial reading
    const initialRaw = attrs[`${ep}/${clusterId}/${attributeId}`];
    if (initialRaw !== undefined) {
      this.applyReading(mapping, initialRaw);
    }

    this.logger.log(`Discovered Matter ${deviceType} "${productName}" (${deviceId})`);
  }

  private handleAttributeChange(change: MatterAttributeChange): void {
    const key = `${change.nodeId}/${change.endpointId}/${change.clusterId}/${change.attributeId}`;
    const hausEndpointId = this.pathIndex.get(key);
    if (!hausEndpointId) return;

    const mapping = this.endpointMappings.get(hausEndpointId);
    if (!mapping) return;

    this.applyReading(mapping, change.value);
  }

  private applyReading(mapping: MatterEndpointMapping, rawValue: unknown): void {
    if (!this.homeService) return;

    let patch: Record<string, unknown> = {};

    switch (mapping.deviceType) {
      case 'switch': {
        const on = Boolean(rawValue);
        patch = { state: on ? 'on' : 'off', on_off: on, power: on };
        break;
      }
      case 'contact': {
        // BooleanState for door/window: true = closed, false = open
        const closed = Boolean(rawValue);
        patch = { state: closed ? 'closed' : 'open', contact: closed };
        break;
      }
      case 'leak': {
        // BooleanState for leak: true = wet/detected, false = dry/clear
        const wet = Boolean(rawValue);
        patch = { state: wet ? 'wet' : 'dry', leak: wet };
        break;
      }
      case 'motion':
      case 'vibration': {
        // OccupancySensing: bit 0 = 1 occupied, 0 unoccupied
        const detected = (Number(rawValue) & 1) === 1;
        patch = {
          state: detected ? 'detected' : 'clear',
          [mapping.capabilityId]: detected,
        };
        break;
      }
    }

    void this.homeService.updateEndpointState(`ep_${mapping.deviceId}`, patch, true);
  }

  private async handleDeviceCommand(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const transport = this.transport;
    if (!transport) throw new Error('matter_server_not_configured');
    const mapping = this.endpointMappings.get(endpointId);
    if (!mapping) {
      throw new Error(`unknown_matter_endpoint: ${endpointId}`);
    }

    if (mapping.deviceType !== 'switch') {
      throw new Error(`command_not_supported_for_${mapping.deviceType}`);
    }

    const norm = command.toLowerCase();
    let commandId = 2; // default toggle

    if (norm === 'turn_on' || norm === 'on') {
      commandId = 1;
    } else if (norm === 'turn_off' || norm === 'off') {
      commandId = 0;
    } else if (norm === 'toggle') {
      commandId = 2;
    } else if (norm === 'set') {
      const val = parameters?.state ?? parameters?.power ?? parameters?.on_off;
      if (val === true || val === 'on' || val === 'ON') {
        commandId = 1;
      } else {
        commandId = 0;
      }
    }

    await transport.sendCommand(
      mapping.nodeId,
      mapping.endpointId,
      mapping.clusterId,
      commandId,
      {},
    );

    // Optimistically update endpoint reading
    const nextState = commandId === 1 ? 'on' : commandId === 0 ? 'off' : 'toggled';
    if (nextState !== 'toggled' && this.homeService) {
      const on = nextState === 'on';
      void this.homeService.updateEndpointState(
        endpointId,
        {
          state: nextState,
          on_off: on,
          power: on,
        },
        true,
      );
    }
  }
}
