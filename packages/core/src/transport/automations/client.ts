/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ManagementPort } from '../config-editor.js';
import { buildInitialTransferEntries } from './bundle.js';
import { friendlyTransferError } from './errors.js';
import { buildEntityAliases, normalizedRule } from './normalize.js';
import {
  asRecord,
  type DeviceIdentity,
  type RuleImportEntry,
  type RuleKind,
  type TargetEntity,
  type TransferBundle,
  type TransferImportProgress,
  type TransferImportResult,
  type TransferRule,
} from './types.js';

export function ruleStatusKey(kind: RuleKind, rule: Pick<TransferRule, 'id'>): string {
  return `${kind}:${rule.id}`;
}

export async function readExistingTransferRules(
  port: ManagementPort,
  kind: RuleKind,
): Promise<Map<string, Record<string, unknown>>> {
  const response = await port.management({
    method: 'GET',
    path: `haus/rules/${kind === 'automation' ? 'automations' : 'scripts'}`,
  });
  const body = asRecord(response);
  const list = body?.[kind === 'automation' ? 'automations' : 'scripts'];
  if (!Array.isArray(list)) {
    throw new Error('Haus could not verify its current rules before import.');
  }
  return new Map(
    list.flatMap((value) => {
      const item = asRecord(value);
      return typeof item?.id === 'string' ? [[item.id, item] as const] : [];
    }),
  );
}

export async function readTargetTransferEntities(port: ManagementPort): Promise<TargetEntity[]> {
  const response = await port.management({
    method: 'GET',
    path: 'haus/rules/entities',
  });
  const body = asRecord(response);
  if (!Array.isArray(body?.entities)) {
    throw new Error('Haus could not verify its current entities before import.');
  }
  return body.entities.flatMap((value) => {
    const item = asRecord(value);
    if (
      !item ||
      typeof item.entityId !== 'string' ||
      !/^[a-z_]+\.[a-z0-9_]+$/.test(item.entityId) ||
      typeof item.deviceId !== 'string' ||
      !item.deviceId ||
      typeof item.domain !== 'string' ||
      item.domain !== item.entityId.split('.', 1)[0] ||
      (item.platform !== undefined &&
        (typeof item.platform !== 'string' || !/^[a-z0-9_]{1,128}$/.test(item.platform))) ||
      (item.uniqueId !== undefined && typeof item.uniqueId !== 'string') ||
      (item.name !== undefined && typeof item.name !== 'string')
    ) {
      return [];
    }
    const rawIdentifiers = item.deviceIdentifiers;
    let deviceIdentifiers: DeviceIdentity[] | undefined;
    if (rawIdentifiers !== undefined) {
      if (!Array.isArray(rawIdentifiers) || rawIdentifiers.length > 64) return [];
      const parsed: DeviceIdentity[] = [];
      for (const pair of rawIdentifiers) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== 'string' ||
          typeof pair[1] !== 'string' ||
          pair[0].trim().length === 0 ||
          pair[1].trim().length === 0 ||
          pair[0].length > 1024 ||
          pair[1].length > 1024
        ) {
          return [];
        }
        parsed.push([pair[0], pair[1]]);
      }
      deviceIdentifiers = parsed;
    }
    return [
      {
        entityId: item.entityId,
        deviceId: item.deviceId,
        domain: item.domain,
        ...(typeof item.platform === 'string' ? { platform: item.platform } : {}),
        ...(typeof item.uniqueId === 'string' ? { uniqueId: item.uniqueId } : {}),
        ...(deviceIdentifiers ? { deviceIdentifiers } : {}),
        ...(typeof item.name === 'string' ? { name: item.name } : {}),
      },
    ];
  });
}

export async function importTransferBundle(
  port: ManagementPort,
  bundle: TransferBundle,
  onProgress?: (progress: TransferImportProgress) => void,
): Promise<TransferImportResult> {
  const [existingScripts, existingAutomations, targetEntities] = await Promise.all([
    readExistingTransferRules(port, 'script'),
    readExistingTransferRules(port, 'automation'),
    readTargetTransferEntities(port),
  ]);
  const entityAliases = buildEntityAliases(bundle, targetEntities);
  let entries: RuleImportEntry[] = buildInitialTransferEntries(bundle);
  let saved = 0;
  let completed = 0;

  const updateEntry = (key: string, patch: Partial<RuleImportEntry>) => {
    entries = entries.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry));
  };

  const rules: Array<{
    readonly kind: RuleKind;
    readonly rule: TransferRule;
    readonly existing: ReadonlyMap<string, Record<string, unknown>>;
  }> = [
    ...bundle.scripts.map((rule) => ({
      kind: 'script' as const,
      rule,
      existing: existingScripts,
    })),
    ...bundle.automations.map((rule) => ({
      kind: 'automation' as const,
      rule,
      existing: existingAutomations,
    })),
  ];

  for (let index = 0; index < rules.length; index += 1) {
    const item = rules[index];
    if (!item) continue;
    const { kind, rule, existing } = item;
    const key = ruleStatusKey(kind, rule);
    const current = existing.get(rule.id);
    if (current) {
      const metadata = asRecord(current.metadata);
      const migration = asRecord(metadata?.migration);
      if (migration?.sourceEntityId === rule.sourceEntityId) {
        updateEntry(key, { status: 'skipped', reason: 'Already imported; no changes made.' });
      } else {
        updateEntry(key, { status: 'failed', reason: 'This Haus ID belongs to a different rule.' });
      }
      completed = index + 1;
      onProgress?.({ entries, completed, saved });
      continue;
    }
    try {
      const data = normalizedRule(rule, kind, bundle, entityAliases);
      await port.management({
        method: 'POST',
        path: `config/${kind}/config/${encodeURIComponent(rule.id)}`,
        data,
      });
      saved += 1;
      updateEntry(key, {
        status: 'saved',
        reason: 'Saved disabled on Haus; Home Assistant stays active.',
      });
    } catch (cause) {
      updateEntry(key, {
        status: 'failed',
        reason: friendlyTransferError(cause instanceof Error ? cause.message : ''),
      });
    }
    completed = index + 1;
    onProgress?.({ entries, completed, saved });
  }

  return { entries, completed, saved };
}

export function simulateDemoTransferImport(
  bundle: TransferBundle,
  onProgress?: (progress: TransferImportProgress) => void,
): TransferImportResult {
  const aliases = new Map<string, string>();
  for (const entityId of Object.values(bundle.registryEntityIds)) {
    aliases.set(entityId, entityId);
  }
  for (const deviceList of Object.values(bundle.deviceEntities)) {
    for (const entity of deviceList) {
      aliases.set(entity.entityId, entity.entityId);
    }
  }
  const initial = buildInitialTransferEntries(bundle);
  let entries: RuleImportEntry[] = initial;
  let saved = 0;
  let completed = 0;

  const rules: Array<{ readonly kind: RuleKind; readonly rule: TransferRule }> = [
    ...bundle.scripts.map((rule) => ({ kind: 'script' as const, rule })),
    ...bundle.automations.map((rule) => ({ kind: 'automation' as const, rule })),
  ];

  for (let index = 0; index < rules.length; index += 1) {
    const item = rules[index];
    if (!item) continue;
    const key = ruleStatusKey(item.kind, item.rule);
    try {
      normalizedRule(item.rule, item.kind, bundle, aliases);
      saved += 1;
      entries = entries.map((entry) =>
        entry.key === key
          ? {
              ...entry,
              status: 'saved',
              reason: 'Saved disabled in demo preview; Home Assistant stays active.',
            }
          : entry,
      );
    } catch (cause) {
      const reason = friendlyTransferError(cause instanceof Error ? cause.message : '');
      entries = entries.map((entry) =>
        entry.key === key ? { ...entry, status: 'failed', reason } : entry,
      );
    }
    completed = index + 1;
    onProgress?.({ entries, completed, saved });
  }

  return { entries, completed, saved };
}
