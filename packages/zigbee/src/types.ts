/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type ZigbeeIeeeAddress = string; // E.g. '0x00124b0024c12345'
export type ZigbeeNetworkAddress = number; // 16-bit uint

/**
 * Supported Zigbee coordinator adapter drivers in zigbee-herdsman.
 * Note: ezsp is deprecated in favor of ember.
 */
export type ZigbeeAdapterType =
  | 'zstack' // Texas Instruments CC2652 / CC1352
  | 'ember' // Silicon Labs EZRadioPRO / EFR32
  | 'deconz' // ConBee / RaspBee
  | 'zigate' // ZiGate
  | 'zboss' // DSR ZBOSS
  | 'zoh'
  | 'ezsp'; // Deprecated legacy Silicon Labs driver

/**
 * Radio coordinator backup formats.
 */
export type ZigbeeBackupFormat = 'nvram' | 'open_pan';

export interface ZigbeeCoordinatorBackup {
  readonly timestamp: string;
  readonly format: ZigbeeBackupFormat;
  readonly channel: number;
  readonly panId: number;
  readonly extendedPanId: string;
  readonly networkKey: string;
  readonly rawPayload: string;
}

/**
 * Architectural invariant: baseline Haus appliance hardware MUST feature separate physical radios
 * for Zigbee and Thread. Single-radio multiprotocol (dynamic multiprotocol) is forbidden for production.
 */
export interface ZigbeeDualRadioTopology {
  readonly radioAThreadRcp: {
    readonly chip: 'EFR32MG24' | 'nRF52840';
    readonly interfaceName: 'wpan0';
    readonly owner: 'otbr-agent';
  };
  readonly radioBZigbeeCoordinator: {
    readonly chip: 'EFR32MG21' | 'EFR32MG24' | 'CC2652' | 'CC1352';
    readonly adapter: ZigbeeAdapterType;
    readonly owner: 'zigbee-herdsman';
  };
  readonly singleRadioMultiprotocolForbidden: true;
}

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
