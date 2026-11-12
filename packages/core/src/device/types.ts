/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Availability, Capability, Json, Reading, SourceRef } from '../types.js';
import type { DeviceCategory } from './category.js';
import type { Protocol, UiPrimitive } from './enums.js';
import type {
  CanonicalHausDevice,
  CanonicalProtocol,
  DeviceRelationship,
  DeviceRelationshipType,
  GenericAction,
  GenericBoolean,
  GenericCharacteristic,
  GenericEnum,
  GenericFloat,
  GenericInt,
  GenericJSONBlob,
  GenericString,
  HausCharacteristic,
  HausId,
  HausService,
  HausValue,
  SourceCharacteristicRef,
  SourceDeviceRef,
  SourceServiceRef,
} from './graph.js';

export type {
  CanonicalHausDevice,
  CanonicalProtocol,
  DeviceRelationship,
  DeviceRelationshipType,
  GenericAction,
  GenericBoolean,
  GenericCharacteristic,
  GenericEnum,
  GenericFloat,
  GenericInt,
  GenericJSONBlob,
  GenericString,
  HausCharacteristic,
  HausId,
  HausService,
  HausValue,
  SourceCharacteristicRef,
  SourceDeviceRef,
  SourceServiceRef,
};

/** Arbitrary extensible custom entity attached to any device or endpoint. */
export interface CustomEntity {
  readonly id: string;
  readonly name: string;
  readonly primitive: UiPrimitive;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly choices?: readonly string[];
  readonly icon?: string;
  readonly reading: Reading;
}

/** Stateless event payload emitted by buttons, remotes, scene keypads, and tap dials. */
export interface EventPayload {
  readonly eventType: string;
  readonly timestamp: string;
  readonly sequence: number;
  readonly buttonIndex?: number;
  readonly rotationSteps?: number;
  readonly rotationVelocity?: number;
  readonly metadata?: Readonly<Record<string, Json>>;
}

/** First-class firmware or container update state. */
export interface UpdatePayload {
  readonly installedVersion: string;
  readonly latestVersion: string | null;
  readonly releaseSummary?: string;
  readonly releaseUrl?: string;
  readonly inProgress: boolean;
  readonly updatePercentage?: number;
  readonly autoUpdate: boolean;
}

/** Hardware connectivity metadata. */
export interface ConnectivityInfo {
  readonly protocol: Protocol;
  readonly address?: string;
  readonly lqi?: number;
  readonly rssi?: number;
}

/** An addressable functional endpoint within a device (e.g. one socket of a multi-gang surge protector). */
export interface HausEndpoint {
  readonly id: string;
  readonly sourceRefs?: readonly SourceServiceRef[];
  /** Explicit authority for observations and commands; aliases alone never transfer ownership. */
  readonly sourceOwner?: SourceServiceRef;
  readonly mediaId?: string;
  readonly address?: string; // Canonical address e.g. switch::living-room:power-strip:socket-1
  readonly roomId?: string;
  readonly availability?: Availability;
  readonly name: string;
  readonly category?: DeviceCategory;
  readonly capabilities: readonly Capability[];
  readonly readings: Readonly<Record<string, Reading>>;
  readonly customEntities?: Readonly<Record<string, CustomEntity>>;
}

/**
 * Haus canonical device representation.
 * Unifies the physical hardware identity with the 3-tier canonical service graph
 * and backward-compatible endpoint projections.
 */
export interface HausDevice {
  readonly id: string;
  readonly source: SourceRef;
  readonly name: string;
  readonly category: DeviceCategory;
  readonly roomId?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly firmwareVersion?: string;
  readonly hardwareVersion?: string;
  readonly serialNumber?: string;
  readonly connectivity: ConnectivityInfo;
  readonly availability: Availability;
  readonly endpoints: readonly HausEndpoint[];
  readonly customEntities?: Readonly<Record<string, CustomEntity>>;
  readonly metadata?: Readonly<Record<string, Json>>;

  // Protocol-neutral canonical 3-tier device graph from deep-research-report.md
  readonly stableKey?: string;
  readonly areaId?: string;
  readonly sourceRefs?: readonly SourceDeviceRef[];
  readonly services?: readonly HausService[];
  readonly relationships?: readonly DeviceRelationship[];
  readonly diagnostics?: Readonly<Record<string, HausValue>>;
  readonly opaqueMetadata?: Readonly<Record<string, unknown>>;
}
