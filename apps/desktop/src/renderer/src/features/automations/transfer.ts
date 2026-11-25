/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  MAX_TRANSFER_BUNDLE_BYTES,
  parseTransferBundleText,
  type TransferBundle,
} from '@haus/core/transport';

export {
  buildEntityAliases,
  buildInitialTransferEntries,
  describeAutomationMigration,
  friendlyError,
  friendlyTransferError,
  importTransferBundle,
  MAX_TRANSFER_BUNDLE_BYTES,
  normalizedRule,
  parseTransferBundleText,
  readExistingTransferRules as readExisting,
  readTargetTransferEntities as readTargetEntities,
  record,
  ruleStatusKey,
  type AutomationMigrationSummary,
  type DeviceEntity,
  type DeviceIdentity,
  type RuleImportEntry,
  type RuleImportStatus,
  type RuleKind,
  type TargetEntity,
  type TransferBundle,
  type TransferImportProgress,
  type TransferImportResult,
  type TransferRule,
} from '@haus/core/transport';

export async function readBundle(file: File): Promise<TransferBundle> {
  if (file.size > MAX_TRANSFER_BUNDLE_BYTES) {
    throw new Error('The rule transfer file exceeds 1 MB.');
  }
  return parseTransferBundleText(await file.text(), file.size);
}
