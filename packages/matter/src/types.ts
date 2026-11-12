/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type MatterNodeId = string;

/**
 * Standard Matter device type identifiers.
 */
export const MatterDeviceType = {
  RobotVacuumCleaner: 0x0074,
  OnOffLight: 0x0100,
  DimmableLight: 0x0101,
  ColorTemperatureLight: 0x010c,
  ExtendedColorLight: 0x010d,
  OnOffPlugInUnit: 0x010a,
  DimmablePlugInUnit: 0x010b,
  DoorLock: 0x000a,
  Thermostat: 0x0301,
  TemperatureSensor: 0x0302,
  HumiditySensor: 0x0307,
  OccupancySensor: 0x0107,
} as const;
export type MatterDeviceType = (typeof MatterDeviceType)[keyof typeof MatterDeviceType];

/**
 * Standard Matter Cluster identifiers.
 */
export const MatterClusterId = {
  Identify: 0x0003,
  Groups: 0x0004,
  OnOff: 0x0006,
  LevelControl: 0x0008,
  Descriptor: 0x001d,
  Binding: 0x001e,
  AccessControl: 0x001f,
  Actions: 0x0025,
  BasicInformation: 0x0028,
  PowerSource: 0x002f,
  GeneralCommissioning: 0x0030,
  NetworkCommissioning: 0x0031,
  DiagnosticLogs: 0x0032,
  GeneralDiagnostics: 0x0033,
  SoftwareDiagnostics: 0x0034,
  ThreadNetworkDiagnostics: 0x0035,
  WiFiNetworkDiagnostics: 0x0036,
  EthernetNetworkDiagnostics: 0x0037,
  TimeSynchronization: 0x0038,
  BridgedDeviceBasicInformation: 0x0039,
  Switch: 0x003b,
  AdministratorCommissioning: 0x003c,
  OperationalCredentials: 0x003e,
  GroupKeyManagement: 0x003f,
  FixedLabel: 0x0040,
  UserLabel: 0x0041,
  BooleanState: 0x0045,
  ModeSelect: 0x0050,
  RvcRunMode: 0x0054,
  RvcCleanMode: 0x0055,
  RvcOperationalState: 0x0061,
  TemperatureMeasurement: 0x0402,
  RelativeHumidityMeasurement: 0x0405,
  OccupancySensing: 0x0406,
} as const;
export type MatterClusterId = (typeof MatterClusterId)[keyof typeof MatterClusterId];

export interface MatterCommissioningParams {
  readonly code: string;
  readonly ip?: string;
  readonly port?: number;
  readonly discriminator?: number;
  readonly passcode?: number;
  readonly wifiSsid?: string;
  readonly wifiPassword?: string;
  readonly threadDataset?: string | Uint8Array;
  readonly failSafeTimeoutSeconds?: number;
}

export interface MatterShareRequest {
  readonly nodeId: string;
  readonly expiresSeconds: number;
  readonly targetEcosystem?: 'apple' | 'google' | 'other';
}

export interface MatterSharePayload {
  readonly qrPayload: string; // MT:...
  readonly manualPairingCode: string; // 11- or 21-digit representation
  readonly discriminator: number;
  readonly expiresAt: string;
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

/**
 * Controller port managing physical Matter devices commissioned into the Haus fabric.
 */
export interface MatterControllerAdapter {
  commissionNode(params: MatterCommissioningParams): Promise<MatterNode>;
  unpairNode(nodeId: MatterNodeId): Promise<void>;
  listNodes(): Promise<readonly MatterNode[]>;
  readAttribute(subscription: MatterAttributeSubscription): Promise<unknown>;
  writeAttribute(subscription: MatterAttributeSubscription, value: unknown): Promise<void>;
  invokeCommand(
    nodeId: MatterNodeId,
    endpointId: number,
    clusterId: number,
    commandId: number,
    args?: unknown,
  ): Promise<unknown>;
  openCommissioningWindow(request: MatterShareRequest): Promise<MatterSharePayload>;
}

/**
 * Aggregator / Bridge port exposing native Haus devices and endpoints
 * to external ecosystems (Apple Home, Google Home, SmartThings) as Matter nodes.
 */
export interface MatterAggregatorAdapter {
  registerBridgedDevice(device: unknown): Promise<number>;
  unregisterBridgedDevice(endpointId: number): Promise<void>;
  updateAttribute(
    endpointId: number,
    clusterId: number,
    attributeId: number,
    value: unknown,
  ): Promise<void>;
  startAggregator(): Promise<void>;
  stopAggregator(): Promise<void>;
}
