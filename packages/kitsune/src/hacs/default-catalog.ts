/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppCatalog, AppCatalogEntry, AppStabilityTier } from '@haus/apps';
import { classifyPluginCategory, resolvePluginVendor } from '../catalog/metadata.js';
import { KNOWN_HACS_REPOS, type HacsRepositoryView } from './update-types.js';

export const HACS_V2_INTEGRATIONS_URL = 'https://data-v2.hacs.xyz/integration/data.json';

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BG_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_FILE_NAME = 'hacs-default-catalog.json';

export interface HacsDefaultCatalogItem {
  readonly id: string;
  readonly fullName: string;
  readonly domain: string;
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly stars: number;
  readonly downloads: number;
  readonly lastUpdated?: string;
  readonly topics: readonly string[];
  readonly minHaVersion?: string;
}

interface RawHacsV2Entry {
  readonly full_name?: unknown;
  readonly domain?: unknown;
  readonly description?: unknown;
  readonly manifest_name?: unknown;
  readonly manifest?: { readonly name?: unknown; readonly homeassistant?: unknown };
  readonly last_version?: unknown;
  readonly last_commit?: unknown;
  readonly last_updated?: unknown;
  readonly stargazers_count?: unknown;
  readonly downloads?: unknown;
  readonly topics?: unknown;
}

export function computeHacsTrustAndStability(params: {
  readonly stars?: number;
  readonly downloads?: number;
  readonly lastUpdated?: string;
  readonly curated?: boolean;
  readonly custom?: boolean;
}): { readonly trustScore: number; readonly stabilityTier: AppStabilityTier } {
  const stars = Math.max(0, Number(params.stars) || 0);
  const downloads = Math.max(0, Number(params.downloads) || 0);

  let score = 42;
  if (stars > 0) {
    score += Math.min(34, Math.round(Math.log10(stars + 1) * 11));
  }
  if (downloads > 0) {
    score += Math.min(14, Math.round(Math.log10(downloads + 1) * 3.5));
  }
  if (params.curated) {
    score = Math.max(score + 6, 86);
  }
  if (params.lastUpdated) {
    const updatedMs = Date.parse(params.lastUpdated);
    if (Number.isFinite(updatedMs)) {
      const ageDays = (Date.now() - updatedMs) / (24 * 60 * 60 * 1000);
      if (ageDays <= 180) score += 4;
      else if (ageDays > 730) score -= 12;
      else if (ageDays > 365) score -= 6;
    }
  }
  if (params.custom && stars < 5) {
    score = Math.min(score, 62);
  }

  // Keep HACS community integrations capped at 92 so official HA Core (94) wins equal brand ties.
  const trustScore = Math.max(26, Math.min(92, Math.round(score)));
  const stabilityTier: AppStabilityTier =
    trustScore >= 88 ? 'gold' : trustScore >= 74 ? 'silver' : trustScore >= 54 ? 'bronze' : 'low';
  return { trustScore, stabilityTier };
}

export function hacsAppCatalogId(domainOrRepo: string): string {
  const clean = domainOrRepo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  let id = `hacs-${clean || 'integration'}`;
  if (id.length > 64) {
    const digest = createHash('sha256').update(domainOrRepo).digest('hex').slice(0, 6);
    id = `${id.slice(0, 57).replace(/-+$/g, '')}-${digest}`;
  }
  return id;
}

export function hacsRepositoryToAppCatalogEntry(repo: HacsRepositoryView): AppCatalogEntry | null {
  if (repo.category !== 'integration') return null;
  const domain = repo.domain?.trim();
  if (!domain || domain === 'hacs') return null;

  const isCurated = Boolean(KNOWN_HACS_REPOS[domain]);
  const { vendorId, vendorName } = resolvePluginVendor(domain, repo.name);
  const { trustScore, stabilityTier } = computeHacsTrustAndStability({
    stars: repo.stars,
    downloads: repo.downloads,
    curated: isCurated,
    custom: repo.custom,
  });
  const repoUrl = `https://github.com/${repo.full_name}`;
  const author = repo.full_name.split('/')[0];
  const version = repo.available_version || repo.installed_version || '1.0.0';

  return {
    category: classifyPluginCategory('homebridge', domain, repo.description),
    runtimeType: 'hacs',
    verified: isCurated || (repo.stars ?? 0) >= 300,
    trustScore,
    stabilityTier,
    vendorId,
    vendorName,
    featured: isCurated || (repo.stars ?? 0) >= 500,
    author,
    repositoryUrl: repoUrl,
    documentationUrl: repoUrl,
    hacsRepositoryId: repo.id,
    domain,
    ...(repo.custom ? { customRepository: true } : {}),
    ...(repo.stars !== undefined ? { stars: repo.stars } : {}),
    ...(repo.downloads !== undefined ? { downloads: repo.downloads } : {}),
    manifest: {
      id: hacsAppCatalogId(domain),
      name: repo.name,
      version,
      image: 'python:3.12-slim',
      description: repo.description || `HACS community integration (${repo.full_name}).`,
      architectures: ['amd64', 'arm64'],
    },
  };
}

export function parseHacsV2CatalogJson(raw: unknown): HacsDefaultCatalogItem[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const entries: HacsDefaultCatalogItem[] = [];
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as RawHacsV2Entry;
    const fullName = typeof item.full_name === 'string' ? item.full_name.trim() : '';
    const domain = typeof item.domain === 'string' ? item.domain.trim() : '';
    if (!fullName || !domain) continue;
    const manifestName =
      typeof item.manifest_name === 'string' && item.manifest_name.trim()
        ? item.manifest_name.trim()
        : typeof item.manifest?.name === 'string' && item.manifest.name.trim()
          ? item.manifest.name.trim()
          : (fullName.split('/')[1] ?? domain);
    const description =
      typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : `HACS integration for ${manifestName}.`;
    const version =
      typeof item.last_version === 'string' && item.last_version.trim()
        ? item.last_version.trim()
        : typeof item.last_commit === 'string' && item.last_commit.trim()
          ? item.last_commit.trim().slice(0, 7)
          : undefined;
    const stars =
      typeof item.stargazers_count === 'number' && Number.isFinite(item.stargazers_count)
        ? item.stargazers_count
        : 0;
    const downloads =
      typeof item.downloads === 'number' && Number.isFinite(item.downloads) ? item.downloads : 0;
    const lastUpdated = typeof item.last_updated === 'string' ? item.last_updated : undefined;
    const topics = Array.isArray(item.topics)
      ? item.topics.filter((t): t is string => typeof t === 'string')
      : [];
    const minHaVersion =
      typeof item.manifest?.homeassistant === 'string' && item.manifest.homeassistant.trim()
        ? item.manifest.homeassistant.trim()
        : undefined;

    entries.push({
      id,
      fullName,
      domain,
      name: manifestName,
      description,
      ...(version ? { version } : {}),
      stars,
      downloads,
      ...(lastUpdated ? { lastUpdated } : {}),
      topics,
      ...(minHaVersion ? { minHaVersion } : {}),
    });
  }
  return entries;
}

/** Background indexer and disk cache for the official HACS v2 integration library (~5,500 integrations). */
export class HacsDefaultCatalog {
  private readonly itemsById = new Map<string, HacsDefaultCatalogItem>();
  private lastRefreshedAt = 0;
  private refreshPromise?: Promise<readonly HacsDefaultCatalogItem[]>;
  private backgroundTimer?: NodeJS.Timeout;

  constructor(
    private readonly storageDir: string,
    private fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
  }

  list(): readonly HacsDefaultCatalogItem[] {
    return Array.from(this.itemsById.values());
  }

  size(): number {
    return this.itemsById.size;
  }

  getLastRefreshedAt(): number {
    return this.lastRefreshedAt;
  }

  async loadDiskCache(): Promise<boolean> {
    try {
      const raw = await readFile(join(this.storageDir, CACHE_FILE_NAME), 'utf8');
      const parsed = JSON.parse(raw) as {
        updatedAt?: unknown;
        items?: readonly HacsDefaultCatalogItem[];
      };
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items) {
          if (item && typeof item.id === 'string' && typeof item.domain === 'string') {
            this.itemsById.set(item.id, item);
          }
        }
      }
      if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) {
        this.lastRefreshedAt = parsed.updatedAt;
      }
      return this.itemsById.size > 0;
    } catch {
      return false;
    }
  }

  private async saveDiskCache(): Promise<void> {
    try {
      await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
      const target = join(this.storageDir, CACHE_FILE_NAME);
      const tmp = `${target}.tmp`;
      await writeFile(
        tmp,
        JSON.stringify({
          updatedAt: this.lastRefreshedAt,
          items: Array.from(this.itemsById.values()),
        }),
        { mode: 0o600 },
      );
      await rename(tmp, target);
    } catch {
      // Non-fatal cache write error
    }
  }

  async refresh(force = false): Promise<readonly HacsDefaultCatalogItem[]> {
    if (
      !force &&
      this.lastRefreshedAt > 0 &&
      Date.now() - this.lastRefreshedAt < DEFAULT_CACHE_TTL_MS &&
      this.itemsById.size > 0
    ) {
      return this.list();
    }
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const res = await this.fetchImpl(HACS_V2_INTEGRATIONS_URL, {
          headers: { Accept: 'application/json', 'User-Agent': 'Haus-Hub' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return this.list();
        }
        const parsed = parseHacsV2CatalogJson(await res.json());
        if (parsed.length > 0) {
          this.itemsById.clear();
          for (const item of parsed) {
            this.itemsById.set(item.id, item);
          }
          this.lastRefreshedAt = Date.now();
          await this.saveDiskCache();
        }
      } catch {
        // Offline or transient network error; retain cached items
      } finally {
        this.refreshPromise = undefined;
      }
      return this.list();
    })();

    return this.refreshPromise;
  }

  startBackgroundSync(onUpdated?: () => void, intervalMs = DEFAULT_BG_INTERVAL_MS): void {
    void (async () => {
      const loaded = await this.loadDiskCache();
      if (loaded) onUpdated?.();
      await this.refresh(false).catch(() => undefined);
      onUpdated?.();
    })();

    if (!this.backgroundTimer && intervalMs > 0) {
      this.backgroundTimer = setInterval(() => {
        void this.refresh(false)
          .then(() => onUpdated?.())
          .catch(() => undefined);
      }, intervalMs);
      this.backgroundTimer.unref?.();
    }
  }

  stopBackgroundSync(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = undefined;
    }
  }

  syncRepositoriesIntoAppCatalog(
    catalog: AppCatalog,
    repositories: readonly HacsRepositoryView[],
  ): number {
    let count = 0;
    for (const repo of repositories) {
      const entry = hacsRepositoryToAppCatalogEntry(repo);
      if (!entry) continue;
      catalog.register(entry);
      count += 1;
    }
    return count;
  }
}
