/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HaFlowRuntime, HaSyncEntryInput } from '@haus/kitsune';
import type { PersistedIntegrationEntry } from '../entry-helpers.js';
import type { EncryptedHaSecretsStore } from './helpers.js';

type EnsureRuntime = () => Promise<unknown>;
type GetRuntime = () => HaFlowRuntime | undefined;

export async function getHueSceneDiagnostics(
  entryId: string,
  ensureStarted: EnsureRuntime,
  getRuntime: GetRuntime,
): Promise<{ data: Record<string, unknown> }> {
  await ensureStarted();
  const runtime = getRuntime();
  if (!runtime) throw new Error('ha_flow_runtime_unavailable');
  return runtime.hueSceneDiagnostics(entryId);
}

export async function uploadRuntimeFile(
  filename: string,
  content: Buffer,
  ensureStarted: EnsureRuntime,
  getRuntime: GetRuntime,
): Promise<{ readonly fileId: string; readonly file_id: string }> {
  await ensureStarted();
  const runtime = getRuntime();
  if (!runtime) throw new Error('ha_flow_runtime_unavailable');
  const result = await runtime.uploadFile(filename, content.toString('base64'));
  return { fileId: result.fileId, file_id: result.fileId };
}

export async function verifyDomainEntriesAfterUpdate(params: {
  readonly entryIds: readonly string[];
  readonly reloadEntry: (entryId: string) => Promise<{
    readonly ok: boolean;
    readonly state?: string;
    readonly reason?: string;
  }>;
}): Promise<{
  readonly ok: boolean;
  readonly reauthRequired?: boolean;
  readonly reason?: string;
}> {
  let reauthRequired = false;
  for (const entryId of params.entryIds) {
    try {
      const res = await params.reloadEntry(entryId);
      if (res.state === 'reauth_required' || res.reason?.includes('reauth')) {
        reauthRequired = true;
        continue;
      }
      if (!res.ok) {
        return { ok: false, reason: res.reason ?? `entry_reload_failed:${entryId}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('reauth') || msg.toLowerCase().includes('auth')) {
        reauthRequired = true;
        continue;
      }
      return { ok: false, reason: msg };
    }
  }
  return { ok: true, ...(reauthRequired ? { reauthRequired: true } : {}) };
}

export async function buildHaSyncEntries(
  activeEntries: readonly PersistedIntegrationEntry[],
  secretsStore: EncryptedHaSecretsStore,
): Promise<HaSyncEntryInput[]> {
  const haEntries: HaSyncEntryInput[] = [];
  for (const entry of activeEntries) {
    if (entry.source === 'app' || entry.source === 'homebridge' || entry.source === 'scrypted') {
      continue;
    }
    const unsealed = await secretsStore.getEntryPayload(entry.entry_id);
    haEntries.push({
      entryId: entry.entry_id,
      uniqueId: entry.uniqueId,
      version: entry.haVersion,
      minorVersion: entry.haMinorVersion,
      domain: entry.domain,
      title: entry.title,
      source: entry.source === 'migration' ? 'import' : entry.source,
      disabledBy: entry.disabled_by ?? null,
      data: unsealed?.data ?? entry.data,
      options: unsealed?.options ?? entry.options,
      ...(unsealed?.registry?.subentries !== undefined
        ? { subentries: unsealed.registry.subentries }
        : {}),
    });
  }
  return haEntries;
}

export function collectHaAreaNames(
  devices: ReadonlyArray<{ readonly areaId?: string; readonly roomId?: string }>,
): Array<{ name: string }> {
  const areaNames = new Set<string>();
  for (const dev of devices) {
    const name = dev.areaId ?? dev.roomId;
    if (name?.trim()) areaNames.add(name.trim());
  }
  return Array.from(areaNames).map((name) => ({ name }));
}
