/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  FlowCatalogManifest,
  FlowInitOptions,
  FlowSubmissionOptions,
  IntegrationFlowEngine,
  IntegrationFlowStep,
} from '@haus/core';
import { AppCatalog } from '@haus/apps';
import { PluginSecretVault, vendorCatalog } from '@haus/kitsune';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home/home.service.js';
import { StandaloneHomePersistence } from '../home/home.persistence.js';
import { KITSUNE_SERVICE, type IKitsuneService } from '../kitsune/kitsune.controller.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import {
  appRuntimeToIntegrationType,
  buildAppOrVendorHandler,
  buildIntegrationDomainMetaList,
  mapAppCatalogToSchema,
  mapVendorField,
  parseKitsuneCompatibility,
  resolveDomainMetaBase,
  sanitizeEntryPayload,
  type IntegrationDomainMeta,
  type IntegrationEntryState,
  type IntegrationRuntimeType,
  type PersistedIntegrationEntry,
} from './entry-helpers.js';
import { HubTuyaService } from './tuya/service.js';

export type {
  IntegrationDomainMeta,
  IntegrationEntryState,
  IntegrationRuntimeType,
  PersistedIntegrationEntry,
};

@Injectable()
export class HubIntegrationEntryService implements OnModuleInit, OnModuleDestroy {
  private readonly persistence: StandaloneHomePersistence;
  private readonly entries = new Map<string, PersistedIntegrationEntry>();
  private readonly flowSources = new Map<string, string>();
  private readonly vault = new PluginSecretVault();
  private readonly catalog = AppCatalog.createDefaultCatalog();
  private loaded = false;
  private loadingPromise?: Promise<void>;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(KITSUNE_SERVICE) private readonly kitsune?: IKitsuneService,
    @Optional() @Inject(HubTuyaService) private readonly tuyaService?: HubTuyaService,
  ) {
    this.persistence = new StandaloneHomePersistence(transactions);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
    await this.tuyaService?.restoreEntries(Array.from(this.entries.values()));
  }

  onModuleDestroy(): void {
    this.tuyaService?.onModuleDestroy();
    this.persistence.close();
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadingPromise) {
      this.loadingPromise = this.persistence
        .listByKind<PersistedIntegrationEntry>('integration_entry')
        .then((rows) => {
          for (const row of rows) {
            if (row.value?.entry_id && row.value?.domain) {
              this.entries.set(row.value.entry_id, {
                ...row.value,
                data: sanitizeEntryPayload(row.value.data),
              });
            }
          }
          this.loaded = true;
        })
        .catch(() => {
          this.loaded = true;
        });
    }
    await this.loadingPromise;
  }

  registerDynamicDomains(engine: IntegrationFlowEngine): void {
    if (this.tuyaService) {
      engine.registerDomainHandler('tuya', this.tuyaService.createFlowHandler());
    }
    for (const preset of vendorCatalog) {
      if (preset.id === 'tuya' || preset.fields.length === 0) continue;
      engine.registerDomainHandler(
        preset.id,
        buildAppOrVendorHandler(preset.id, preset.name, preset.fields.map(mapVendorField)),
      );
    }
    for (const app of this.catalog.list()) {
      const schema = mapAppCatalogToSchema(app);
      if (schema.length > 0) {
        engine.registerDomainHandler(
          app.manifest.id,
          buildAppOrVendorHandler(app.manifest.id, app.manifest.name, schema, app.documentationUrl),
        );
      }
    }
  }

  async enrichFlowInitOptions(options: FlowInitOptions): Promise<FlowInitOptions> {
    await this.ensureLoaded();
    const targetId = options.entryId ?? options.reauthEntryId;
    if (!targetId) return options;
    const entry = await this.getEntry(targetId);
    if (!entry) return options;
    const baseData = options.source === 'options' ? entry.options : entry.data;
    return {
      ...options,
      entryId: entry.entry_id,
      initialData: { ...baseData, ...options.initialData },
    };
  }

  async startFlowWithPersistence(
    engine: IntegrationFlowEngine,
    options: FlowInitOptions,
    lookupManifest: (domain: string) => FlowCatalogManifest | undefined,
  ): Promise<IntegrationFlowStep> {
    const prepared = await this.enrichFlowInitOptions(options);
    const step = await engine.startFlow(prepared);
    const source = prepared.source ?? 'user';
    if (step.type === 'create_entry') {
      await this.recordFlowResult(step, source, lookupManifest(step.handler));
    } else {
      this.flowSources.set(step.flowId, source);
    }
    return step;
  }

  async submitFlowWithPersistence(
    engine: IntegrationFlowEngine,
    submission: FlowSubmissionOptions,
    lookupManifest: (domain: string) => FlowCatalogManifest | undefined,
  ): Promise<IntegrationFlowStep> {
    const step = await engine.submitStep(submission);
    if (step.type === 'create_entry') {
      const source = this.flowSources.get(step.flowId) ?? 'user';
      this.flowSources.delete(step.flowId);
      await this.recordFlowResult(step, source, lookupManifest(step.handler));
    } else if (step.type === 'abort') {
      this.flowSources.delete(step.flowId);
    }
    return step;
  }

  async recordFlowResult(
    step: IntegrationFlowStep,
    source: string,
    manifest?: FlowCatalogManifest,
  ): Promise<PersistedIntegrationEntry | undefined> {
    if (step.type !== 'create_entry' || !step.result?.entryId) return undefined;
    await this.ensureLoaded();
    const entryId = step.result.entryId;
    const domain = step.handler;
    const now = new Date().toISOString();
    const existing = this.entries.get(entryId);
    const meta = resolveDomainMetaBase({ domain, catalog: this.catalog, manifest });
    const safeData = sanitizeEntryPayload(step.result.data, this.vault, {
      runtime: meta.runtimeType,
      pluginId: entryId,
    });
    const safeOptions = sanitizeEntryPayload(step.result.options);

    const updated: PersistedIntegrationEntry = {
      entry_id: entryId,
      domain,
      title:
        source === 'options'
          ? (existing?.title ?? step.result.title ?? step.title ?? domain)
          : (step.result.title ?? existing?.title ?? step.title ?? domain),
      state: 'loaded',
      reason: null,
      source: existing?.source ?? source,
      disabled_by: existing?.disabled_by ?? null,
      data: source === 'options' ? (existing?.data ?? {}) : { ...existing?.data, ...safeData },
      options:
        source === 'options'
          ? { ...existing?.options, ...safeOptions, ...safeData }
          : (existing?.options ?? safeOptions),
      version: meta.version ?? existing?.version,
      runtimeType: existing?.runtimeType ?? meta.runtimeType,
      iotClass: meta.iotClass ?? existing?.iotClass,
      supports_options: true,
      supports_reconfigure: true,
      supports_remove_device: true,
      supports_unload: true,
      supports_multiple: meta.supportsMultiple,
      documentationUrl:
        step.documentationUrl ?? meta.documentationUrl ?? existing?.documentationUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.entries.set(entryId, updated);
    await this.persistence.save('integration_entry', entryId, updated);
    if (domain === 'tuya' && this.tuyaService) {
      await this.tuyaService.commitPendingEntryCredentials(
        step.flowId,
        entryId,
        updated.disabled_by === 'user',
      );
    }
    return updated;
  }

  async setEntryState(
    entryId: string,
    state: IntegrationEntryState,
    reason: string | null = null,
  ): Promise<PersistedIntegrationEntry | undefined> {
    await this.ensureLoaded();
    const current = this.entries.get(entryId);
    if (!current) return undefined;
    const next: PersistedIntegrationEntry = {
      ...current,
      state,
      reason,
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(entryId, next);
    await this.persistence.save('integration_entry', entryId, next);
    return next;
  }

  async listEntries(): Promise<readonly PersistedIntegrationEntry[]> {
    await this.ensureLoaded();
    const map = new Map<string, PersistedIntegrationEntry>();
    for (const [id, entry] of this.entries) {
      map.set(id, entry);
    }

    if (this.homeService) {
      try {
        const inventory = await this.homeService.listApps('hub');
        for (const app of inventory.apps) {
          const entryId = `app:${app.source.externalId}`;
          if (map.has(entryId)) continue;
          const cat = this.catalog.get(app.source.externalId);
          const installed = this.homeService.appManager.getInstalledApp(app.source.externalId);
          const now = new Date().toISOString();
          map.set(entryId, {
            entry_id: entryId,
            domain: app.source.externalId,
            title: app.name,
            state:
              app.state === 'unknown'
                ? 'setup_error'
                : app.state === 'running'
                  ? 'loaded'
                  : 'not_loaded',
            reason: app.state === 'unknown' ? 'App runtime state is unknown' : null,
            source: 'app',
            disabled_by: app.state === 'stopped' ? 'user' : null,
            data: sanitizeEntryPayload(installed?.config),
            options: {},
            version: app.version,
            runtimeType: appRuntimeToIntegrationType(cat),
            iotClass: cat?.runtimeType === 'homebridge' ? 'local_push' : undefined,
            supports_options: true,
            supports_reconfigure: true,
            supports_remove_device: false,
            supports_unload: true,
            supports_multiple: false,
            documentationUrl: cat?.documentationUrl,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch {
        // Apps inventory may be unconfigured in minimal tests.
      }
    }

    if (this.kitsune?.compatibility) {
      try {
        const compat = parseKitsuneCompatibility(this.kitsune.compatibility());
        for (const session of compat.sessions) {
          const entryId = `kitsune:${session.runtime}:${session.pluginId}`;
          if (map.has(entryId) || map.has(`app:${session.pluginId}`)) continue;
          const errDiag = compat.diagnostics.find(
            (d) => d.plugin === session.pluginId && d.level === 'error',
          );
          const now = new Date().toISOString();
          map.set(entryId, {
            entry_id: entryId,
            domain: session.pluginId,
            title: session.pluginId,
            state: errDiag ? 'setup_error' : session.status === 'active' ? 'loaded' : 'not_loaded',
            reason: errDiag?.message ?? null,
            source: session.runtime,
            disabled_by: null,
            data: {},
            options: {},
            runtimeType:
              session.runtime === 'homebridge'
                ? 'homebridge'
                : session.runtime === 'hacs'
                  ? 'custom_integration'
                  : 'scrypted',
            supports_options: true,
            supports_reconfigure: true,
            supports_remove_device: false,
            supports_unload: true,
            supports_multiple: true,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch {
        // Ignore if Kitsune uninitialized.
      }
    }

    return Array.from(map.values());
  }

  async getEntry(entryId: string): Promise<PersistedIntegrationEntry | undefined> {
    const all = await this.listEntries();
    return all.find((e) => e.entry_id === entryId);
  }

  async reloadEntry(
    entryId: string,
  ): Promise<{ status: string; entry?: PersistedIntegrationEntry }> {
    await this.ensureLoaded();
    if (entryId.startsWith('app:') && this.homeService) {
      const appId = entryId.slice('app:'.length);
      await this.homeService.executeApp('hub', appId, 'restart');
    } else if (entryId.startsWith('kitsune:') && this.kitsune?.restartSession) {
      const [, runtime, ...rest] = entryId.split(':');
      const pluginId = rest.join(':');
      if (runtime === 'homebridge' || runtime === 'scrypted' || runtime === 'hacs') {
        this.kitsune.restartSession(runtime, pluginId, 'hub-reload');
      }
    } else {
      await this.setEntryState(entryId, 'loaded', null);
      const entry = this.entries.get(entryId);
      if (entry?.domain === 'tuya' && this.tuyaService) {
        try {
          await this.tuyaService.syncEntry(entryId);
        } catch (err) {
          await this.setEntryState(
            entryId,
            'setup_retry',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
    return { status: 'reloaded', entry: await this.getEntry(entryId) };
  }

  async setDisabled(
    entryId: string,
    disabled: boolean,
  ): Promise<PersistedIntegrationEntry | undefined> {
    await this.ensureLoaded();
    if (entryId.startsWith('app:') && this.homeService) {
      const appId = entryId.slice('app:'.length);
      await this.homeService.executeApp('hub', appId, disabled ? 'stop' : 'start');
      return this.getEntry(entryId);
    }
    const existing = this.entries.get(entryId);
    if (!existing) return undefined;
    const next: PersistedIntegrationEntry = {
      ...existing,
      disabled_by: disabled ? 'user' : null,
      state: disabled ? 'not_loaded' : 'loaded',
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(entryId, next);
    await this.persistence.save('integration_entry', entryId, next);
    if (next.domain === 'tuya' && this.tuyaService) {
      await this.tuyaService.setEntryDisabled(entryId, disabled);
    }
    return next;
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    await this.ensureLoaded();
    if (this.entries.has(entryId)) {
      const existing = this.entries.get(entryId);
      this.entries.delete(entryId);
      await this.persistence.remove('integration_entry', entryId);
      if (existing?.domain === 'tuya' && this.tuyaService) {
        await this.tuyaService.removeEntry(entryId);
      }
      return true;
    }
    if (entryId.startsWith('app:') && this.homeService) {
      const appId = entryId.slice('app:'.length);
      const res = await this.homeService.operateApp('hub', appId, 'remove');
      return res.status === 'ok';
    }
    return false;
  }

  async listIntegrationMetadata(
    catalogManifests?: readonly FlowCatalogManifest[],
  ): Promise<readonly IntegrationDomainMeta[]> {
    const entries = await this.listEntries();
    const devices = this.homeService?.listDevices() ?? [];
    return buildIntegrationDomainMetaList({
      entries,
      devices,
      catalog: this.catalog,
      catalogManifests,
    });
  }
}
