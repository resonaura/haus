/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isRecord } from '../types';
import type { HubAutomationsContext } from './hub-rules-projection';

type RuleManagementInput = { method?: unknown; path?: unknown; data?: unknown };
type RuleManagementResult = { handled: true; result: unknown } | { handled: false };

function methodOf(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : 'GET';
}

async function cutOverAutomation(value: unknown, ctx: HubAutomationsContext): Promise<unknown> {
  const input = isRecord(value) ? value : undefined;
  if (
    !input ||
    input.confirmSourceDisabled !== true ||
    typeof input.id !== 'string' ||
    !/^[a-z0-9_-]{1,128}$/.test(input.id) ||
    typeof input.sourceEntityId !== 'string' ||
    !/^automation\.[a-z0-9_]+$/.test(input.sourceEntityId)
  ) {
    throw new Error('automation_import_cutover_confirmation_required');
  }

  const response: unknown = await ctx.api('/api/automations');
  const body = isRecord(response) ? response.automations : undefined;
  if (!Array.isArray(body)) throw new Error('automation_import_cutover_list_unavailable');
  const matches = body.filter((rule) => isRecord(rule) && rule.id === input.id);
  if (matches.length !== 1 || !isRecord(matches[0])) {
    throw new Error('automation_import_cutover_target_missing');
  }

  const current = matches[0];
  const metadata = isRecord(current.metadata) ? current.metadata : undefined;
  const migration = metadata && isRecord(metadata.migration) ? metadata.migration : undefined;
  if (migration?.source !== 'home_assistant' || migration.sourceEntityId !== input.sourceEntityId) {
    throw new Error('automation_import_cutover_source_mismatch');
  }
  if (typeof migration.cutoverAt === 'string') {
    if (current.enabled === true) return { automation: current, alreadyCutOver: true };
    throw new Error('automation_import_cutover_target_not_active');
  }
  if (current.enabled !== false) {
    throw new Error('automation_import_cutover_target_not_paused');
  }

  const cutoverAt = new Date().toISOString();
  const updated = {
    ...current,
    enabled: true,
    metadata: {
      ...metadata,
      migration: { ...migration, sourceEnabled: false, cutoverAt },
    },
  };
  await ctx.api('/api/automations', { method: 'POST', body: updated });

  const verifiedResponse: unknown = await ctx.api('/api/automations');
  const verifiedBody = isRecord(verifiedResponse) ? verifiedResponse.automations : undefined;
  const verified = Array.isArray(verifiedBody)
    ? verifiedBody.filter((rule) => isRecord(rule) && rule.id === input.id)
    : [];
  const saved = verified[0];
  const savedMetadata = isRecord(saved) && isRecord(saved.metadata) ? saved.metadata : undefined;
  const savedMigration =
    savedMetadata && isRecord(savedMetadata.migration) ? savedMetadata.migration : undefined;
  if (
    verified.length !== 1 ||
    !isRecord(saved) ||
    saved.enabled !== true ||
    savedMigration?.sourceEntityId !== input.sourceEntityId ||
    savedMigration.cutoverAt !== cutoverAt
  ) {
    throw new Error('automation_import_cutover_verification_failed');
  }

  await ctx.refresh();
  return { automation: saved, alreadyCutOver: false };
}

export async function handleHaRuleManagement(
  input: RuleManagementInput,
  ctx: HubAutomationsContext,
): Promise<RuleManagementResult> {
  const path = typeof input.path === 'string' ? input.path : '';
  const method = methodOf(input.method);
  if (path === 'haus/rules/entities') {
    if (method !== 'GET') throw new Error('Entity alias access is read-only.');
    const devices = new Map(
      ctx
        .getView()
        .devices.flatMap((value) =>
          isRecord(value) && typeof value.id === 'string' ? [[value.id, value] as const] : [],
        ),
    );
    const entities = ctx.getView().entities.flatMap((value) => {
      if (!isRecord(value)) return [];
      const entityId = value.entity_id;
      const deviceId = value.device_id;
      if (typeof entityId !== 'string' || typeof deviceId !== 'string') return [];
      const domain = entityId.split('.', 1)[0];
      const device = devices.get(deviceId);
      const deviceIdentifiers = Array.isArray(device?.identifiers)
        ? device.identifiers.filter(
            (pair): pair is [string, string] =>
              Array.isArray(pair) &&
              pair.length === 2 &&
              typeof pair[0] === 'string' &&
              typeof pair[1] === 'string',
          )
        : undefined;
      return [
        {
          entityId,
          deviceId,
          domain,
          ...(typeof value.platform === 'string' ? { platform: value.platform } : {}),
          ...(typeof value.unique_id === 'string' ? { uniqueId: value.unique_id } : {}),
          ...(typeof value.original_name === 'string' ? { name: value.original_name } : {}),
          ...(deviceIdentifiers?.length ? { deviceIdentifiers } : {}),
        },
      ];
    });
    return { handled: true, result: { entities } };
  }
  if (path === 'haus/rules/automations/cutover') {
    if (method !== 'POST') throw new Error('Automation cutover requires an explicit POST.');
    return { handled: true, result: await cutOverAutomation(input.data, ctx) };
  }
  return { handled: false };
}
