/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowCatalogManifest } from '@haus/core';
import type {
  HaEntityImageResult,
  HaFlowRuntime,
  HaSyncEntryInput,
  HaUpdateReleaseNotesResult,
} from '@haus/kitsune';
import type { PersistedIntegrationEntry } from '../entry-helpers.js';
import { resolveHaDataDir, type EncryptedHaSecretsStore } from './helpers.js';

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

export async function getEntityImage(
  entityId: string,
  ensureStarted: EnsureRuntime,
  getRuntime: GetRuntime,
): Promise<HaEntityImageResult> {
  await ensureStarted();
  const runtime = getRuntime();
  if (!runtime) throw new Error('ha_flow_runtime_unavailable');
  return runtime.entityImage(entityId);
}

export async function getUpdateReleaseNotes(
  entityId: string,
  ensureStarted: EnsureRuntime,
  getRuntime: GetRuntime,
): Promise<HaUpdateReleaseNotesResult> {
  await ensureStarted();
  const runtime = getRuntime();
  if (!runtime) throw new Error('ha_flow_runtime_unavailable');
  return runtime.updateReleaseNotes(entityId);
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

export function readInstalledCustomManifests(
  customComponentsDir = join(resolveHaDataDir(), 'config', 'custom_components'),
): readonly FlowCatalogManifest[] {
  const manifests: FlowCatalogManifest[] = [];
  let entries: string[];
  try {
    entries = readdirSync(customComponentsDir);
  } catch {
    return manifests;
  }
  for (const dir of entries) {
    if (!dir || dir.startsWith('.') || dir === '__pycache__') continue;
    try {
      const raw = JSON.parse(
        readFileSync(join(customComponentsDir, dir, 'manifest.json'), 'utf8'),
      ) as Record<string, unknown>;
      const domain = typeof raw.domain === 'string' && raw.domain ? raw.domain : dir;
      const name = typeof raw.name === 'string' && raw.name ? raw.name : domain;
      manifests.push({
        domain,
        name,
        ...(typeof raw.documentation === 'string' ? { documentation: raw.documentation } : {}),
        ...(typeof raw.iot_class === 'string' ? { iot_class: raw.iot_class } : {}),
        ...(typeof raw.config_flow === 'boolean' ? { config_flow: raw.config_flow } : {}),
        ...(typeof raw.single_config_entry === 'boolean'
          ? { single_config_entry: raw.single_config_entry }
          : {}),
      });
    } catch {
      // Skip incomplete or non-integration directories.
    }
  }
  return manifests;
}

export function mergeManifestTitleTranslations(
  resources: Record<string, string>,
  catalog: {
    getManifest(domain: string): { readonly domain: string; readonly name?: string } | undefined;
    getAllManifests(): readonly { readonly domain: string; readonly name?: string }[];
  },
  integrations?: readonly string[],
  customManifests: readonly { readonly domain: string; readonly name?: string }[] = [],
): Record<string, string> {
  const merged = { ...resources };
  const filterSet = integrations && integrations.length > 0 ? new Set(integrations) : undefined;
  const manifests = filterSet
    ? [
        ...integrations!
          .map((domain) => catalog.getManifest(domain))
          .filter((item): item is { readonly domain: string; readonly name?: string } =>
            Boolean(item),
          ),
        ...customManifests.filter((item) => filterSet.has(item.domain)),
      ]
    : [...catalog.getAllManifests(), ...customManifests];
  for (const manifest of manifests) {
    const key = `component.${manifest.domain}.title`;
    if (!merged[key] && manifest.name) merged[key] = manifest.name;
  }
  return merged;
}

export async function resolveHaTranslations(params: {
  readonly category: string;
  readonly integrations?: readonly string[];
  readonly catalog: {
    getTranslations(): {
      getFlattenedCategory(
        category: string,
        integrations?: readonly string[],
      ): Record<string, string>;
    };
    getCatalog(): {
      getManifest(domain: string): { readonly domain: string; readonly name?: string } | undefined;
      getAllManifests(): readonly { readonly domain: string; readonly name?: string }[];
    };
  };
  readonly runtime?: HaFlowRuntime;
  readonly ensureStarted: EnsureRuntime;
}): Promise<Readonly<Record<string, string>>> {
  const { category, integrations, catalog, runtime, ensureStarted } = params;
  const base = catalog.getTranslations().getFlattenedCategory(category, integrations);
  const resources =
    category === 'title'
      ? mergeManifestTitleTranslations(
          base,
          catalog.getCatalog(),
          integrations,
          readInstalledCustomManifests(),
        )
      : base;

  // Query live runtime for any domain missing from the prebuilt bundle (e.g. HACS/custom).
  if (integrations && integrations.length > 0 && runtime) {
    const missing = integrations.filter((dom) => {
      const prefix = `component.${dom}.`;
      return !Object.keys(resources).some((k) => k.startsWith(prefix));
    });
    if (missing.length > 0) {
      try {
        await ensureStarted();
        const live = await runtime.getTranslations({
          categories: [category],
          integrations: missing,
        });
        return { ...live.translations, ...resources };
      } catch {
        return resources;
      }
    }
  }
  return resources;
}
