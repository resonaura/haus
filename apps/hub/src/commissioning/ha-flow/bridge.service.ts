/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ExternalFlowProgressEntry, FlowInitOptions, IntegrationFlowStep } from '@haus/core';
import { HaConfigFlowBridge } from '@haus/ha/node/flow-bridge';
import { HaFlowRuntime, type HaEntryImport, type HaSyncCredentialInput } from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../../home/home.service.js';
import { HUB_DATA_DIRECTORY } from '../../cluster/crypto/master-key.js';
import { ClusterLeaseService } from '../../cluster/coordination/leases.js';
import { ClusterSyncService } from '../../cluster/sync/service.js';
import { CATALOG_TRANSACTIONS } from '../../storage/storage.module.js';
import type { Transactions } from '../../storage/transactions.js';
import { HubNetworkCredentialService } from '../credentials.service.js';
import { HubIntegrationEntryService, type PersistedIntegrationEntry } from '../entries.js';
import { CommissioningService } from '../service.js';
import { HaClusterIntegrationSync } from './cluster-sync.js';
import { HaIntegrationEntities } from './entities.js';
import { HaEntryImporter } from './entry-importer.js';
import {
  buildHaSyncEntries,
  collectHaAreaNames,
  getHueSceneDiagnostics,
  resolveHaTranslations,
  uploadRuntimeFile,
} from './runtime-operations.js';
import {
  EncryptedHaSecretsStore,
  resolveFrontendBase,
  resolveHaDataDir,
  persistRuntimeEntry,
  type StoredAppCredentialPublic,
} from './helpers.js';

@Injectable()
export class HaFlowBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HaFlowBridgeService.name);
  private readonly secretsStore: EncryptedHaSecretsStore;
  private readonly clusterHaSync: HaClusterIntegrationSync;
  private runtime?: HaFlowRuntime;
  private bridge?: HaConfigFlowBridge;
  private activeOverlayDir?: string;
  private startPromise?: Promise<HaConfigFlowBridge | undefined>;
  private workerReady = false;
  private stateSyncTimer?: NodeJS.Timeout;
  private destroyed = false;
  private readonly entities: HaIntegrationEntities;
  private readonly entryImporter: HaEntryImporter;

  constructor(
    private readonly commissioning: CommissioningService,
    private readonly entriesService: HubIntegrationEntryService,
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional()
    @Inject(CATALOG_TRANSACTIONS)
    transactions?: Transactions,
    @Optional()
    @Inject(HUB_DATA_DIRECTORY)
    dataDir?: string,
    @Optional()
    @Inject(ClusterLeaseService)
    clusterLeases?: ClusterLeaseService,
    @Optional()
    @Inject(ClusterSyncService)
    clusterSync?: ClusterSyncService,
    @Optional()
    @Inject(HubNetworkCredentialService)
    private readonly networkCredentials?: HubNetworkCredentialService,
  ) {
    this.entities = new HaIntegrationEntities(
      homeService,
      async (id, state, reason) => {
        await this.entriesService.setEntryState(
          id,
          state,
          state === 'loaded' ? null : (reason ?? 'ha_runtime_unavailable'),
        );
      },
      (entry) =>
        persistRuntimeEntry(entry, this.entriesService, this.secretsStore, (step, source) =>
          this.persistCompletedStep(step, source),
        ),
      async () => this.ensureStarted(),
    );
    this.secretsStore = new EncryptedHaSecretsStore(transactions, dataDir);
    this.entryImporter = new HaEntryImporter(entriesService, this.secretsStore, homeService, {
      ensureStarted: () => this.ensureStarted(),
      getRuntime: () => this.runtime,
      supportsDomain: (domain) => Boolean(this.bridge?.supportsDomain(domain)),
      persist: (step, source) => this.persistCompletedStep(step, source),
      syncAllState: () => this.syncAllState(),
      cancelPendingSync: () => {
        clearTimeout(this.stateSyncTimer);
        this.stateSyncTimer = undefined;
      },
    });
    this.clusterHaSync = new HaClusterIntegrationSync(clusterLeases, clusterSync);
    this.wireHooks();
  }

  private getSyncBindings() {
    return {
      reloadEntries: () => this.entriesService.reload(),
      syncRuntimeState: () => this.syncAllState(),
      removeEntryFromRuntime: async (entryId: string) => {
        if (this.runtime) {
          const result = await this.runtime.unloadEntry(entryId);
          if (!result.ok) throw Error('integration_unload_failed');
        }
      },
      executeLocalDeviceCommand: async (
        endpointId: string,
        capability: string,
        command: string,
        parameters?: Record<string, unknown>,
      ) => {
        if (!this.homeService) return undefined;
        const receipt = await this.homeService.executeDeviceCommand(
          endpointId,
          capability,
          command,
          parameters,
        );
        return receipt.state;
      },
    };
  }

  private wireHooks(): void {
    this.clusterHaSync.attach(this.getSyncBindings());
    this.networkCredentials?.onCredentialChange((resourceId) => {
      this.clusterHaSync.scheduleSync('credential', resourceId);
    });
    this.commissioning.setHaCatalogRefreshHook(async () => {
      await this.handleCatalogUpdated();
    });
    this.entriesService.setHaFlowHooks({
      onEntryPersisted: async (entry, rawData, rawOptions) => {
        if (entry.domain === 'tuya' || entry.source === 'app') return;
        await this.secretsStore.saveEntryPayload(entry.entry_id, rawData, rawOptions);
        this.entities.forceRetryEntry(entry.entry_id);
        this.clusterHaSync.scheduleSync('credential', `ha:${entry.entry_id}`);
        this.stateSyncTimer ??= setTimeout(() => {
          this.stateSyncTimer = undefined;
          void this.syncAllState().catch(() =>
            this.logger.warn('Integration state synchronization unavailable.'),
          );
        }, 100);
        this.stateSyncTimer.unref();
      },
      onEntryRemoved: async (entryId) => {
        await this.secretsStore.deleteEntryPayload(entryId);
        this.clusterHaSync.scheduleSync('config', `ha:${entryId}`);
        if (this.runtime) {
          await this.runtime.removeEntry(entryId).catch(() => undefined);
        }
      },
      onEntryUpdated: async (entry) => {
        this.clusterHaSync.scheduleSync('config', `ha:${entry.entry_id}`);
        if (this.bridge) await this.syncAllState();
      },
      onEntryReloaded: async (entry) => {
        this.entities.forceRetryEntry(entry.entry_id);
        await this.runtime?.unloadEntry(entry.entry_id).catch(() => undefined);
        if (this.bridge) await this.syncAllState();
      },
      getRuntimeEntryPayload: async (entryId) => this.secretsStore.getEntryPayload(entryId),
    });

    // Attach external runtime bridge immediately if runtime wasn't deferred.
    this.initBridgeSyncOnly();
  }

  private initBridgeSyncOnly(): void {
    const rt = this.createRuntime();
    this.runtime = rt;
    this.entryImporter.reset();
    this.bridge = new HaConfigFlowBridge(rt, this.commissioning.catalog, {
      ensureReady: async () => {
        if (!(await this.ensureStarted())) throw new Error('ha_flow_runtime_unavailable');
      },
      ensureEntrySynced: async () => {
        await this.syncAllState({ skipEntitySync: true });
      },
    });
    this.commissioning.flows.setExternalRuntime(this.bridge);
  }

  private createRuntime(): HaFlowRuntime {
    const overlayDir = this.commissioning.catalog.getComponentsOverlayDir();
    this.activeOverlayDir = overlayDir;
    const baseDir = resolveHaDataDir();
    const rt = new HaFlowRuntime({
      configDir: join(baseDir, 'config'),
      depsDir: join(baseDir, 'deps'),
      frontendBase: resolveFrontendBase(),
      componentsOverlayDir: overlayDir,
      startupTimeoutMs: 60_000,
    });
    rt.onWorkerStderr((line) => {
      if (!this.destroyed && /\b(?:WARNING|ERROR|CRITICAL|Traceback|Exception)\b/i.test(line)) {
        this.logger.warn(`[HAWorker] ${line.slice(0, 400)}`);
      }
    });
    return rt;
  }

  onModuleInit(): void {
    const disabled = process.env.HAUS_DISABLE_HA_FLOW === '1';
    if (disabled || process.env.VITEST || process.env.NODE_ENV === 'test') return;
    // Warm up non-blockingly so Hub HTTP startup never blocks on Python imports.
    void this.ensureStarted().catch((err: unknown) => {
      if (!this.destroyed) {
        this.logger.warn(
          `HA flow host background warmup unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    clearTimeout(this.stateSyncTimer);
    await this.entities.close();
    this.clusterHaSync.dispose();
    this.secretsStore.close();
    const rt = this.runtime;
    this.runtime = undefined;
    this.bridge = undefined;
    this.startPromise = undefined;
    if (rt) {
      await rt.dispose().catch(() => undefined);
    }
  }

  /** Allows commissioning tests to inject an isolated fake or custom HaFlowRuntime. */
  setRuntimeForTesting(runtime: HaFlowRuntime): HaConfigFlowBridge {
    const prev = this.runtime;
    if (prev && prev !== runtime) {
      void prev.dispose().catch(() => undefined);
    }
    this.runtime = runtime;
    this.startPromise = undefined;
    this.workerReady = false;
    this.entryImporter.reset();
    this.bridge = new HaConfigFlowBridge(runtime, this.commissioning.catalog, {
      ensureEntrySynced: async () => {
        await this.syncAllState({ skipEntitySync: true });
      },
    });
    this.commissioning.flows.setExternalRuntime(this.bridge);
    return this.bridge;
  }

  getBridge(): HaConfigFlowBridge | undefined {
    return this.bridge;
  }

  async ensureStarted(): Promise<HaConfigFlowBridge | undefined> {
    if (this.destroyed || process.env.HAUS_DISABLE_HA_FLOW === '1') {
      return undefined;
    }
    if (this.workerReady && !this.runtime?.isRunning()) {
      this.workerReady = false;
      this.startPromise = undefined;
      this.entryImporter.reset();
    }
    if (!this.startPromise) {
      const starting = this.performStart().then(
        (bridge) => {
          if (this.startPromise === starting) this.workerReady = Boolean(bridge);
          return bridge;
        },
        (error: unknown) => {
          if (this.startPromise === starting) this.startPromise = undefined;
          throw error;
        },
      );
      this.startPromise = starting;
    }
    return this.startPromise;
  }

  private async performStart(): Promise<HaConfigFlowBridge | undefined> {
    if (this.destroyed) return undefined;
    if (!this.runtime || !this.bridge) {
      this.initBridgeSyncOnly();
    }
    const bridge = this.bridge;
    if (!bridge) return undefined;
    await this.secretsStore.ensureLoaded();
    if (this.destroyed) return undefined;
    await bridge.warmupHandlers();
    if (this.destroyed) return undefined;
    await this.syncAllState();
    return bridge;
  }

  async syncAllState(options?: { readonly skipEntitySync?: boolean }): Promise<void> {
    const rt = this.runtime;
    if (!rt || this.destroyed) return;
    await this.entriesService.ensureLoaded();
    await this.secretsStore.ensureLoaded();

    const persistedEntries = await this.entriesService.listEntries();
    const activeEntries = await this.clusterHaSync.ensureEntryWorkloads(
      persistedEntries,
      this.getSyncBindings(),
    );
    const haEntries = await buildHaSyncEntries(activeEntries, this.secretsStore);
    const areas = collectHaAreaNames(this.homeService?.listDevices() ?? []);
    const applicationCredentials = await this.secretsStore.getCredentialsForHaSync();

    await rt.syncState({
      entries: haEntries,
      areas,
      applicationCredentials,
      frontendBase: resolveFrontendBase(),
    });
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
      const restoreIssues = await this.entryImporter.restoreRegistries(rt, haEntries);
      for (const issue of restoreIssues) {
        this.logger.warn(
          `Skipped restoring the ${issue.domain} HA registry (${issue.code}); other integrations remain available.`,
        );
      }
    }
    if (!options?.skipEntitySync && !process.env.VITEST && process.env.NODE_ENV !== 'test') {
      this.entities.sync(rt, haEntries);
    }
  }

  async handleCatalogUpdated(): Promise<void> {
    const nextOverlay = this.commissioning.catalog.getComponentsOverlayDir();
    if (nextOverlay === this.activeOverlayDir && this.runtime) return;

    const oldRuntime = this.runtime;
    this.runtime = undefined;
    this.startPromise = undefined;
    this.workerReady = false;
    if (oldRuntime) {
      await oldRuntime.dispose().catch(() => undefined);
    }
    if (!this.destroyed) {
      this.initBridgeSyncOnly();
      if (process.env.HAUS_DISABLE_HA_FLOW !== '1') {
        await this.ensureStarted().catch(() => undefined);
      }
    }
  }

  async listProgressFlows(): Promise<readonly ExternalFlowProgressEntry[]> {
    const bridge = await this.ensureStarted().catch(() => this.bridge);
    if (!bridge) return [];
    try {
      return await bridge.listProgressFlows();
    } catch {
      return [];
    }
  }

  getNativeDiscoveryDomains(): readonly string[] {
    const domains = this.commissioning.getMatcherRules().map((rule) => rule.domain);
    return Array.from(new Set(domains)).filter(
      (domain) => domain !== 'tuya' && this.bridge?.supportsDomain(domain),
    );
  }

  async getTranslations(
    category: string,
    integrations?: readonly string[],
  ): Promise<Readonly<Record<string, string>>> {
    return resolveHaTranslations({
      category,
      integrations,
      catalog: this.commissioning.catalog,
      runtime: this.runtime,
      ensureStarted: () => this.ensureStarted(),
    });
  }

  async triggerDiscovery(input: {
    readonly domain: string;
    readonly protocol: string;
    readonly info: Record<string, unknown>;
    readonly discoveryKey?: string;
  }): Promise<{ readonly outcome: string; readonly step?: IntegrationFlowStep } | undefined> {
    const bridge = await this.ensureStarted().catch(() => undefined);
    if (!bridge || this.destroyed) return undefined;
    const res = await bridge.triggerDiscovery(input);
    if (this.destroyed) return res;
    if (res.step && (res.step.type === 'create_entry' || Boolean(res.step.result?.entryId))) {
      await this.persistCompletedStep(res.step, input.protocol);
    }
    return res;
  }

  async completeExternalFlow(input: {
    readonly flowId?: string;
    readonly state?: unknown;
    readonly code?: string;
    readonly error?: string;
  }): Promise<IntegrationFlowStep> {
    const bridge = await this.ensureStarted();
    if (!bridge) {
      throw new Error('ha_flow_runtime_unavailable');
    }
    const step = await this.commissioning.flows.completeExternalFlow(input);
    if (step.type === 'create_entry' || Boolean(step.result?.entryId)) {
      await this.persistCompletedStep(step, 'user');
    }
    return step;
  }

  async uploadFile(
    filename: string,
    content: Buffer,
  ): Promise<{ readonly fileId: string; readonly file_id: string }> {
    return uploadRuntimeFile(
      filename,
      content,
      () => this.ensureStarted(),
      () => this.runtime,
    );
  }

  async getHueSceneDiagnostics(entryId: string) {
    return getHueSceneDiagnostics(
      entryId,
      () => this.ensureStarted(),
      () => this.runtime,
    );
  }

  async listApplicationCredentials(): Promise<readonly StoredAppCredentialPublic[]> {
    return this.secretsStore.listCredentialsPublic();
  }

  async addApplicationCredential(input: HaSyncCredentialInput): Promise<StoredAppCredentialPublic> {
    const stored = await this.secretsStore.saveCredential(input);
    this.clusterHaSync.scheduleSync('credential', `ha_app:${input.domain}`);
    if (this.runtime) {
      await this.ensureStarted()
        .then(() => this.runtime?.addApplicationCredential(input))
        .catch(() => undefined);
    }
    return stored;
  }

  async removeApplicationCredential(domain: string): Promise<boolean> {
    const removed = await this.secretsStore.deleteCredential(domain);
    if (removed) {
      this.clusterHaSync.scheduleSync('credential', `ha_app:${domain}`);
    }
    if (removed && this.bridge) {
      await this.syncAllState().catch(() => undefined);
    }
    return removed;
  }

  async startFlowDirect(options: FlowInitOptions): Promise<IntegrationFlowStep> {
    await this.ensureStarted();
    return this.commissioning.startFlow(options);
  }

  importEntry(input: HaEntryImport) {
    return this.entryImporter.importEntry(input);
  }

  private async persistCompletedStep(
    step: IntegrationFlowStep,
    source: string,
  ): Promise<PersistedIntegrationEntry | undefined> {
    const manifest = this.commissioning.catalog.getCatalog().getManifest(step.handler);
    return this.entriesService.recordFlowResult(step, source, manifest);
  }
}
