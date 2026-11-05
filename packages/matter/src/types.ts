/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type MatterNodeId = string;

export interface MatterCommissioningParams {
  readonly code: string;
  readonly ip?: string;
  readonly port?: number;
  readonly discriminator?: number;
  readonly passcode?: number;
}

export interface MatterClusterAttribute {
  readonly id: number;
  readonly name: string;
  readonly value: unknown;
}

export interface MatterCluster {
  readonly id: number;
  readonly name: string;
  readonly attributes: Record<number, MatterClusterAttribute>;
}

export interface MatterEndpoint {
  readonly id: number;
  readonly deviceTypeId: number;
  readonly deviceTypeName: string;
  readonly clusters: Record<number, MatterCluster>;
}

export interface MatterNode {
  readonly id: MatterNodeId;
  readonly vendorId: number;
  readonly productId: number;
  readonly vendorName?: string;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly hardwareVersion?: string;
  readonly softwareVersion?: string;
  readonly available: boolean;
  readonly endpoints: Record<number, MatterEndpoint>;
}

export interface MatterFabric {
  readonly fabricIndex: number;
  readonly fabricId: string;
  readonly rootNodeId: string;
  readonly label?: string;
}

export interface MatterAttributeSubscription {
  readonly nodeId: MatterNodeId;
  readonly endpointId: number;
  readonly clusterId: number;
  readonly attributeId: number;
}

export interface MatterAttributeChange {
  readonly nodeId: MatterNodeId;
  readonly endpointId: number;
  readonly clusterId: number;
  readonly attributeId: number;
  readonly value: unknown;
  readonly timestamp: number;
}
