/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausAutomationRule } from '@haus/core/automation';
import type { HausDevice } from '@haus/core/device';

export interface HaAutomationDefinition {
  readonly id?: string;
  readonly alias?: string;
  readonly description?: string;
  readonly trigger?: unknown;
  readonly condition?: unknown;
  readonly action?: unknown;
  readonly mode?: string;
  readonly initial_state?: boolean;
}

export interface MigrationItem {
  readonly haId: string;
  readonly haAlias: string;
  readonly status: 'supported' | 'unsupported';
  readonly hausRule?: HausAutomationRule;
  readonly unsupportedReasons?: readonly string[];
}

export interface MigrationDiff {
  readonly readyToMigrate: readonly MigrationItem[];
  readonly unsupported: readonly MigrationItem[];
  readonly totalCount: number;
  readonly supportedCount: number;
  readonly unsupportedCount: number;
  readonly duplicateActiveWarning: boolean;
  readonly haAutomationsToDisable: readonly string[];
}

export interface MigrationRollbackSnapshot {
  readonly migratedAt: string;
  readonly createdHausRuleIds: readonly string[];
  readonly disabledHaAutomationIds: readonly string[];
}

/** Legacy Home Assistant device metadata from device_registry. */
export interface LegacyHaDevice {
  readonly id: string;
  readonly name?: string | null;
  readonly name_by_user?: string | null;
  readonly area_id?: string | null;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly sw_version?: string | null;
  readonly hw_version?: string | null;
  readonly serial_number?: string | null;
  readonly connections?: readonly (readonly [string, string])[];
  readonly identifiers?: readonly (readonly [string, string])[];
}

/** Legacy Home Assistant entity entry from entity_registry. */
export interface LegacyHaEntityEntry {
  readonly entity_id: string;
  readonly device_id?: string | null;
  readonly area_id?: string | null;
  readonly name?: string | null;
  readonly original_name?: string | null;
  readonly platform?: string;
  readonly unique_id?: string;
  readonly disabled_by?: string | null;
}

/** Legacy Home Assistant state from get_states. */
export interface LegacyHaState {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Record<string, unknown>;
  readonly last_changed?: string;
  readonly last_updated?: string;
}

/** Legacy Home Assistant area entry from area_registry. */
export interface LegacyHaArea {
  readonly area_id: string;
  readonly name: string;
  readonly icon?: string;
}

/** Complete read-only snapshot of legacy Home Assistant inventory. */
export interface LegacyHaInventory {
  readonly states: readonly LegacyHaState[];
  readonly entities: readonly LegacyHaEntityEntry[];
  readonly devices: readonly LegacyHaDevice[];
  readonly areas: readonly LegacyHaArea[];
  readonly automations?: readonly unknown[];
}

/** Normalized device ready for import into Haus. */
export interface DeviceImportItem {
  readonly device: HausDevice;
  readonly sourceEntityIds: readonly string[];
  readonly canonicalAddresses: readonly string[];
}

/** Diff summary produced before applying a device import. */
export interface DeviceImportDiff {
  readonly readyToImport: readonly DeviceImportItem[];
  readonly unsupported: readonly { readonly entityId: string; readonly reason: string }[];
  readonly totalEntities: number;
  readonly importedDevicesCount: number;
  readonly importedEndpointsCount: number;
  readonly sourceInstanceId: string;
}

/** Non-destructive rollback snapshot for device imports. */
export interface DeviceImportSnapshot {
  readonly importedAt: string;
  readonly sourceInstanceId: string;
  readonly createdDeviceIds: readonly string[];
  readonly createdEndpointIds: readonly string[];
}

/** Clean abstraction for device storage and registry operations. */
export interface DeviceRegistryPort {
  registerDevice(device: HausDevice): void | Promise<void>;
  unregisterDevice(deviceId: string): void | Promise<void>;
  getDevice(deviceId: string): HausDevice | undefined | Promise<HausDevice | undefined>;
  getAllDevices(): readonly HausDevice[] | Promise<readonly HausDevice[]>;
}

/** In-memory implementation of DeviceRegistryPort for testing and local Hub runtime. */
export class InMemoryDeviceRegistry implements DeviceRegistryPort {
  private readonly devices = new Map<string, HausDevice>();

  registerDevice(device: HausDevice): void {
    this.devices.set(device.id, device);
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  getDevice(deviceId: string): HausDevice | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): readonly HausDevice[] {
    return Array.from(this.devices.values());
  }

  clear(): void {
    this.devices.clear();
  }
}

/** Comprehensive parallel health check report ("Перед остановкой старого убедиться что новое всё ожило"). */
export interface ParallelHealthcheckReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly hubStatus: 'ok' | 'degraded' | 'failed';
  readonly deviceCount: number;
  readonly healthyDeviceCount: number;
  readonly protocols: Readonly<
    Record<
      string,
      { readonly ready: boolean; readonly latencyMs?: number; readonly error?: string }
    >
  >;
  readonly automationEngineReady: boolean;
  readonly storageIntegrity: boolean;
  readonly issues: readonly string[];
}

/** Zero-loss inventory verification diff ensuring no entities, devices, or pairings are dropped. */
export interface ZeroLossVerificationDiff {
  readonly verified: boolean;
  readonly sourceEntitiesCount: number;
  readonly targetEndpointsCount: number;
  readonly sourceDevicesCount: number;
  readonly targetDevicesCount: number;
  readonly missingEntityIds: readonly string[];
  readonly unsupportedEntityIds: readonly string[];
  readonly checksum: string;
}

/** Discrete phases of attended cutover. */
export enum CutoverPhaseEnum {
  ParallelValidation = 'parallel_validation',
  AwaitingUserApproval = 'awaiting_user_approval',
  ExecutingCutover = 'executing_cutover',
  PostCutoverVerification = 'post_cutover_verification',
  Completed = 'completed',
  RolledBack = 'rolled_back',
}
export const CutoverPhase = CutoverPhaseEnum;
export type CutoverPhase = CutoverPhaseEnum | `${CutoverPhaseEnum}`;

/** Rollback checkpoint recording states across cutover progression. */
export interface CutoverCheckpoint {
  readonly checkpointId: string;
  readonly phase: CutoverPhase;
  readonly createdAt: string;
  readonly deviceSnapshot: DeviceImportSnapshot;
  readonly automationSnapshot?: MigrationRollbackSnapshot;
}

/** User authorization intent required to proceed with attended cutover. */
export interface CutoverIntent {
  readonly confirmedByUser: boolean;
  readonly confirmationCode: string; // e.g. "CONFIRM-CUTOVER-HAUS"
  readonly timestamp: string;
  readonly userIdentifier: string;
}

/** Structured outcome of an attended cutover procedure. */
export interface CutoverResult {
  readonly success: boolean;
  readonly phase: CutoverPhase;
  readonly healthReport: ParallelHealthcheckReport;
  readonly verificationDiff: ZeroLossVerificationDiff;
  readonly rollbackAvailable: boolean;
  readonly completedAt?: string;
  readonly error?: string;
}
