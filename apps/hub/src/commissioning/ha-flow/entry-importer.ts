/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { isDeepStrictEqual } from 'node:util';
import type { IntegrationFlowStep } from '@haus/core';
import type { HaEntryImport, HaFlowRuntime, HaSyncEntryInput } from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import type { HubIntegrationEntryService, PersistedIntegrationEntry } from '../entries.js';
import type { EncryptedHaSecretsStore } from './helpers.js';

const REGISTRY_CONFLICT_RETRY_MS = 30_000;

interface HaEntryImporterHooks {
  ensureStarted: () => Promise<unknown>;
  getRuntime: () => HaFlowRuntime | undefined;
  supportsDomain: (domain: string) => boolean;
  persist: (
    step: IntegrationFlowStep,
    source: string,
  ) => Promise<PersistedIntegrationEntry | undefined>;
  syncAllState: () => Promise<void>;
  cancelPendingSync: () => void;
}

export interface HaRegistryRestoreIssue {
  readonly domain: string;
  readonly code: 'integration_entry_conflict' | 'integration_entity_conflict';
}

/** Stages HA credentials and registries while preserving their disabled ownership state. */
export class HaEntryImporter {
  private readonly importedRegistryFingerprints = new Map<string, string>();
  private readonly failedRegistryFingerprints = new Map<
    string,
    { readonly fingerprint: string; readonly retryAt: number }
  >();

  constructor(
    private readonly entries: HubIntegrationEntryService,
    private readonly secrets: EncryptedHaSecretsStore,
    private readonly home?: StandaloneHomeService,
    private readonly hooks?: HaEntryImporterHooks,
  ) {}

  reset(): void {
    this.importedRegistryFingerprints.clear();
    this.failedRegistryFingerprints.clear();
  }

  async restoreRegistries(
    runtime: Pick<HaFlowRuntime, 'importEntry'>,
    entries: readonly HaSyncEntryInput[],
  ): Promise<readonly HaRegistryRestoreIssue[]> {
    const issues: HaRegistryRestoreIssue[] = [];
    for (const entry of entries) {
      if (entry.source !== 'import') continue;
      const payload = await this.secrets.getEntryPayload(entry.entryId);
      const registry = payload?.registry;
      if (!registry) continue;
      const input: HaEntryImport = { entry, ...registry, restoreOnly: true };
      const fingerprint = this.registryFingerprint(input);
      if (this.importedRegistryFingerprints.get(entry.entryId) === fingerprint) continue;
      const previousFailure = this.failedRegistryFingerprints.get(entry.entryId);
      if (previousFailure?.fingerprint === fingerprint && previousFailure.retryAt > Date.now())
        continue;
      try {
        await runtime.importEntry(input);
        this.importedRegistryFingerprints.set(entry.entryId, fingerprint);
        this.failedRegistryFingerprints.delete(entry.entryId);
      } catch (cause: unknown) {
        const code = this.registryConflictCode(cause);
        if (!code) throw cause;
        this.failedRegistryFingerprints.set(entry.entryId, {
          fingerprint,
          retryAt: Date.now() + REGISTRY_CONFLICT_RETRY_MS,
        });
        if (previousFailure?.fingerprint !== fingerprint)
          issues.push({ domain: entry.domain, code });
      }
    }
    return issues;
  }

  async importEntry(input: HaEntryImport): Promise<{
    readonly entryId: string;
    readonly domain: string;
    readonly staged: true;
    readonly alreadyStaged: boolean;
  }> {
    const started = await this.hooks?.ensureStarted();
    const runtime = this.hooks?.getRuntime();
    const { entry } = input;
    if (!started || !runtime) throw new Error('ha_flow_runtime_unavailable');
    if (entry.disabledBy !== 'user') throw new Error('import_entry_must_be_disabled');
    if (!this.hooks?.supportsDomain(entry.domain)) throw new Error('unsupported_import_domain');

    await this.entries.ensureLoaded();
    await this.secrets.ensureLoaded();
    if (typeof entry.uniqueId === 'string' && entry.uniqueId) {
      const identityOwner = (await this.entries.listEntries()).find(
        (candidate) =>
          candidate.entry_id !== entry.entryId &&
          candidate.domain === entry.domain &&
          candidate.uniqueId === entry.uniqueId,
      );
      if (identityOwner) throw new Error('integration_entry_identity_conflict');
    }
    const existing = await this.entries.getEntry(entry.entryId);
    const existingPayload = await this.secrets.getEntryPayload(entry.entryId);
    if (existing) {
      if (
        existing.domain !== entry.domain ||
        existing.source !== 'migration' ||
        existing.disabled_by !== 'user' ||
        existing.state === 'loaded' ||
        existing.title !== entry.title ||
        existing.uniqueId !== entry.uniqueId ||
        existing.haVersion !== entry.version ||
        existing.haMinorVersion !== entry.minorVersion ||
        !isDeepStrictEqual(existingPayload?.data, entry.data) ||
        !isDeepStrictEqual(existingPayload?.options ?? {}, entry.options ?? {}) ||
        !isDeepStrictEqual(existingPayload?.registry?.subentries, entry.subentries)
      ) {
        throw new Error('integration_entry_conflict');
      }
    } else if (existingPayload) {
      throw new Error('integration_entry_conflict');
    }

    const registry = {
      entities: input.entities ?? [],
      devices: input.devices ?? [],
      areas: input.areas ?? [],
      ...(entry.subentries !== undefined ? { subentries: entry.subentries } : {}),
    };
    let persistedByThisCall = false;
    if (!existing) {
      const saved = await this.hooks?.persist(
        {
          type: 'create_entry',
          flowId: `migration_${entry.entryId}`,
          stepId: 'staged',
          handler: entry.domain,
          result: {
            entryId: entry.entryId,
            title: entry.title,
            data: entry.data,
            options: entry.options,
            uniqueId: entry.uniqueId,
            haVersion: entry.version,
            haMinorVersion: entry.minorVersion,
            disabledBy: 'user',
          },
        },
        'migration',
      );
      if (!saved) throw new Error('integration_entry_persistence_failed');
      persistedByThisCall = true;
      this.hooks?.cancelPendingSync();
    }

    try {
      await this.secrets.saveEntryPayload(entry.entryId, entry.data, entry.options, registry);
      // Import validates all registry identities before it mutates the runtime. Keep room and
      // Hub state changes after that check so a conflict cannot leave a partial migration.
      await runtime.importEntry(input);
      await this.ensureRooms(input.areas ?? []);
      this.importedRegistryFingerprints.set(entry.entryId, this.registryFingerprint(input));
      await this.hooks?.syncAllState();
    } catch (cause: unknown) {
      if (persistedByThisCall && this.isRegistryConflict(cause)) {
        await this.rollbackNewStage(entry.entryId, entry);
      }
      throw cause;
    }
    return {
      entryId: entry.entryId,
      domain: entry.domain,
      staged: true,
      alreadyStaged: Boolean(existing),
    };
  }

  private isRegistryConflict(cause: unknown): boolean {
    return this.registryConflictCode(cause) !== undefined;
  }

  private registryConflictCode(cause: unknown): HaRegistryRestoreIssue['code'] | undefined {
    if (!(cause instanceof Error)) return undefined;
    if (
      cause.message === 'integration_entry_conflict' ||
      cause.message === 'integration_entity_conflict'
    )
      return cause.message;
    return undefined;
  }

  private async rollbackNewStage(entryId: string, entry: HaSyncEntryInput): Promise<void> {
    this.importedRegistryFingerprints.delete(entryId);

    const current = await this.entries.getEntry(entryId);
    const payload = await this.secrets.getEntryPayload(entryId);
    if (
      !current ||
      current.source !== 'migration' ||
      current.disabled_by !== 'user' ||
      current.state === 'loaded' ||
      current.domain !== entry.domain ||
      current.title !== entry.title ||
      (current.uniqueId ?? null) !== (entry.uniqueId ?? null) ||
      current.haVersion !== (entry.version ?? 1) ||
      current.haMinorVersion !== (entry.minorVersion ?? 1) ||
      (payload &&
        (!isDeepStrictEqual(payload.data, entry.data) ||
          !isDeepStrictEqual(payload.options ?? {}, entry.options ?? {}) ||
          !isDeepStrictEqual(payload.registry?.subentries, entry.subentries)))
    ) {
      throw new Error('integration_import_rollback_conflict');
    }

    const removed = await this.entries.deleteEntry(entryId);
    if (!removed) throw new Error('integration_import_rollback_failed');
    await this.secrets.deleteEntryPayload(entryId);
  }

  private async ensureRooms(areas: NonNullable<HaEntryImport['areas']>): Promise<void> {
    const manager = this.home?.roomManager;
    if (!manager) return;
    for (const area of areas) {
      const name = area.name.trim();
      if (!name) continue;
      const normalized = name.toLocaleLowerCase();
      if (manager.listRooms().some((room) => room.name.trim().toLocaleLowerCase() === normalized))
        continue;
      await manager.createRoom({ name });
    }
  }

  /**
   * Hashes only static registry structure so runtime mutations to `entry.data` (e.g.
   * timestamps/tokens updated by loaded integrations like `meross_lan`) never re-trigger restore.
   */
  private registryFingerprint(input: HaEntryImport): string {
    return JSON.stringify({
      entryId: input.entry.entryId,
      domain: input.entry.domain,
      entities: input.entities ?? [],
      devices: input.devices ?? [],
      areas: input.areas ?? [],
      subentries: input.entry.subentries ?? [],
    });
  }
}
