/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type ZigbeeIeeeAddress = string; // E.g. '0x00124b0024c12345'
export type ZigbeeNetworkAddress = number; // 16-bit uint

export type ZigbeeAdapterType = 'zstack' | 'ezsp' | 'deconz' | 'zigate';

export interface ZigbeeCoordinatorConfig {
  readonly serialPort: string;
  readonly adapter?: ZigbeeAdapterType;
  readonly baudRate?: number;
  readonly channel?: number; // 11 to 26
  readonly panId?: number; // 16-bit
  readonly extPanId?: readonly number[]; // 8-byte array
  readonly networkKey?: readonly number[]; // 16-byte array
}

export interface ZigbeeAttribute {
  readonly id: number;
  readonly name: string;
  readonly value: unknown;
}

export interface ZigbeeCluster {
  readonly id: number;
  readonly name: string;
  readonly attributes: Record<number, ZigbeeAttribute>;
}

export interface ZigbeeEndpoint {
  readonly id: number;
  readonly profileId: number;
  readonly deviceId: number;
  readonly inputClusters: readonly number[];
  readonly outputClusters: readonly number[];
  readonly clusters: Record<number, ZigbeeCluster>;
}

export interface ZigbeeDevice {
  readonly ieeeAddress: ZigbeeIeeeAddress;
  readonly networkAddress: ZigbeeNetworkAddress;
  readonly manufacturerName?: string;
  readonly modelId?: string;
  readonly powerSource?: 'battery' | 'mains';
  readonly lqi?: number; // Link Quality Indication 0-255
  readonly available: boolean;
  readonly endpoints: Record<number, ZigbeeEndpoint>;
}

export interface ZigbeeDeviceEvent {
  readonly ieeeAddress: ZigbeeIeeeAddress;
  readonly endpointId: number;
  readonly clusterId: number;
  readonly attributeId: number;
  readonly value: unknown;
  readonly timestamp: number;
}
