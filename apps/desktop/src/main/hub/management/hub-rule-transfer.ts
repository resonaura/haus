/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isRecord } from '../types';

export interface HaRuleMigration {
  readonly sourceEntityId: string;
  readonly sourceEnabled: boolean;
}

export function haMigration(
  body: Record<string, unknown>,
  kind: 'automation' | 'script',
): HaRuleMigration | undefined {
  if (body._hausMigration === undefined) return undefined;
  const migration = isRecord(body._hausMigration) ? body._hausMigration : undefined;
  const pattern = kind === 'automation' ? /^automation\.[a-z0-9_]+$/ : /^script\.[a-z0-9_]+$/;
  if (
    !migration ||
    migration.source !== 'home_assistant' ||
    migration.schemaVersion !== 1 ||
    typeof migration.sourceEntityId !== 'string' ||
    !pattern.test(migration.sourceEntityId) ||
    (kind === 'automation' && typeof migration.sourceEnabled !== 'boolean')
  ) {
    throw new Error('The Home Assistant rule transfer metadata is invalid.');
  }
  return {
    sourceEntityId: migration.sourceEntityId,
    sourceEnabled: migration.sourceEnabled === true,
  };
}

export function ruleRecordArray(
  value: unknown,
  strict: boolean,
  error: string,
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (strict && value.some((item) => !isRecord(item))) throw new Error(error);
    return value.filter(isRecord);
  }
  if (isRecord(value)) return [value];
  if (strict) throw new Error(error);
  return [];
}

export function ruleStepArray(value: unknown, strict: boolean): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : isRecord(value) ? [value] : undefined;
  if (!items) {
    if (strict) throw new Error('automation_action_required');
    return [];
  }
  return items.flatMap((item) => {
    if (isRecord(item)) return [item];
    if (Array.isArray(item)) return [{ parallel: item }];
    if (strict) throw new Error('unsupported_automation_action');
    return [];
  });
}
