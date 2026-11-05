/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { LocalAutomationEngine } from '@haus/core/automation';
import { convertHaAutomation } from './converter.js';
import type {
  MigrationDiff,
  MigrationItem,
  MigrationRollbackSnapshot,
} from './types.js';

export class AutomationMigrator {
  createMigrationDiff(
    haAutomations: readonly unknown[],
    _existingHausRuleIds: readonly string[] = [],
  ): MigrationDiff {
    const readyToMigrate: MigrationItem[] = [];
    const unsupported: MigrationItem[] = [];
    const haAutomationsToDisable: string[] = [];

    for (const raw of haAutomations) {
      const item = convertHaAutomation(raw);
      if (item.status === 'supported' && item.hausRule) {
        readyToMigrate.push(item);
        // HA automation entity ID format: automation.<alias_slug> or automation.<id>
        const entityId = item.haId.startsWith('automation.')
          ? item.haId
          : `automation.${item.haAlias.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || item.haId}`;
        haAutomationsToDisable.push(entityId);
      } else {
        unsupported.push(item);
      }
    }

    const totalCount = haAutomations.length;
    const supportedCount = readyToMigrate.length;
    const unsupportedCount = unsupported.length;

    return {
      readyToMigrate,
      unsupported,
      totalCount,
      supportedCount,
      unsupportedCount,
      duplicateActiveWarning: supportedCount > 0,
      haAutomationsToDisable,
    };
  }

  async applyMigration(
    diff: MigrationDiff,
    engine: LocalAutomationEngine,
    onDisableHaAutomation?: (haEntityId: string) => Promise<void>,
  ): Promise<MigrationRollbackSnapshot> {
    const createdHausRuleIds: string[] = [];
    const disabledHaAutomationIds: string[] = [];

    // 1. Register rules in local Haus automation engine
    for (const item of diff.readyToMigrate) {
      if (item.hausRule) {
        engine.registerRule(item.hausRule);
        createdHausRuleIds.push(item.hausRule.id);
      }
    }

    // 2. Prevent duplicate active automation: disable source automations in Home Assistant
    if (onDisableHaAutomation) {
      for (const haEntityId of diff.haAutomationsToDisable) {
        try {
          await onDisableHaAutomation(haEntityId);
          disabledHaAutomationIds.push(haEntityId);
        } catch {
          // Record failed disable attempts if needed
        }
      }
    }

    return {
      migratedAt: new Date().toISOString(),
      createdHausRuleIds,
      disabledHaAutomationIds,
    };
  }

  async rollback(
    snapshot: MigrationRollbackSnapshot,
    engine: LocalAutomationEngine,
    onEnableHaAutomation?: (haEntityId: string) => Promise<void>,
  ): Promise<void> {
    // 1. Unregister all migrated Haus rules
    for (const ruleId of snapshot.createdHausRuleIds) {
      engine.unregisterRule(ruleId);
    }

    // 2. Re-enable previously disabled Home Assistant automations
    if (onEnableHaAutomation) {
      for (const haEntityId of snapshot.disabledHaAutomationIds) {
        try {
          await onEnableHaAutomation(haEntityId);
        } catch {
          // Continue best-effort rollback
        }
      }
    }
  }
}
