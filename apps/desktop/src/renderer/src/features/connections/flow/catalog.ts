/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FlowStep } from '../../../ha/management';
import {
  formatStabilityMedal,
  GOVEE_BUILTIN_DRIVERS,
  resolveBrandIdentity,
  stabilityTierRank,
  type StabilityTier,
} from '../../apps/vendor-grouping';
import { INTEGRATION_ALPHABET } from './virtual-layout';

export type FlowTarget = {
  domain?: string;
  title?: string;
  entryId?: string;
  flowId?: string;
  appCatalogId?: string;
  appRuntime?: 'hacs' | 'homebridge' | 'scrypted' | 'docker';
  brandItem?: IntegrationCatalogItem;
  kind?: 'config' | 'options';
  reconfigure?: boolean;
  reauth?: boolean;
  repair?: { domain: string; issue_id: string; translation_key?: string };
  initialStep?: FlowStep;
};

export type SelectedEcosystemApp = {
  appId: string;
  title: string;
  runtime: 'hacs' | 'homebridge' | 'scrypted' | 'docker';
  hacsRepositoryId?: string;
  hacsDomain?: string;
};

export function resolveFlowHeaderPresentation(params: {
  selectedApp: SelectedEcosystemApp | null;
  step: FlowStep | null;
  hasTarget: boolean;
  domain: string;
  integrationTitle: string;
  brandTitle?: string;
  title: string;
}) {
  const { selectedApp, step, hasTarget, domain, integrationTitle, brandTitle, title } = params;
  const displayTitle = selectedApp
    ? selectedApp.title
    : step
      ? title
      : hasTarget && domain
        ? integrationTitle
        : (brandTitle ?? title);
  const headerIconId = selectedApp ? selectedApp.appId : domain;
  const headerIconKind = !selectedApp
    ? ('integration' as const)
    : selectedApp.runtime === 'docker'
      ? ('app' as const)
      : selectedApp.runtime;
  const headerIconHint = selectedApp
    ? { name: selectedApp.title }
    : {
        ...(title ? { name: title } : {}),
        ...(step?.supported_by ? { supportedBy: step.supported_by } : {}),
      };
  return { displayTitle, headerIconId, headerIconKind, headerIconHint };
}

export {
  buildIntegrationVirtualLayout,
  computeIntegrationGridColumns,
  INTEGRATION_ALPHABET,
  INTEGRATION_BATCH_STEP,
  INTEGRATION_HEADER_ROW_HEIGHT,
  INTEGRATION_INITIAL_BATCH,
  INTEGRATION_ITEM_ROW_GAP,
  INTEGRATION_ITEM_ROW_HEIGHT,
  INTEGRATION_ITEM_ROW_STRIDE,
  INTEGRATION_PREFETCH_ROWS,
  loadedCountForSectionJump,
  nextProgressiveLoadedCount,
  nextProgressiveLoadedCountForRows,
  sliceProgressiveVirtualRows,
  type IntegrationLetterSection,
  type IntegrationVirtualLayout,
  type IntegrationVirtualRow,
} from './virtual-layout';

const LETTER_ORDER = new Map<string, number>(
  INTEGRATION_ALPHABET.map((letter, index) => [letter, index]),
);

export type IntegrationEcosystem = 'all' | 'ha' | 'hacs' | 'homebridge' | 'scrypted';

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
  readonly hacsRepositoryId?: string;
  readonly domain?: string;
  readonly customRepository?: boolean;
  readonly stars?: number;
  readonly installed?: boolean;
}

export interface IntegrationCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly letter: string;
  readonly lowerId: string;
  readonly lowerTitle: string;
  readonly searchText: string;
  readonly runtime?: 'ha' | 'hacs' | 'homebridge' | 'scrypted' | 'docker';
  readonly appId?: string;
  readonly packageName?: string;
  readonly domain?: string;
  readonly hacsRepositoryId?: string;
  readonly description?: string;
  readonly repositoryUrl?: string;
  readonly verified?: boolean;
  readonly installed?: boolean;
  readonly vendorId?: string;
  readonly vendorTitle?: string;
  readonly iconId?: string;
  readonly trustScore?: number;
  readonly stabilityTier?: StabilityTier;
  readonly isCombinedHausGovee?: boolean;
  readonly driverCount?: number;
  readonly groupItems?: readonly IntegrationCatalogItem[];
}

export function getIntegrationLetter(title: string): string {
  const clean = title.replace(/^Haus\s+Govee$/i, 'Govee').trim();
  const normalized = clean.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const first = normalized.charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

export function compareIntegrationItems(
  a: IntegrationCatalogItem,
  b: IntegrationCatalogItem,
): number {
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

function ensureGoveeDrivers(drivers: IntegrationCatalogItem[]): void {
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

function matchesTerm(item: IntegrationCatalogItem, term: string, prefixOnly: boolean): boolean {
  const fields = [
    item.lowerTitle,
    item.lowerId,
    item.appId?.toLowerCase(),
    item.packageName?.toLowerCase(),
  ];
  return fields.some((v) => Boolean(v && (prefixOnly ? v.startsWith(term) : v === term)));
}

export function buildIntegrationCatalog(
  handlers: readonly string[],
  names: Readonly<Record<string, string>>,
  ecosystemItems: readonly EcosystemCatalogSourceItem[] = [],
): readonly IntegrationCatalogItem[] {
  const seen = new Set<string>();
  const rawDrivers: IntegrationCatalogItem[] = [];

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
      letter: getIntegrationLetter(title),
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
      letter: getIntegrationLetter(identity.vendorTitle),
      lowerId,
      lowerTitle,
      searchText: `${lowerTitle} ${lowerId} ${eco.id.toLowerCase()} ${identity.vendorTitle.toLowerCase()} ${rt} ${desc}`,
      runtime: rt === 'homebridge' || rt === 'scrypted' || rt === 'hacs' ? rt : 'docker',
      packageName: pkg,
      ...(eco.domain ? { domain: eco.domain } : {}),
      ...(eco.hacsRepositoryId ? { hacsRepositoryId: eco.hacsRepositoryId } : {}),
      ...(eco.description ? { description: eco.description } : {}),
      ...(eco.repositoryUrl ? { repositoryUrl: eco.repositoryUrl } : {}),
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

  // Group drivers by vendorId so the picker displays brand cards with ranked drivers inside.
  const byVendor = new Map<string, IntegrationCatalogItem[]>();
  for (const driver of rawDrivers) {
    const key = driver.vendorId ?? driver.lowerId;
    const bucket = byVendor.get(key);
    if (bucket) bucket.push(driver);
    else byVendor.set(key, [driver]);
  }

  const brandItems: IntegrationCatalogItem[] = [];
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
    const letter = isGovee ? 'G' : getIntegrationLetter(brandTitle);
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

  brandItems.sort(compareIntegrationItems);
  return brandItems;
}

export function filterIntegrationCatalog(
  catalog: readonly IntegrationCatalogItem[],
  rawQuery: string,
  ecosystem: IntegrationEcosystem = 'all',
): readonly IntegrationCatalogItem[] {
  let scoped: readonly IntegrationCatalogItem[] = catalog;
  if (ecosystem !== 'all') {
    const filteredGroups: IntegrationCatalogItem[] = [];
    for (const item of catalog) {
      const members = (item.groupItems ?? [item]).filter((m) => (m.runtime ?? 'ha') === ecosystem);
      if (members.length === 0) continue;
      const top = members[0]!;
      filteredGroups.push({
        ...item,
        ...(ecosystem !== 'ha' && top.appId
          ? { id: top.id, appId: top.appId, runtime: top.runtime }
          : {}),
        ...(top.domain ? { domain: top.domain } : {}),
        ...(top.hacsRepositoryId ? { hacsRepositoryId: top.hacsRepositoryId } : {}),
        ...(top.packageName ? { packageName: top.packageName } : {}),
        trustScore: top.trustScore ?? item.trustScore,
        stabilityTier: top.stabilityTier ?? item.stabilityTier,
        driverCount: members.length,
        groupItems: members,
      });
    }
    scoped = filteredGroups;
  }

  const term = rawQuery.trim().toLowerCase();
  if (!term) return scoped;
  const exact: IntegrationCatalogItem[] = [];
  const prefix: IntegrationCatalogItem[] = [];
  const partial: IntegrationCatalogItem[] = [];
  for (const item of scoped) {
    if (
      matchesTerm(item, term, false) ||
      item.groupItems?.some((g) => matchesTerm(g, term, false))
    ) {
      exact.push(item);
    } else if (
      matchesTerm(item, term, true) ||
      item.groupItems?.some((g) => matchesTerm(g, term, true))
    ) {
      prefix.push(item);
    } else if (item.searchText.includes(term)) {
      partial.push(item);
    }
  }
  return [...exact, ...prefix, ...partial];
}
