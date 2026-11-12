/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  MatterAttributeChange,
  MatterCommissioningParams,
  MatterFabric,
  MatterNode,
  MatterNodeId,
} from './types.js';

export interface MatterTransport {
  commission(
    params: MatterCommissioningParams,
  ): Promise<{ nodeId: MatterNodeId; fabricIndex: number }>;
  setWifiCredentials?(ssid: string, credentials: string): Promise<void>;
  setThreadDataset?(dataset: string | Uint8Array): Promise<void>;
  sendCommand(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    commandId: number,
    payload?: unknown,
  ): Promise<unknown>;
  readAttribute(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number,
  ): Promise<unknown>;
  writeAttribute(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number,
    value: unknown,
  ): Promise<void>;
  subscribe(callback: (change: MatterAttributeChange) => void): () => void;
}

/**
 * Haus-native Matter Controller service.
 * Manages Matter commissioning, node inventory, cluster commands, and attribute subscriptions.
 */
export class MatterController {
  private readonly nodes = new Map<MatterNodeId, MatterNode>();
  private readonly fabrics = new Map<number, MatterFabric>();
  private readonly listeners = new Set<(change: MatterAttributeChange) => void>();
  private unsubscribeTransport?: () => void;

  constructor(private readonly transport: MatterTransport) {
    this.unsubscribeTransport = this.transport.subscribe((change) => {
      this.applyAttributeChange(change);
      for (const listener of this.listeners) {
        listener(change);
      }
    });
  }

  dispose(): void {
    if (this.unsubscribeTransport) {
      this.unsubscribeTransport();
      this.unsubscribeTransport = undefined;
    }
    this.listeners.clear();
  }

  registerNode(node: MatterNode): void {
    this.nodes.set(node.id, node);
  }

  getNode(nodeId: MatterNodeId): MatterNode | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(): readonly MatterNode[] {
    return Array.from(this.nodes.values());
  }

  async commission(params: MatterCommissioningParams): Promise<MatterNodeId> {
    if (!params.code && (!params.discriminator || !params.passcode)) {
      throw new Error('invalid_matter_commissioning_parameters');
    }

    const result = await this.transport.commission(params);
    const node: MatterNode = {
      id: result.nodeId,
      vendorId: 0,
      productId: 0,
      available: true,
      endpoints: {},
    };
    this.nodes.set(node.id, node);
    return node.id;
  }

  async setWifiCredentials(ssid: string, password: string): Promise<void> {
    if (!this.transport.setWifiCredentials) {
      throw new Error('transport_does_not_support_wifi_credentials');
    }
    await this.transport.setWifiCredentials(ssid, password);
  }

  async setThreadDataset(dataset: string | Uint8Array): Promise<void> {
    if (!this.transport.setThreadDataset) {
      throw new Error('transport_does_not_support_thread_dataset');
    }
    await this.transport.setThreadDataset(dataset);
  }

  async sendCommand(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    commandId: number,
    payload?: unknown,
  ): Promise<unknown> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error('unknown_matter_node');
    if (!node.available) throw new Error('matter_node_unavailable');

    return this.transport.sendCommand(nodeId, endpointId, clusterId, commandId, payload);
  }

  async readAttribute(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    attributeId: number,
  ): Promise<unknown> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error('unknown_matter_node');
    return this.transport.readAttribute(nodeId, endpointId, clusterId, attributeId);
  }

  onAttributeChange(listener: (change: MatterAttributeChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyAttributeChange(change: MatterAttributeChange): void {
    const node = this.nodes.get(change.nodeId);
    if (!node) return;

    let endpoint = node.endpoints[change.endpointId];
    if (!endpoint) {
      endpoint = {
        id: change.endpointId,
        deviceTypeId: 0,
        deviceTypeName: 'generic',
        clusters: {},
      };
      node.endpoints[change.endpointId] = endpoint;
    }

    let cluster = endpoint.clusters[change.clusterId];
    if (!cluster) {
      cluster = { id: change.clusterId, name: `cluster-${change.clusterId}`, attributes: {} };
      endpoint.clusters[change.clusterId] = cluster;
    }

    cluster.attributes[change.attributeId] = {
      id: change.attributeId,
      name: `attr-${change.attributeId}`,
      value: change.value,
    };
  }
}
