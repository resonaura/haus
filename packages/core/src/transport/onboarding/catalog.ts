/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  formatStabilityMedal,
  GOVEE_BUILTIN_DRIVERS,
  resolveBrandIdentity,
  stabilityTierRank,
  type StabilityTier,
} from './brands.js';

export {
  CAMERA_SETUP_DOMAINS,
  formatStabilityMedal,
  GOVEE_BUILTIN_DRIVERS,
  HAUS_GOVEE_WHY_GROUPED,
  isGoveeAppId,
  resolveBrandIdentity,
  stabilityTierFromScore,
  stabilityTierRank,
  VENDOR_GROUP_WHY_DEFAULT,
  type BrandIdentity,
  type StabilityMedalInfo,
  type StabilityTier,
} from './brands.js';

export type IntegrationEcosystem = 'all' | 'ha' | 'hacs' | 'homebridge' | 'scrypted';
export type EcosystemRuntimeKind = 'ha' | 'hacs' | 'homebridge' | 'scrypted' | 'docker';

export interface EcosystemCatalogSourceItem {
  readonly id: string;
  readonly name: string;
  readonly runtimeType: 'homebridge' | 'scrypted' | 'docker' | 'hacs';
  readonly packageName?: string;
  readonly description?: string;
  readonly latestVersion?: string;
  readonly verified?: boolean;
  readonly trustScore?: number;
  readonly stabilityTier?: StabilityTier;
  readonly vendorId?: string;
  readonly vendorName?: string;
  readonly repositoryUrl?: string;
  readonly documentationUrl?: string;
  readonly hacsRepositoryId?: string;
  readonly domain?: string;
  readonly customRepository?: boolean;
  readonly stars?: number;
  readonly installed?: boolean;
}

export interface BrandCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly letter: string;
  readonly lowerId: string;
  readonly lowerTitle: string;
  readonly searchText: string;
  readonly runtime?: EcosystemRuntimeKind;
  readonly appId?: string;
  readonly packageName?: string;
  readonly domain?: string;
  readonly hacsRepositoryId?: string;
  readonly description?: string;
  readonly repositoryUrl?: string;
  readonly documentationUrl?: string;
  readonly verified?: boolean;
  readonly installed?: boolean;
  readonly vendorId?: string;
  readonly vendorTitle?: string;
  readonly iconId?: string;
  readonly trustScore?: number;
  readonly stabilityTier?: StabilityTier;
  readonly isCombinedHausGovee?: boolean;
  readonly driverCount?: number;
  readonly groupItems?: readonly BrandCatalogItem[];
}

export const INTEGRATION_CATALOG_ALPHABET = [
  '#',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
] as const;

const LETTER_ORDER = new Map<string, number>(
  INTEGRATION_CATALOG_ALPHABET.map((letter, index) => [letter, index]),
);

export function getBrandCatalogLetter(title: string): string {
  const clean = title.replace(/^Haus\s+Govee$/i, 'Govee').trim();
  const normalized = clean.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const first = normalized.charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

export function compareBrandCatalogItems(a: BrandCatalogItem, b: BrandCatalogItem): number {
  const orderA = LETTER_ORDER.get(a.letter) ?? 0;
  const orderB = LETTER_ORDER.get(b.letter) ?? 0;
  if (orderA !== orderB) return orderA - orderB;

  const tierA = stabilityTierRank(a.stabilityTier ?? 'gold');
  const tierB = stabilityTierRank(b.stabilityTier ?? 'gold');
  if (tierB !== tierA) return tierB - tierA;

  const byTitle = a.title.localeCompare(b.title, undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (byTitle !== 0) return byTitle;
  return a.id.localeCompare(b.id);
}

function ensureGoveeDrivers(drivers: BrandCatalogItem[]): void {
  for (const s of GOVEE_BUILTIN_DRIVERS) {
    if (drivers.some((d) => d.appId === s.appId || d.id === s.appId)) continue;
    const lowerTitle = s.title.toLowerCase();
    drivers.push({
      id: `${s.runtime}:${s.appId}`,
      appId: s.appId,
      title: s.title,
      letter: 'G',
      lowerId: s.appId,
      lowerTitle,
      searchText: `${lowerTitle} ${s.appId} govee lan ble mqtt`,
      runtime: s.runtime,
      packageName: s.appId,
      description: s.description,
      verified: true,
      vendorId: 'govee',
      vendorTitle: 'Haus Govee',
      iconId: 'govee',
      trustScore: s.trustScore,
      stabilityTier: 'gold',
      isCombinedHausGovee: true,
    });
  }
}

export function parseEcosystemCatalogPayload(raw: unknown): EcosystemCatalogSourceItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown[] }).entries)
      ? (raw as { entries: unknown[] }).entries
      : raw && typeof raw === 'object' && Array.isArray((raw as { apps?: unknown[] }).apps)
        ? (raw as { apps: unknown[] }).apps
        : [];
  const out: EcosystemCatalogSourceItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Readonly<Record<string, unknown>>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    const name = typeof rec.name === 'string' ? rec.name : '';
    const rt = typeof rec.runtimeType === 'string' ? rec.runtimeType : '';
    if (!id || !name) continue;
    if (rt !== 'homebridge' && rt !== 'scrypted' && rt !== 'hacs' && id !== 'govee2mqtt') continue;
    const tier =
      rec.stabilityTier === 'gold' ||
      rec.stabilityTier === 'silver' ||
      rec.stabilityTier === 'bronze' ||
      rec.stabilityTier === 'low'
        ? rec.stabilityTier
        : undefined;
    out.push({
      id,
      name,
      runtimeType: rt === 'homebridge' || rt === 'scrypted' || rt === 'hacs' ? rt : 'docker',
      ...(typeof rec.packageName === 'string' ? { packageName: rec.packageName } : {}),
      ...(typeof rec.description === 'string' ? { description: rec.description } : {}),
      ...(typeof rec.latestVersion === 'string' ? { latestVersion: rec.latestVersion } : {}),
      ...(rec.verified === true ? { verified: true } : {}),
      ...(typeof rec.trustScore === 'number' ? { trustScore: rec.trustScore } : {}),
      ...(tier ? { stabilityTier: tier } : {}),
      ...(typeof rec.vendorId === 'string' ? { vendorId: rec.vendorId } : {}),
      ...(typeof rec.vendorName === 'string' ? { vendorName: rec.vendorName } : {}),
      ...(typeof rec.repositoryUrl === 'string' ? { repositoryUrl: rec.repositoryUrl } : {}),
      ...(typeof rec.documentationUrl === 'string'
        ? { documentationUrl: rec.documentationUrl }
        : {}),
      ...(typeof rec.hacsRepositoryId === 'string'
        ? { hacsRepositoryId: rec.hacsRepositoryId }
        : {}),
      ...(typeof rec.domain === 'string' ? { domain: rec.domain } : {}),
      ...(rec.customRepository === true ? { customRepository: true } : {}),
      ...(typeof rec.stars === 'number' ? { stars: rec.stars } : {}),
      ...(rec.installed === true ? { installed: true } : {}),
    });
  }
  return out;
}

export function buildBrandIntegrationCatalog(
  handlers: readonly string[],
  names: Readonly<Record<string, string>>,
  ecosystemItems: readonly EcosystemCatalogSourceItem[] = [],
): readonly BrandCatalogItem[] {
  const seen = new Set<string>();
  const rawDrivers: BrandCatalogItem[] = [];

  for (const id of handlers) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rawTitle = names[`component.${id}.title`] ?? names[id] ?? id;
    const identity = resolveBrandIdentity(id, rawTitle);
    const title = identity.isCombinedHausGovee && id === 'govee' ? 'Haus Govee' : rawTitle;
    const lowerId = id.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const trustScore = identity.isCombinedHausGovee && id === 'govee' ? 99 : 94;
    rawDrivers.push({
      id,
      title,
      letter: getBrandCatalogLetter(title),
      lowerId,
      lowerTitle,
      searchText: `${lowerTitle} ${lowerId} ${identity.vendorTitle.toLowerCase()} ${identity.vendorId}`,
      runtime: 'ha',
      verified: true,
      vendorId: identity.vendorId,
      vendorTitle: identity.vendorTitle,
      iconId: identity.iconId,
      trustScore,
      stabilityTier: 'gold',
      ...(identity.isCombinedHausGovee ? { isCombinedHausGovee: true } : {}),
    });
  }

  for (const eco of ecosystemItems) {
    if (!eco.id) continue;
    const rt = eco.runtimeType;
    if (rt !== 'homebridge' && rt !== 'scrypted' && rt !== 'hacs' && eco.id !== 'govee2mqtt')
      continue;
    if (rt === 'hacs' && eco.domain && seen.has(eco.domain)) {
      const existing = rawDrivers.find((d) => d.id === eco.domain);
      if (existing && !existing.repositoryUrl && eco.repositoryUrl) {
        Object.assign(existing, {
          repositoryUrl: eco.repositoryUrl,
          hacsRepositoryId: eco.hacsRepositoryId,
        });
      }
      continue;
    }
    const compositeId = `${rt}:${eco.id}`;
    if (seen.has(compositeId)) continue;
    seen.add(compositeId);
    const cleanTitle = eco.name.replace(/\s+\(Scrypted\)$/i, '').trim() || eco.name;
    const pkg = eco.domain ?? eco.packageName ?? eco.id;
    const identity = resolveBrandIdentity(pkg, cleanTitle, eco.vendorId, eco.vendorName);
    const medal = formatStabilityMedal(eco.stabilityTier, eco.trustScore, eco.verified);
    const lowerId = pkg.toLowerCase();
    const lowerTitle = cleanTitle.toLowerCase();
    const desc = (eco.description ?? '').toLowerCase();
    rawDrivers.push({
      id: compositeId,
      appId: eco.id,
      title: cleanTitle,
      letter: getBrandCatalogLetter(identity.vendorTitle),
      lowerId,
      lowerTitle,
      searchText: `${lowerTitle} ${lowerId} ${eco.id.toLowerCase()} ${identity.vendorTitle.toLowerCase()} ${rt} ${desc}`,
      runtime: rt === 'homebridge' || rt === 'scrypted' || rt === 'hacs' ? rt : 'docker',
      packageName: pkg,
      ...(eco.domain ? { domain: eco.domain } : {}),
      ...(eco.hacsRepositoryId ? { hacsRepositoryId: eco.hacsRepositoryId } : {}),
      ...(eco.description ? { description: eco.description } : {}),
      ...(eco.repositoryUrl ? { repositoryUrl: eco.repositoryUrl } : {}),
      ...(eco.documentationUrl ? { documentationUrl: eco.documentationUrl } : {}),
      ...(eco.verified ? { verified: true } : {}),
      ...(eco.installed ? { installed: true } : {}),
      vendorId: identity.vendorId,
      vendorTitle: identity.vendorTitle,
      iconId: identity.iconId,
      trustScore: medal.trustScore,
      stabilityTier: medal.tier,
      ...(identity.isCombinedHausGovee ? { isCombinedHausGovee: true } : {}),
    });
  }

  const byVendor = new Map<string, BrandCatalogItem[]>();
  for (const driver of rawDrivers) {
    const key = driver.vendorId ?? driver.lowerId;
    const bucket = byVendor.get(key);
    if (bucket) bucket.push(driver);
    else byVendor.set(key, [driver]);
  }

  const brandItems: BrandCatalogItem[] = [];
  for (const [vendorId, drivers] of byVendor.entries()) {
    const isGovee = vendorId === 'govee' || drivers.some((d) => d.isCombinedHausGovee);
    const enrichedDrivers = [...drivers];
    if (isGovee) ensureGoveeDrivers(enrichedDrivers);

    enrichedDrivers.sort(
      (a, b) => (b.trustScore ?? 90) - (a.trustScore ?? 90) || a.title.localeCompare(b.title),
    );
    const top = enrichedDrivers[0]!;
    const haDriver = enrichedDrivers.find((d) => d.runtime === 'ha');
    const primary = isGovee ? (haDriver ?? top) : top;
    const brandTitle = isGovee
      ? 'Haus Govee'
      : enrichedDrivers.length > 1
        ? (primary.vendorTitle ?? primary.title)
        : primary.title;
    const primaryId = isGovee ? 'govee' : (haDriver?.id ?? primary.id);
    const letter = isGovee ? 'G' : getBrandCatalogLetter(brandTitle);
    const combinedSearch = enrichedDrivers.map((d) => d.searchText).join(' ');

    brandItems.push({
      ...primary,
      id: primaryId,
      title: brandTitle,
      letter,
      lowerId: primaryId.toLowerCase(),
      lowerTitle: brandTitle.toLowerCase(),
      searchText: `${brandTitle.toLowerCase()} ${primaryId.toLowerCase()} ${combinedSearch}`,
      vendorId,
      vendorTitle: brandTitle,
      iconId: primary.iconId ?? vendorId,
      trustScore: isGovee ? 99 : (top.trustScore ?? 94),
      stabilityTier: isGovee ? 'gold' : (top.stabilityTier ?? 'gold'),
      isCombinedHausGovee: isGovee,
      driverCount: enrichedDrivers.length,
      groupItems: enrichedDrivers,
    });
  }

  brandItems.sort(compareBrandCatalogItems);
  return brandItems;
}

export function countBrandCatalogEcosystems(
  catalog: readonly BrandCatalogItem[],
): Readonly<Record<IntegrationEcosystem, number>> {
  let ha = 0;
  let hacs = 0;
  let homebridge = 0;
  let scrypted = 0;
  for (const item of catalog) {
    const members = item.groupItems ?? [item];
    if (members.some((m) => (m.runtime ?? 'ha') === 'ha')) ha += 1;
    if (members.some((m) => m.runtime === 'hacs')) hacs += 1;
    if (members.some((m) => m.runtime === 'homebridge')) homebridge += 1;
    if (members.some((m) => m.runtime === 'scrypted')) scrypted += 1;
  }
  return { all: catalog.length, ha, hacs, homebridge, scrypted };
}

export function filterBrandIntegrationCatalog(
  catalog: readonly BrandCatalogItem[],
  rawQuery: string,
  ecosystem: IntegrationEcosystem = 'all',
  letterFilter?: string,
): readonly BrandCatalogItem[] {
  const ecoFiltered =
    ecosystem === 'all'
      ? catalog
      : catalog.filter((item) => {
          const members = item.groupItems ?? [item];
          return members.some((m) => (m.runtime ?? 'ha') === ecosystem);
        });

  const lettered = letterFilter
    ? ecoFiltered.filter((item) => item.letter === letterFilter)
    : ecoFiltered;

  const trimmed = rawQuery.trim().toLowerCase();
  if (!trimmed) return lettered;

  const terms = trimmed.split(/\s+/).filter(Boolean);
  const matches = lettered.filter((item) => terms.every((t) => item.searchText.includes(t)));
  return [...matches].sort((a, b) => {
    const aExact = a.lowerTitle === trimmed || a.lowerId === trimmed;
    const bExact = b.lowerTitle === trimmed || b.lowerId === trimmed;
    if (aExact !== bExact) return aExact ? -1 : 1;
    const aPrefix = a.lowerTitle.startsWith(trimmed) || a.lowerId.startsWith(trimmed);
    const bPrefix = b.lowerTitle.startsWith(trimmed) || b.lowerId.startsWith(trimmed);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return compareBrandCatalogItems(a, b);
  });
}
