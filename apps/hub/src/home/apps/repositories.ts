/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
  fetchAndScanAddonRepository,
  parseAddonRepositoryUrl,
  type AddonRepositoryMetadata,
  type AppCatalogEntry,
} from '@haus/apps';
import { LIVE_SERVICE } from '../../live/tokens.js';
import type { LiveService } from '../../live/types.js';
import { StandaloneHomeEntryEntity } from '../../storage/standalone/entities.js';
import { CATALOG_TRANSACTIONS } from '../../storage/storage.module.js';
import type { Transactions } from '../../storage/transactions.js';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../home.service.js';

interface PersistedAddonRepositoryRecord {
  readonly repository: AddonRepositoryMetadata;
  readonly entries: readonly AppCatalogEntry[];
}

@Injectable()
export class CustomAddonRepositoryService implements OnModuleInit {
  private readonly logger = new Logger(CustomAddonRepositoryService.name);
  private readonly repos = new Map<string, PersistedAddonRepositoryRecord>();
  private fetchImpl: typeof fetch = fetch;
  private loaded = false;

  constructor(
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService: StandaloneHomeService,
    @Optional()
    @Inject(CATALOG_TRANSACTIONS)
    private readonly transactions?: Transactions,
    @Optional()
    @Inject(LIVE_SERVICE)
    private readonly liveService?: LiveService,
  ) {}

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.transactions) return;
    try {
      const rows = await this.transactions.read((manager) =>
        manager.find(StandaloneHomeEntryEntity, {
          where: { kind: 'addon_repository' },
          order: { updatedAt: 'ASC' },
        }),
      );
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value) as Partial<PersistedAddonRepositoryRecord>;
          if (
            parsed?.repository &&
            typeof parsed.repository.id === 'string' &&
            typeof parsed.repository.url === 'string' &&
            Array.isArray(parsed.entries)
          ) {
            const record: PersistedAddonRepositoryRecord = {
              repository: parsed.repository,
              entries: parsed.entries,
            };
            this.repos.set(record.repository.id, record);
            this.registerEntries(record.entries);
          }
        } catch {
          // Skip corrupt persisted record
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Could not load custom add-on repositories: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private registerEntries(entries: readonly AppCatalogEntry[]): void {
    const catalog = this.homeService.appManager.catalog;
    for (const entry of entries) {
      if (entry?.manifest?.id) {
        catalog.register(entry);
      }
    }
  }

  private async saveRecord(record: PersistedAddonRepositoryRecord): Promise<void> {
    this.repos.set(record.repository.id, record);
    await this.homeService.getPersistence().save('addon_repository', record.repository.id, record);
  }

  async listRepositories(): Promise<readonly AddonRepositoryMetadata[]> {
    await this.ensureLoaded();
    return Array.from(this.repos.values())
      .map((item) => item.repository)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async addRepository(rawUrl: string): Promise<AddonRepositoryMetadata> {
    await this.ensureLoaded();
    const parsed = parseAddonRepositoryUrl(rawUrl);
    for (const existing of this.repos.values()) {
      if (
        existing.repository.id === parsed.id ||
        existing.repository.url.toLowerCase() === parsed.sourceUrl.toLowerCase()
      ) {
        throw new Error('addon_repository_already_exists');
      }
    }

    const scanned = await fetchAndScanAddonRepository(parsed.sourceUrl, {
      fetchFn: this.fetchImpl,
    });
    const record: PersistedAddonRepositoryRecord = {
      repository: scanned.repository,
      entries: scanned.entries,
    };
    this.registerEntries(record.entries);
    await this.saveRecord(record);
    this.liveService?.publish('apps');
    return record.repository;
  }

  async removeRepository(
    idOrUrl: string,
  ): Promise<{ readonly removed: true; readonly id: string }> {
    await this.ensureLoaded();
    const clean = idOrUrl.trim();
    let target = this.repos.get(clean);
    if (!target) {
      for (const item of this.repos.values()) {
        if (item.repository.url.toLowerCase() === clean.toLowerCase()) {
          target = item;
          break;
        }
      }
    }
    if (!target) {
      throw new Error('addon_repository_not_found');
    }

    // Match Home Assistant Supervisor: refuse removing a repository used by installed add-ons.
    const inUseIds: string[] = [];
    for (const addonId of target.repository.addonIds) {
      if (this.homeService.appManager.getInstalledApp(addonId)) {
        inUseIds.push(addonId);
      }
    }
    if (inUseIds.length > 0) {
      throw new Error(`addon_repository_in_use:${inUseIds.join(',')}`);
    }

    this.homeService.appManager.catalog.unregisterByRepositoryId(target.repository.id);
    this.repos.delete(target.repository.id);
    await this.homeService.getPersistence().remove('addon_repository', target.repository.id);
    this.liveService?.publish('apps');
    return { removed: true, id: target.repository.id };
  }

  async reloadRepository(id?: string): Promise<readonly AddonRepositoryMetadata[]> {
    await this.ensureLoaded();
    const targets = id
      ? [this.repos.get(id.trim())].filter(Boolean)
      : Array.from(this.repos.values());
    if (id && targets.length === 0) {
      throw new Error('addon_repository_not_found');
    }

    const updated: AddonRepositoryMetadata[] = [];
    for (const current of targets) {
      if (!current) continue;
      const scanned = await fetchAndScanAddonRepository(current.repository.url, {
        fetchFn: this.fetchImpl,
      });
      this.homeService.appManager.catalog.unregisterByRepositoryId(current.repository.id);
      const record: PersistedAddonRepositoryRecord = {
        repository: scanned.repository,
        entries: scanned.entries,
      };
      this.registerEntries(record.entries);
      await this.saveRecord(record);
      updated.push(record.repository);
    }

    this.liveService?.publish('apps');
    return updated;
  }
}
