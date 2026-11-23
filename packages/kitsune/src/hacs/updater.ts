/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppCatalog } from '@haus/apps';
import {
  downloadHacsArchive,
  extractAndStageHacsComponent,
  scanInstalledCustomComponents,
  swapStagedComponent,
  writeAtomicJson,
  type HacsInstallReceipt,
} from './archive-stage.js';
import { HacsDefaultCatalog } from './default-catalog.js';
import {
  buildHacsRepositoryCatalog,
  executeHacsRpcCommand,
  findTargetHacsRepository,
  resolveRemoteRelease,
  type PersistedHacsState,
  type PersistedRepoSettings,
} from './repository-catalog.js';
import {
  checkRequirementConflicts,
  evaluateHacsCompatibility,
  type HacsBatchUpdateResult,
  type HacsEntryCheckpoint,
  type HacsEntryVersionRef,
  type HacsRepositoryView,
  type HacsRuntimeHooks,
  type HacsUpdateManagerOptions,
  type HacsUpdateOperation,
  type HacsUpdatePhase,
} from './update-types.js';
import {
  loadPersistedHacsUpdaterState,
  recoverInterruptedHacsOperations,
  resolveFailedHacsUpdateRollback,
  runHacsBatchUpdates,
} from './update-rollback.js';

export type { HacsUpdateManagerOptions };

export class HacsUpdateManager {
  private readonly storageDir: string;
  private readonly customComponentsDir: string;
  private readonly stagingRoot: string;
  private readonly backupRoot: string;
  private fetchImpl: typeof fetch;
  private hooks: HacsRuntimeHooks;
  private readonly networkTimeoutMs: number;
  private stateLoaded = false;
  private state: PersistedHacsState = { repositories: {}, acknowledgedCritical: [], removed: [] };
  private readonly operations = new Map<string, HacsUpdateOperation>();
  private readonly inFlight = new Map<string, Promise<HacsUpdateOperation>>();
  private mutationQueue: Promise<unknown> = Promise.resolve();
  readonly defaultCatalog: HacsDefaultCatalog;
  private onCatalogChanged?: () => Promise<void>;

  constructor(options: HacsUpdateManagerOptions) {
    this.storageDir = resolve(options.storageDir);
    this.customComponentsDir = resolve(options.customComponentsDir);
    this.stagingRoot = join(this.storageDir, 'hacs-staging');
    this.backupRoot = join(this.storageDir, 'hacs-backup');
    this.fetchImpl = options.fetchFn ?? fetch;
    this.hooks = options.hooks ?? {};
    this.networkTimeoutMs = options.networkTimeoutMs ?? 5_000;
    this.defaultCatalog = new HacsDefaultCatalog(this.storageDir, this.fetchImpl);
  }

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
    this.defaultCatalog.setFetchForTesting(fetchFn);
  }
  setHooks(hooks: HacsRuntimeHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }
  setOnCatalogChanged(listener?: () => Promise<void>): void {
    this.onCatalogChanged = listener;
  }
  async syncIntoAppCatalog(
    appCatalog: AppCatalog,
    configuredEntries: readonly HacsEntryVersionRef[] = [],
  ): Promise<number> {
    const repos = await this.listRepositories(configuredEntries, false);
    return this.defaultCatalog.syncRepositoriesIntoAppCatalog(appCatalog, repos);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.stateLoaded) return;
    this.stateLoaded = true;
    const loaded = await loadPersistedHacsUpdaterState(this.storageDir);
    if (loaded.state) this.state = loaded.state;
    for (const op of loaded.operations) this.operations.set(op.operationId, op);
  }

  private async saveState(): Promise<void> {
    await writeAtomicJson(this.storageDir, 'hacs-state.json', this.state);
  }

  private async saveOperation(op: HacsUpdateOperation): Promise<HacsUpdateOperation> {
    this.operations.set(op.operationId, op);
    this.hooks.onProgress?.(op);
    await writeAtomicJson(
      this.storageDir,
      'hacs-operations.json',
      Array.from(this.operations.values()).slice(-100),
    );
    return op;
  }

  private advanceOp(
    op: HacsUpdateOperation,
    patch: Partial<HacsUpdateOperation>,
  ): Promise<HacsUpdateOperation> {
    return this.saveOperation({
      ...op,
      ...patch,
      revision: op.revision + 1,
      updatedAt: new Date().toISOString(),
    });
  }

  private upsertRepoState(
    repo: HacsRepositoryView,
    domain: string,
    patch: Partial<PersistedRepoSettings>,
  ): void {
    const base = this.state.repositories[repo.id] ?? {
      id: repo.id,
      fullName: repo.full_name,
      domain,
      title: repo.name,
      category: repo.category,
    };
    this.state.repositories[repo.id] = { ...base, ...patch };
  }

  async recoverInterruptedOperations(): Promise<readonly HacsUpdateOperation[]> {
    await this.ensureLoaded();
    return recoverInterruptedHacsOperations({
      operations: this.operations.values(),
      backupRoot: this.backupRoot,
      customComponentsDir: this.customComponentsDir,
      hooks: this.hooks,
      advanceOp: (op, patch) => this.advanceOp(op, patch),
    });
  }

  getOperation(operationId: string): HacsUpdateOperation | undefined {
    return this.operations.get(operationId);
  }

  listOperations(): readonly HacsUpdateOperation[] {
    return Array.from(this.operations.values());
  }

  async listRepositories(
    configuredEntries: readonly HacsEntryVersionRef[] = [],
    refreshRemote = false,
  ): Promise<readonly HacsRepositoryView[]> {
    await this.ensureLoaded();
    const list = await buildHacsRepositoryCatalog({
      customComponentsDir: this.customComponentsDir,
      state: this.state,
      configuredEntries,
      refreshRemote,
      runtimeHaVersion: this.hooks.getRuntimeHaVersion?.(),
      fetchImpl: this.fetchImpl,
      timeoutMs: this.networkTimeoutMs,
      defaultCatalogItems: this.defaultCatalog.list(),
    });
    if (refreshRemote) await this.saveState().catch(() => undefined);
    return list;
  }

  private async resolveTargetRepository(
    identifier: string,
    configuredEntries: readonly HacsEntryVersionRef[] = [],
  ): Promise<HacsRepositoryView> {
    return findTargetHacsRepository(
      await this.listRepositories(configuredEntries, false),
      identifier,
    );
  }

  async installUpdate(
    identifier: string,
    options: {
      readonly version?: string;
      readonly expectedDigest?: string;
      readonly activate?: boolean;
      readonly configuredEntries?: readonly HacsEntryVersionRef[];
    } = {},
  ): Promise<HacsUpdateOperation> {
    await this.ensureLoaded();
    const repo = await this.resolveTargetRepository(identifier, options.configuredEntries);
    const domain =
      repo.domain ?? repo.full_name.split('/')[1]?.toLowerCase().replaceAll('-', '_') ?? repo.id;
    const targetId = `hacs:${domain}`;
    const versionKey = `${targetId}@${options.version ?? 'latest'}`;
    const existing = this.inFlight.get(versionKey);
    if (existing) return existing;
    const run = this.enqueueMutation(() =>
      this.performInstall(repo, domain, targetId, options),
    ).finally(() => this.inFlight.delete(versionKey));
    this.inFlight.set(versionKey, run);
    return run;
  }

  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(task, task);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async performInstall(
    repo: HacsRepositoryView,
    domain: string,
    targetId: string,
    options: {
      readonly version?: string;
      readonly expectedDigest?: string;
      readonly activate?: boolean;
    },
  ): Promise<HacsUpdateOperation> {
    for (const op of this.operations.values()) {
      if (op.targetId === targetId && op.rollbackOutcome === 'unresolved_migration') {
        throw new Error('unresolved_previous_operation');
      }
    }
    if (repo.category !== 'integration')
      throw new Error(`unsupported_hacs_category:${repo.category}`);

    const operationId = `hacs-op-${randomUUID()}`;
    const now = new Date().toISOString();
    const installedVersion = repo.installed_version ?? '0.0.0';
    const affectedEntries = (await this.hooks.getAffectedEntries?.(domain)) ?? [];

    let op = await this.saveOperation({
      operationId,
      targetId,
      repositoryId: repo.id,
      repository: repo.full_name,
      domain,
      title: repo.name,
      installedVersion,
      targetVersion: options.version ?? repo.available_version ?? installedVersion,
      phase: 'review',
      revision: 1,
      bytesReceived: 0,
      compatibility: repo.compatibility,
      compatibilityReason: repo.compatibility_reason,
      affectedEntries,
      startedAt: now,
      updatedAt: now,
    });

    let currentPhase: HacsUpdatePhase = 'review';
    const stageDir = join(this.stagingRoot, operationId, domain);
    const backupDir = join(this.backupRoot, `${domain}-${operationId}`);
    const targetDir = join(this.customComponentsDir, domain);
    let backupCreated = false;
    let codeSwapped = false;
    let checkpoints: readonly HacsEntryCheckpoint[] = [];

    try {
      const release = await resolveRemoteRelease({
        fetchImpl: this.fetchImpl,
        timeoutMs: this.networkTimeoutMs,
        fullName: repo.full_name,
        domain,
        requestedVersion: options.version ?? repo.selected_tag,
        includeBeta: repo.beta,
        defaultBranch: repo.default_branch,
        hacsJson: repo.hacs_json,
      });
      if (!release) throw new Error(`hacs_release_not_found:${repo.full_name}`);

      const initialCompat = evaluateHacsCompatibility({
        category: repo.category,
        hacsJson: release.hacsJson,
        runtimeHaVersion: this.hooks.getRuntimeHaVersion?.(),
      });
      if (initialCompat.status === 'incompatible') {
        throw new Error(`incompatible_ha_version:${initialCompat.reason ?? 'incompatible'}`);
      }

      currentPhase = 'download';
      op = await this.advanceOp(op, {
        targetVersion: release.version,
        phase: 'download',
        compatibility: initialCompat.status,
        compatibilityReason: initialCompat.reason,
      });

      const downloaded = await downloadHacsArchive({
        url: release.downloadUrl,
        fetchFn: this.fetchImpl,
        expectedDigest: options.expectedDigest,
        timeoutMs: Math.max(this.networkTimeoutMs * 4, 30_000),
        onProgress: (bytesReceived, totalBytes) => {
          op = {
            ...op,
            bytesReceived,
            ...(totalBytes !== undefined ? { totalBytes } : {}),
            revision: op.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          this.operations.set(operationId, op);
          this.hooks.onProgress?.(op);
        },
      });

      currentPhase = 'prepare';
      op = await this.advanceOp(op, {
        phase: 'prepare',
        commitOrDigest: downloaded.digest,
        bytesReceived: downloaded.bytes.byteLength,
        ...(downloaded.totalBytes !== undefined ? { totalBytes: downloaded.totalBytes } : {}),
      });

      const staged = await extractAndStageHacsComponent({
        bytes: downloaded.bytes,
        expectedDomain: domain,
        fallbackVersion: release.version,
        stageDir,
        runtimeHaVersion: this.hooks.getRuntimeHaVersion?.(),
      });
      if (staged.compatibility.status === 'incompatible') {
        throw new Error(`incompatible_ha_version:${staged.compatibility.reason ?? 'incompatible'}`);
      }

      const installedDisk = await scanInstalledCustomComponents(this.customComponentsDir);
      const conflictCheck = checkRequirementConflicts(domain, staged.requirements, installedDisk);
      if (!conflictCheck.ok) throw new Error(`dependency_conflict:${conflictCheck.reason}`);
      if (staged.requirements.length > 0 && this.hooks.prepareRequirements) {
        await this.hooks.prepareRequirements(domain, staged.requirements);
      }

      if (options.activate === false) {
        this.upsertRepoState(repo, domain, {
          installedVersion,
          downloadedVersion: staged.version,
          availableVersion: staged.version,
          pendingRestart: true,
        });
        await this.saveState();
        return await this.advanceOp(op, {
          targetVersion: staged.version,
          phase: 'downloaded_not_activated',
          compatibility: staged.compatibility.status,
          compatibilityReason: staged.compatibility.reason,
          runningVersion: installedVersion,
        });
      }

      checkpoints = (await this.hooks.captureEntryCheckpoint?.(domain)) ?? [];
      currentPhase = 'activate';
      op = await this.advanceOp(op, {
        targetVersion: staged.version,
        phase: 'activate',
        compatibility: staged.compatibility.status,
        compatibilityReason: staged.compatibility.reason,
      });

      await this.hooks.beforeActivate?.(domain, affectedEntries);
      const receipt: HacsInstallReceipt = {
        repository: repo.full_name,
        repositoryId: repo.id,
        domain,
        version: staged.version,
        commitOrDigest: downloaded.digest,
        installedAt: new Date().toISOString(),
        operationId,
      };
      const swapped = await swapStagedComponent({
        customComponentsDir: this.customComponentsDir,
        backupRoot: this.backupRoot,
        stageDir,
        targetDir,
        backupDir,
        receipt,
      });
      backupCreated = swapped.backupCreated;
      codeSwapped = true;

      currentPhase = 'verify';
      op = await this.advanceOp(op, { phase: 'verify' });
      const activeManifest = JSON.parse(
        await readFile(join(targetDir, 'manifest.json'), 'utf8'),
      ) as Record<string, unknown>;
      if (activeManifest.domain !== domain) throw new Error('verification_domain_mismatch');

      let reauthRequired = false;
      if (this.hooks.verifyActivation) {
        const v = await this.hooks.verifyActivation(domain, staged.version, affectedEntries);
        if (!v.ok) {
          throw Object.assign(new Error(v.reason ?? 'runtime_verification_failed'), {
            irreversibleMigration: v.irreversibleMigration,
          });
        }
        reauthRequired = Boolean(v.reauthRequired);
      }

      if (backupCreated)
        await rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
      this.upsertRepoState(repo, domain, {
        installedVersion: staged.version,
        downloadedVersion: undefined,
        availableVersion: staged.version,
        pendingRestart: false,
        releaseUrl: release.releaseUrl,
        releaseSummary: release.summary,
      });
      await this.saveState();
      await this.hooks.onInstalled?.(domain, staged.version);
      await this.onCatalogChanged?.();
      return await this.advanceOp(op, {
        phase: 'installed',
        runningVersion: staged.version,
        ...(reauthRequired ? { reauthRequired: true } : {}),
      });
    } catch (err: unknown) {
      const { errorMsg, rollbackOutcome, runningVersion } = await resolveFailedHacsUpdateRollback({
        err,
        domain,
        stageDir,
        targetDir,
        backupDir,
        backupCreated,
        codeSwapped,
        installedVersion,
        affectedEntries,
        checkpoints,
        hooks: this.hooks,
      });
      await this.advanceOp(op, {
        phase: rollbackOutcome === 'restored' ? 'rolled_back' : 'failed',
        failedPhase: currentPhase,
        rollbackOutcome,
        runningVersion,
        error: errorMsg,
      });
      throw err;
    }
  }

  async installBatch(
    identifiers: readonly string[],
    options: {
      readonly configuredEntries?: readonly HacsEntryVersionRef[];
      readonly onBatchProgress?: (p: {
        readonly completedCount: number;
        readonly totalCount: number;
        readonly currentOperation: HacsUpdateOperation;
      }) => void;
    } = {},
  ): Promise<HacsBatchUpdateResult> {
    return runHacsBatchUpdates({
      identifiers,
      installOne: (id) => this.installUpdate(id, { configuredEntries: options.configuredEntries }),
      findLatestOperation: (id) =>
        Array.from(this.operations.values())
          .reverse()
          .find((o) => o.targetId === id || o.repositoryId === id || o.domain === id),
      onBatchProgress: options.onBatchProgress,
    });
  }

  async handleHacsCommand(
    input: Record<string, unknown>,
    configuredEntries: readonly HacsEntryVersionRef[] = [],
  ): Promise<unknown> {
    await this.ensureLoaded();
    return executeHacsRpcCommand({
      command: input,
      configuredEntries,
      state: this.state,
      customComponentsDir: this.customComponentsDir,
      hasPendingTasks: this.inFlight.size > 0,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.networkTimeoutMs,
      runtimeHaVersion: this.hooks.getRuntimeHaVersion?.(),
      saveState: () => this.saveState(),
      onRemoved: (domain) => this.hooks.onRemoved?.(domain) ?? Promise.resolve(),
      onCatalogChanged: () => this.onCatalogChanged?.() ?? Promise.resolve(),
      listRepositories: (entries, refresh) => this.listRepositories(entries, refresh),
      resolveTargetRepository: (id, entries) => this.resolveTargetRepository(id, entries),
      installUpdate: (id, opts) => this.installUpdate(id, opts),
    });
  }
}
