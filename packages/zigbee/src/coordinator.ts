/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  ZigbeeCoordinatorConfig,
  ZigbeeDevice,
  ZigbeeDeviceEvent,
  ZigbeeIeeeAddress,
} from './types.js';

export interface ZigbeeTransport {
  start(config: ZigbeeCoordinatorConfig): Promise<void>;
  stop(): Promise<void>;
  permitJoin(timeSeconds: number): Promise<void>;
  sendCommand(
    ieee: ZigbeeIeeeAddress,
    endpointId: number,
    clusterId: number,
    commandId: number,
    payload?: unknown,
  ): Promise<unknown>;
  readAttribute(
    ieee: ZigbeeIeeeAddress,
    endpointId: number,
    clusterId: number,
    attributeId: number,
  ): Promise<unknown>;
  subscribe(callback: (event: ZigbeeDeviceEvent) => void): () => void;
}

/**
 * Haus Native Zigbee Coordinator Service.
 * Manages the 802.15.4 radio coordinator, network commissioning (permit join),
 * device interview, ZCL cluster command dispatch, and device state events.
 */
export class ZigbeeCoordinator {
  private readonly devices = new Map<ZigbeeIeeeAddress, ZigbeeDevice>();
  private readonly listeners = new Set<(event: ZigbeeDeviceEvent) => void>();
  private isRunning = false;
  private unsubscribeTransport?: () => void;

  constructor(private readonly transport: ZigbeeTransport) {
    this.unsubscribeTransport = this.transport.subscribe((event) => {
      this.applyDeviceEvent(event);
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  get running(): boolean {
    return this.isRunning;
  }

  async start(config: ZigbeeCoordinatorConfig): Promise<void> {
    if (!config.serialPort) throw new Error('serial_port_required');
    if (config.channel !== undefined && (config.channel < 11 || config.channel > 26)) {
      throw new Error('invalid_zigbee_channel');
    }

    await this.transport.start(config);
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    await this.transport.stop();
    this.isRunning = false;
  }

  dispose(): void {
    if (this.unsubscribeTransport) {
      this.unsubscribeTransport();
      this.unsubscribeTransport = undefined;
    }
    this.listeners.clear();
  }

  async permitJoin(durationSeconds = 60): Promise<void> {
    if (!this.isRunning) throw new Error('coordinator_not_running');
    if (durationSeconds < 0 || durationSeconds > 255) {
      throw new Error('invalid_permit_join_duration');
    }
    await this.transport.permitJoin(durationSeconds);
  }

  registerDevice(device: ZigbeeDevice): void {
    this.devices.set(device.ieeeAddress, device);
  }

  getDevice(ieeeAddress: ZigbeeIeeeAddress): ZigbeeDevice | undefined {
    return this.devices.get(ieeeAddress);
  }

  listDevices(): readonly ZigbeeDevice[] {
    return Array.from(this.devices.values());
  }

  async sendCommand(
    ieee: ZigbeeIeeeAddress,
    endpointId: number,
    clusterId: number,
    commandId: number,
    payload?: unknown,
  ): Promise<unknown> {
    const device = this.devices.get(ieee);
    if (!device) throw new Error('unknown_zigbee_device');
    if (!device.available) throw new Error('zigbee_device_unavailable');

    return this.transport.sendCommand(ieee, endpointId, clusterId, commandId, payload);
  }

  async readAttribute(
    ieee: ZigbeeIeeeAddress,
    endpointId: number,
    clusterId: number,
    attributeId: number,
  ): Promise<unknown> {
    const device = this.devices.get(ieee);
    if (!device) throw new Error('unknown_zigbee_device');
    return this.transport.readAttribute(ieee, endpointId, clusterId, attributeId);
  }

  onDeviceEvent(listener: (event: ZigbeeDeviceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyDeviceEvent(event: ZigbeeDeviceEvent): void {
    const device = this.devices.get(event.ieeeAddress);
    if (!device) return;

    let endpoint = device.endpoints[event.endpointId];
    if (!endpoint) {
      endpoint = {
        id: event.endpointId,
        profileId: 0x0104, // Home Automation profile
        deviceId: 0,
        inputClusters: [],
        outputClusters: [],
        clusters: {},
      };
      device.endpoints[event.endpointId] = endpoint;
    }

    let cluster = endpoint.clusters[event.clusterId];
    if (!cluster) {
      cluster = { id: event.clusterId, name: `cluster-${event.clusterId}`, attributes: {} };
      endpoint.clusters[event.clusterId] = cluster;
    }

    cluster.attributes[event.attributeId] = {
      id: event.attributeId,
      name: `attr-${event.attributeId}`,
      value: event.value,
    };
  }
}
