/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export const MAX_TRANSFER_BUNDLE_BYTES = 1024 * 1024;

export type RuleKind = 'automation' | 'script';

export type DeviceIdentity = readonly [protocol: string, externalId: string];

export type TransferRule = {
  id: string;
  name: string;
  sourceEntityId: string;
  sourceEnabled?: boolean;
  config: Record<string, unknown>;
};

export type DeviceEntity = {
  entityId: string;
  domain: string;
  platform?: string;
  uniqueId?: string;
  deviceIdentifiers?: DeviceIdentity[];
  configEntryId?: string;
  originalName?: string;
  friendlyName?: string;
};

export type TargetEntity = {
  entityId: string;
  deviceId: string;
  domain: string;
  platform?: string;
  uniqueId?: string;
  deviceIdentifiers?: DeviceIdentity[];
  name?: string;
};

export type TransferBundle = {
  automations: TransferRule[];
  scripts: TransferRule[];
  registryEntityIds: Record<string, string>;
  deviceEntities: Record<string, DeviceEntity[]>;
};

export type RuleImportStatus = 'ready' | 'saved' | 'skipped' | 'failed';

export interface RuleImportEntry {
  readonly key: string;
  readonly name: string;
  readonly kind: RuleKind;
  readonly status: RuleImportStatus;
  readonly reason?: string;
}

export interface TransferImportProgress {
  readonly entries: readonly RuleImportEntry[];
  readonly completed: number;
  readonly saved: number;
}

export interface TransferImportResult {
  readonly entries: readonly RuleImportEntry[];
  readonly completed: number;
  readonly saved: number;
}

export interface AutomationMigrationSummary {
  readonly ruleId: string;
  readonly friendlyName: string;
  readonly sourceEntityId: string;
  readonly importedFromHa: boolean;
  readonly cutoverComplete: boolean;
  readonly sourceRemoved: boolean;
  readonly waitingForSourceCutover: boolean;
  readonly statusLabel: string;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const record = asRecord;

export function describeAutomationMigration(
  attributes: Readonly<Record<string, unknown>>,
  state: string,
): AutomationMigrationSummary {
  const importedFromHa = attributes.haus_migration_source === 'home_assistant';
  const cutoverComplete = typeof attributes.haus_migration_source_cutover_at === 'string';
  const sourceRemoved = typeof attributes.haus_migration_source_removed_at === 'string';
  const waitingForSourceCutover = importedFromHa && !cutoverComplete;
  const ruleId = typeof attributes.id === 'string' ? attributes.id : '';
  const friendlyName =
    typeof attributes.friendly_name === 'string' ? attributes.friendly_name : 'Automation';
  const sourceEntityId =
    typeof attributes.haus_migration_source_entity_id === 'string'
      ? attributes.haus_migration_source_entity_id
      : '';

  const statusLabel = waitingForSourceCutover
    ? 'Imported and paused here · Home Assistant is the source'
    : sourceRemoved
      ? 'Haus runs this rule · Removed from Home Assistant'
      : cutoverComplete
        ? 'Haus runs this rule · Home Assistant copy is paused for rollback'
        : `${state === 'on' ? 'Ready when you need it' : 'Paused'} · Managed by Haus Hub`;

  return {
    ruleId,
    friendlyName,
    sourceEntityId,
    importedFromHa,
    cutoverComplete,
    sourceRemoved,
    waitingForSourceCutover,
    statusLabel,
  };
}
