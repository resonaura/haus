/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppCatalog } from '@haus/apps';
import { fetchPackument } from '../runtime/registry.js';
import {
  BUILTIN_ECOSYSTEM_SEEDS,
  classifyPluginCategory,
  computePluginTrustAndStability,
  ecosystemAppId,
  formatPluginDisplayName,
  isAllowedHomebridgePlugin,
  isAllowedScryptedPlugin,
  parseNpmSearchObject,
  resolvePluginVendor,
  toAppCatalogEntry,
  type EcosystemPluginRecord,
  type EcosystemRuntimeKind,
  type NpmSearchObject,
} from './metadata.js';

export {
  BUILTIN_ECOSYSTEM_SEEDS,
  classifyPluginCategory,
  computePluginTrustAndStability,
  ecosystemAppId,
  formatPluginDisplayName,
  isAllowedHomebridgePlugin,
  isAllowedScryptedPlugin,
  parseNpmSearchObject,
  resolvePluginVendor,
  toAppCatalogEntry,
  type EcosystemPluginRecord,
  type EcosystemRuntimeKind,
  type EcosystemSeedEntry,
  type NpmSearchObject,
  type NpmSearchPackage,
  type NpmSearchScore,
} from './metadata.js';

interface NpmSearchResponse {
  readonly objects?: readonly NpmSearchObject[];
  readonly total?: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 60 * 1000;
const MAX_SEARCH_CACHE = 64;
const HOMEBRIDGE_PAGES = 4;
const PAGE_SIZE = 250;
const DEFAULT_BG_INTERVAL_MS = 30 * 60 * 1000;

export class EcosystemPluginCatalog {
  private readonly recordsById = new Map<string, EcosystemPluginRecord>();
  private readonly idByPackage = new Map<string, string>();
  private readonly verifiedHomebridge = new Set<string>();
  private readonly searchCache = new Map<
    string,
    { readonly at: number; readonly items: readonly EcosystemPluginRecord[] }
  >();
  private refreshPromise?: Promise<readonly EcosystemPluginRecord[]>;
  private backgroundTimer?: NodeJS.Timeout;
  private boundCatalog?: AppCatalog;
  private boundProtectedIds?: ReadonlySet<string>;
  private lastRefreshedAt = 0;

  constructor(
    private readonly dataDirectory?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.seedBuiltins();
  }

  private seedBuiltins(): void {
    for (const seed of BUILTIN_ECOSYSTEM_SEEDS) {
      if (seed.runtime === 'homebridge' && seed.verified) {
        this.verifiedHomebridge.add(seed.packageName);
      }
      const displayName = formatPluginDisplayName(seed.runtime, seed.packageName);
      const { vendorId, vendorName } = resolvePluginVendor(seed.packageName, displayName);
      const { trustScore, stabilityTier } = computePluginTrustAndStability({
        verified: Boolean(seed.verified),
        featured: Boolean(seed.featured),
        officialScope:
          seed.packageName.startsWith('@scrypted/') ||
          seed.packageName.startsWith('@homebridge-plugins/'),
      });
      const record: EcosystemPluginRecord = {
        id: ecosystemAppId(seed.runtime, seed.packageName),
        packageName: seed.packageName,
        displayName,
        runtimeType: seed.runtime,
        version: seed.version,
        description: seed.description,
        category: classifyPluginCategory(seed.runtime, seed.packageName, seed.description),
        author: seed.author,
        verified: Boolean(seed.verified),
        featured: Boolean(seed.featured),
        trustScore,
        stabilityTier,
        vendorId,
        vendorName,
        keywords: [seed.runtime],
      };
      this.upsertRecord(record);
    }
  }

  private normalizeRecord(raw: EcosystemPluginRecord): EcosystemPluginRecord {
    if (typeof raw.trustScore === 'number' && raw.stabilityTier && raw.vendorId && raw.vendorName) {
      return raw;
    }
    const { vendorId, vendorName } = resolvePluginVendor(raw.packageName, raw.displayName);
    const { trustScore, stabilityTier } = computePluginTrustAndStability({
      verified: Boolean(raw.verified),
      featured: Boolean(raw.featured),
      officialScope:
        raw.packageName.startsWith('@scrypted/') ||
        raw.packageName.startsWith('@homebridge-plugins/'),
    });
    return {
      ...raw,
      trustScore: typeof raw.trustScore === 'number' ? raw.trustScore : trustScore,
      stabilityTier: raw.stabilityTier ?? stabilityTier,
      vendorId: raw.vendorId || vendorId,
      vendorName: raw.vendorName || vendorName,
    };
  }

  private upsertRecord(record: EcosystemPluginRecord): void {
    const normalized = this.normalizeRecord(record);
    this.recordsById.set(normalized.id, normalized);
    this.idByPackage.set(normalized.packageName.toLowerCase(), normalized.id);
  }

  list(runtimeType?: EcosystemRuntimeKind): readonly EcosystemPluginRecord[] {
    const all = Array.from(this.recordsById.values());
    if (!runtimeType) return all;
    return all.filter((r) => r.runtimeType === runtimeType);
  }

  getById(id: string): EcosystemPluginRecord | undefined {
    return this.recordsById.get(id) ?? this.getByPackage(id);
  }

  getByPackage(pkgName: string): EcosystemPluginRecord | undefined {
    const id = this.idByPackage.get(pkgName.trim().toLowerCase());
    return id ? this.recordsById.get(id) : undefined;
  }

  getIndexingStatus(): {
    readonly indexing: boolean;
    readonly indexedCount: number;
    readonly lastRefreshedAt: number;
  } {
    return {
      indexing: Boolean(this.refreshPromise),
      indexedCount: this.recordsById.size,
      lastRefreshedAt: this.lastRefreshedAt,
    };
  }

  startBackgroundIndexing(
    catalog?: AppCatalog,
    protectedIds?: ReadonlySet<string>,
    intervalMs = DEFAULT_BG_INTERVAL_MS,
  ): void {
    if (catalog) {
      this.boundCatalog = catalog;
      this.boundProtectedIds = protectedIds;
      this.syncIntoAppCatalog(catalog, protectedIds);
    }
    void (async () => {
      const loaded = await this.loadDiskCache();
      if (loaded && this.boundCatalog) {
        this.syncIntoAppCatalog(this.boundCatalog, this.boundProtectedIds);
      }
      await this.refresh(false).catch(() => {});
      if (this.boundCatalog) {
        this.syncIntoAppCatalog(this.boundCatalog, this.boundProtectedIds);
      }
    })();

    if (!this.backgroundTimer && intervalMs > 0) {
      this.backgroundTimer = setInterval(() => {
        void this.refresh(false)
          .then(() => {
            if (this.boundCatalog) {
              this.syncIntoAppCatalog(this.boundCatalog, this.boundProtectedIds);
            }
          })
          .catch(() => {});
      }, intervalMs);
      this.backgroundTimer.unref?.();
    }
  }

  stopBackgroundIndexing(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = undefined;
    }
  }

  syncIntoAppCatalog(catalog: AppCatalog, protectedIds?: ReadonlySet<string>): number {
    let count = 0;
    for (const record of this.recordsById.values()) {
      if (protectedIds?.has(record.id)) continue;
      const existing = catalog.get(record.id);
      if (existing && (existing.manifest.options?.length || existing.manifest.secrets?.length)) {
        continue;
      }
      catalog.register(toAppCatalogEntry(record));
      count += 1;
    }
    return count;
  }

  async loadDiskCache(): Promise<boolean> {
    if (!this.dataDirectory) return false;
    try {
      const file = join(this.dataDirectory, 'kitsune', 'ecosystem-catalog.json');
      const parsed = JSON.parse(await readFile(file, 'utf8')) as {
        updatedAt?: number;
        verifiedHomebridge?: string[];
        records?: EcosystemPluginRecord[];
      };
      if (Array.isArray(parsed.verifiedHomebridge)) {
        for (const name of parsed.verifiedHomebridge) {
          if (typeof name === 'string') this.verifiedHomebridge.add(name);
        }
      }
      if (Array.isArray(parsed.records)) {
        for (const rec of parsed.records) {
          if (rec && typeof rec.id === 'string' && typeof rec.packageName === 'string') {
            this.upsertRecord(rec);
          }
        }
      }
      if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) {
        this.lastRefreshedAt = parsed.updatedAt;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async saveDiskCache(): Promise<void> {
    if (!this.dataDirectory) return;
    try {
      const dir = join(this.dataDirectory, 'kitsune');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, 'ecosystem-catalog.json');
      const tmp = `${file}.tmp`;
      await writeFile(
        tmp,
        JSON.stringify({
          updatedAt: this.lastRefreshedAt,
          verifiedHomebridge: Array.from(this.verifiedHomebridge),
          records: Array.from(this.recordsById.values()),
        }),
        { mode: 0o600 },
      );
      await rename(tmp, file);
    } catch {
      // Non-fatal cache write failure.
    }
  }

  private async fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
    try {
      const res = await this.fetchFn(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async refresh(force = false): Promise<readonly EcosystemPluginRecord[]> {
    if (!force && this.lastRefreshedAt > 0 && Date.now() - this.lastRefreshedAt < CACHE_TTL_MS) {
      return this.list();
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const verifiedPromise = this.fetchJson<unknown>(
          'https://raw.githubusercontent.com/homebridge/verified/latest/verified-plugins.json',
          8_000,
        );
        const scryptedKwPromise = this.fetchJson<NpmSearchResponse>(
          `https://registry.npmjs.org/-/v1/search?text=keywords:scrypted&size=${PAGE_SIZE}`,
        );
        const scryptedScopePromise = this.fetchJson<NpmSearchResponse>(
          `https://registry.npmjs.org/-/v1/search?text=%40scrypted%2F&size=${PAGE_SIZE}`,
        );
        const hbPagePromises = Array.from({ length: HOMEBRIDGE_PAGES }, (_, page) =>
          this.fetchJson<NpmSearchResponse>(
            `https://registry.npmjs.org/-/v1/search?text=keywords:homebridge-plugin&size=${PAGE_SIZE}&from=${page * PAGE_SIZE}`,
          ),
        );

        const [verifiedList, scryptedKw, scryptedScope, ...hbPages] = await Promise.all([
          verifiedPromise,
          scryptedKwPromise,
          scryptedScopePromise,
          ...hbPagePromises,
        ]);

        if (Array.isArray(verifiedList)) {
          for (const item of verifiedList) {
            if (typeof item === 'string' && item.trim()) {
              this.verifiedHomebridge.add(item.trim());
            }
          }
        }

        let added = 0;
        for (const obj of [...(scryptedKw?.objects ?? []), ...(scryptedScope?.objects ?? [])]) {
          const parsed = parseNpmSearchObject('scrypted', obj, this.verifiedHomebridge);
          if (parsed) {
            this.upsertRecord(parsed);
            added += 1;
          }
        }

        for (const page of hbPages) {
          for (const obj of page?.objects ?? []) {
            const parsed = parseNpmSearchObject('homebridge', obj, this.verifiedHomebridge);
            if (parsed) {
              this.upsertRecord(parsed);
              added += 1;
            }
          }
        }

        if (added > 0) {
          this.lastRefreshedAt = Date.now();
          if (this.boundCatalog) {
            this.syncIntoAppCatalog(this.boundCatalog, this.boundProtectedIds);
          }
          await this.saveDiskCache();
        }
      } finally {
        this.refreshPromise = undefined;
      }
      return this.list();
    })();

    return this.refreshPromise;
  }

  async searchLive(
    rawQuery: string,
    runtimeType?: EcosystemRuntimeKind,
  ): Promise<readonly EcosystemPluginRecord[]> {
    const query = rawQuery.trim();
    if (query.length < 2) return [];
    const cacheKey = `${runtimeType ?? 'all'}:${query.toLowerCase()}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
      return cached.items;
    }

    const encoded = encodeURIComponent(query);
    const tasks: Array<Promise<readonly EcosystemPluginRecord[]>> = [];

    if (!runtimeType || runtimeType === 'homebridge') {
      tasks.push(
        this.fetchJson<NpmSearchResponse>(
          `https://registry.npmjs.org/-/v1/search?text=${encoded}+keywords:homebridge-plugin&size=80`,
          6_000,
        ).then((res) => {
          const out: EcosystemPluginRecord[] = [];
          for (const obj of res?.objects ?? []) {
            const parsed = parseNpmSearchObject('homebridge', obj, this.verifiedHomebridge);
            if (parsed) {
              this.upsertRecord(parsed);
              out.push(parsed);
            }
          }
          return out;
        }),
      );
    }

    if (!runtimeType || runtimeType === 'scrypted') {
      tasks.push(
        this.fetchJson<NpmSearchResponse>(
          `https://registry.npmjs.org/-/v1/search?text=${encoded}+keywords:scrypted&size=80`,
          6_000,
        ).then((res) => {
          const out: EcosystemPluginRecord[] = [];
          for (const obj of res?.objects ?? []) {
            const parsed = parseNpmSearchObject('scrypted', obj, this.verifiedHomebridge);
            if (parsed) {
              this.upsertRecord(parsed);
              out.push(parsed);
            }
          }
          return out;
        }),
      );
    }

    const groups = await Promise.all(tasks);
    const items = groups.flat();
    if (this.boundCatalog && items.length > 0) {
      this.syncIntoAppCatalog(this.boundCatalog, this.boundProtectedIds);
    }
    if (this.searchCache.size >= MAX_SEARCH_CACHE) {
      const firstKey = this.searchCache.keys().next().value;
      if (firstKey) this.searchCache.delete(firstKey);
    }
    this.searchCache.set(cacheKey, { at: Date.now(), items });
    return items;
  }

  async resolveByIdOrPackage(idOrPackage: string): Promise<EcosystemPluginRecord | undefined> {
    const existing = this.getById(idOrPackage);
    if (existing) return existing;

    const candidate = idOrPackage.trim();
    const isLikelyScrypted =
      candidate.startsWith('@scrypted/') || candidate.startsWith('scrypted-');
    const isLikelyHomebridge =
      candidate.startsWith('homebridge-') || candidate.includes('/homebridge-');

    if (!isLikelyScrypted && !isLikelyHomebridge) return undefined;
    const runtime: EcosystemRuntimeKind = isLikelyScrypted ? 'scrypted' : 'homebridge';
    const pkgCandidate =
      candidate.startsWith('scrypted-') && !candidate.startsWith('scrypted-kasa')
        ? `@scrypted/${candidate.slice('scrypted-'.length)}`
        : candidate;

    for (const pkgName of new Set([candidate, pkgCandidate])) {
      if (
        (runtime === 'scrypted' && !isAllowedScryptedPlugin(pkgName, ['scrypted'])) ||
        (runtime === 'homebridge' && !isAllowedHomebridgePlugin(pkgName, ['homebridge-plugin']))
      ) {
        continue;
      }
      try {
        const packument = await fetchPackument(pkgName, this.fetchFn);
        const latest = packument['dist-tags']?.latest;
        const meta = latest ? packument.versions?.[latest] : undefined;
        if (!meta) continue;
        const displayName = formatPluginDisplayName(runtime, meta.name);
        const verified =
          runtime === 'scrypted'
            ? meta.name.startsWith('@scrypted/')
            : this.verifiedHomebridge.has(meta.name);
        const { vendorId, vendorName } = resolvePluginVendor(meta.name, displayName);
        const { trustScore, stabilityTier } = computePluginTrustAndStability({
          verified,
          featured: false,
          officialScope: meta.name.startsWith('@scrypted/'),
        });
        const record: EcosystemPluginRecord = {
          id: ecosystemAppId(runtime, meta.name),
          packageName: meta.name,
          displayName,
          runtimeType: runtime,
          version: meta.version,
          description: `${runtime === 'scrypted' ? 'Scrypted' : 'Homebridge'} integration package (${meta.name}).`,
          category: classifyPluginCategory(runtime, meta.name),
          verified,
          featured: false,
          trustScore,
          stabilityTier,
          vendorId,
          vendorName,
          keywords: [runtime],
        };
        this.upsertRecord(record);
        return record;
      } catch {
        // Ignore non-existent candidate.
      }
    }
    return undefined;
  }
}
