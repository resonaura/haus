/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type EditableKind = 'scene' | 'automation';
export type EditableConfig = Record<string, unknown>;

export interface ManagementRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly data?: unknown;
}

export interface ManagementPort {
  management<T = unknown>(input: ManagementRequest): Promise<T>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function editableConfigPath(kind: EditableKind, id: string): string {
  if (!/^[a-z0-9_-]{1,128}$/i.test(id)) {
    throw new Error('This item is not stored in an editable configuration file.');
  }
  return `config/${kind}/config/${id}`;
}

export function canonicalConfigJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

export function validateEditableConfig(kind: EditableKind, config: EditableConfig): string {
  const nameKey = kind === 'scene' ? 'name' : 'alias';
  const rawName = config[nameKey];
  if (typeof rawName !== 'string') throw new Error('Give this item a name.');
  const name = rawName.trim();
  if (!name) throw new Error('Give this item a name.');

  if (kind === 'scene') {
    if (!isRecord(config.entities) || !Object.keys(config.entities).length) {
      throw new Error('Add at least one accessory to the scene.');
    }
    return name;
  }

  if (!config.use_blueprint) {
    const triggers = config.triggers ?? config.trigger;
    const actions = config.actions ?? config.action;
    if (
      [triggers, actions].some(
        (value) => value === undefined || value === null || (Array.isArray(value) && !value.length),
      )
    ) {
      throw new Error('Add a trigger and an action.');
    }
  }
  return name;
}

export function readEditableConfig(
  port: ManagementPort,
  kind: EditableKind,
  id: string,
): Promise<EditableConfig> {
  return port.management<EditableConfig>({ method: 'GET', path: editableConfigPath(kind, id) });
}

export async function saveEditableConfig(
  port: ManagementPort,
  kind: EditableKind,
  id: string,
  config: EditableConfig,
  original?: EditableConfig,
): Promise<void> {
  const name = validateEditableConfig(kind, config);
  const path = editableConfigPath(kind, id);
  if (original) {
    const current = await readEditableConfig(port, kind, id);
    if (canonicalConfigJson(current) !== canonicalConfigJson(original)) {
      throw new Error(
        'This configuration changed remotely. Close and reopen it before saving so those changes are preserved.',
      );
    }
  }
  await port.management({
    method: 'POST',
    path,
    data: { ...config, [kind === 'scene' ? 'name' : 'alias']: name },
  });
}

export async function deleteEditableConfig(
  port: ManagementPort,
  kind: EditableKind,
  id: string,
): Promise<void> {
  await port.management({ method: 'DELETE', path: editableConfigPath(kind, id) });
}

export async function cutoverHaAutomation(
  port: ManagementPort,
  ruleId: string,
  sourceEntityId: string,
): Promise<void> {
  const response = await port.management({
    method: 'POST',
    path: 'haus/rules/automations/cutover',
    data: { id: ruleId, sourceEntityId, confirmSourceDisabled: true },
  });
  const root = isRecord(response) ? response : undefined;
  const automation = isRecord(root?.automation) ? root.automation : undefined;
  const metadata = isRecord(automation?.metadata) ? automation.metadata : undefined;
  const migration = isRecord(metadata?.migration) ? metadata.migration : undefined;
  if (automation?.enabled !== true || typeof migration?.cutoverAt !== 'string') {
    throw new Error('cutover_verification_failed');
  }
}
