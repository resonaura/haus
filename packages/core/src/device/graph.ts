/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Canonical Haus identifier type. */
export type HausId = string;

/** Protocol identifiers supported across the Haus ecosystem. */
export type CanonicalProtocol =
  | 'home-assistant'
  | 'hap-ip'
  | 'hap-ble'
  | 'hap-thread'
  | 'matter'
  | 'zigbee'
  | 'thread'
  | 'vendor'
  | 'virtual';

/** Primitive and composite typed values allowed within canonical characteristics. */
export type HausValue =
  | boolean
  | number
  | string
  | Uint8Array
  | null
  | readonly HausValue[]
  | { readonly [key: string]: HausValue };

/** Preserved protocol-specific origin for a physical or logical device. */
export interface SourceDeviceRef {
  readonly protocol: CanonicalProtocol;
  readonly externalId: string;
  readonly instanceId?: string;
  readonly configEntryId?: string;
  readonly deviceId?: string;
  readonly aid?: number;
  readonly nodeId?: string;
  readonly endpointId?: number;
  readonly ieeeAddress?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Preserved protocol-specific origin for a service or sub-device. */
export interface SourceServiceRef {
  readonly protocol: CanonicalProtocol;
  readonly externalId: string;
  readonly iid?: number;
  readonly typeUuid?: string;
  readonly endpointId?: number;
  readonly clusterId?: number;
  readonly entityId?: string;
  readonly domain?: string;
  readonly deviceClass?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Preserved protocol-specific origin for an individual characteristic or attribute. */
export interface SourceCharacteristicRef {
  readonly protocol: CanonicalProtocol;
  readonly externalId: string;
  readonly iid?: number;
  readonly typeUuid?: string;
  readonly attributeId?: number;
  readonly commandId?: number;
  readonly entityId?: string;
  readonly attributeKey?: string;
  readonly format?: string;
  readonly permissions?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Inter-device topological and functional relationships. */
export type DeviceRelationshipType =
  'parent' | 'child' | 'bridge' | 'bridged' | 'linked' | 'group' | 'companion';

export interface DeviceRelationship {
  readonly type: DeviceRelationshipType;
  readonly targetDeviceId: HausId;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Canonical Generic Characteristic Family (First-Class Extensibility)
 * ────────────────────────────────────────────────────────────────────────── */

export interface GenericBoolean {
  readonly kind: 'generic.boolean';
  readonly value: boolean | null;
}

export interface GenericInt {
  readonly kind: 'generic.int';
  readonly value: number | null;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

export interface GenericFloat {
  readonly kind: 'generic.float';
  readonly value: number | null;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

export interface GenericEnum {
  readonly kind: 'generic.enum';
  readonly value: string | number | null;
  readonly values: ReadonlyArray<{
    readonly value: string | number;
    readonly label?: string;
  }>;
}

export interface GenericString {
  readonly kind: 'generic.string';
  readonly value: string | null;
  readonly maxLength?: number;
  readonly multiline?: boolean;
}

export interface GenericAction {
  readonly kind: 'generic.action';
  readonly actionId: string;
  readonly arguments?: readonly HausCharacteristic[];
}

export interface GenericJSONBlob {
  readonly kind: 'generic.json';
  readonly value: HausValue;
  readonly schemaUri?: string;
}

export type GenericCharacteristic =
  | GenericBoolean
  | GenericInt
  | GenericFloat
  | GenericEnum
  | GenericString
  | GenericAction
  | GenericJSONBlob;

/* ──────────────────────────────────────────────────────────────────────────
 * Canonical 3-Tier Hierarchy (Device -> Service -> Characteristic)
 * ────────────────────────────────────────────────────────────────────────── */

/** Smallest typed observable and controllable state unit. */
export interface HausCharacteristic<T = HausValue> {
  readonly id: HausId;
  readonly stableKey: string;
  readonly type: string;
  readonly value: T | null;

  readonly readable: boolean;
  readonly writable: boolean;
  readonly notifiable: boolean;

  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly validValues?: readonly (string | number | boolean)[];

  readonly sourceRefs: readonly SourceCharacteristicRef[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Coherent capability or functional sub-device boundary. */
export interface HausService {
  readonly id: HausId;
  readonly stableKey: string;
  readonly type: string;
  readonly subtype?: string;
  readonly name?: string;

  readonly characteristics: readonly HausCharacteristic[];
  readonly linkedServiceIds: readonly HausId[];

  readonly sourceRefs: readonly SourceServiceRef[];
  readonly opaqueMetadata: Readonly<Record<string, unknown>>;
}

/** Canonical Haus device definition matching the universal report blueprint. */
export interface CanonicalHausDevice {
  readonly id: HausId;
  readonly stableKey: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly serialNumber?: string;
  readonly firmwareVersion?: string;
  readonly hardwareVersion?: string;

  readonly sourceRefs: readonly SourceDeviceRef[];
  readonly services: readonly HausService[];
  readonly relationships: readonly DeviceRelationship[];

  readonly areaId?: string;
  readonly availability: 'online' | 'offline' | 'unknown';
  readonly diagnostics: Readonly<Record<string, HausValue>>;
  readonly opaqueMetadata: Readonly<Record<string, unknown>>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Deterministic Stable Key Generation Algorithms
 * ────────────────────────────────────────────────────────────────────────── */

export function buildStableKey(
  protocol: CanonicalProtocol,
  externalId: string,
  instanceId?: string,
): string {
  const prefix = instanceId ? `${protocol}:${instanceId}` : protocol;
  return `${prefix}:${externalId}`;
}

export function buildHaDeviceKey(configEntryId: string | undefined, deviceId: string): string {
  return configEntryId ? `ha:device:${configEntryId}:${deviceId}` : `ha:device:${deviceId}`;
}

export function buildHaEntityKey(entityRegistryId: string): string {
  return `ha:entity:${entityRegistryId}`;
}

export function buildHapAccessoryKey(accessoryId: string, aid: number): string {
  return `hap:${accessoryId}:aid:${aid}`;
}

export function buildMatterNodeKey(
  fabricIndex: number,
  nodeId: string,
  endpointId: number,
): string {
  return `matter:fabric:${fabricIndex}:node:${nodeId}:ep:${endpointId}`;
}

export function buildZigbeeDeviceKey(ieeeAddress: string): string {
  return `zigbee:${ieeeAddress.toLowerCase().replace(/[^a-f0-9]/g, '')}`;
}
