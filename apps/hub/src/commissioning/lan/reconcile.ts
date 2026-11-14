/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DiscoveryRegistry, normalizeMac, normalizeUuid } from '@haus/core';
import type { HaIntegrationCatalog } from '@haus/ha';
import type { HomeKitControllerService } from '../../homekit/service.js';
import type { HubIntegrationEntryService } from '../entries.js';

export function resolveCatalogCachePath(): string | undefined {
  if (process.env.HAUS_CATALOG_CACHE_PATH?.trim()) {
    return resolve(process.env.HAUS_CATALOG_CACHE_PATH.trim());
  }
  const dataDir = process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA;
  if (dataDir?.trim()) {
    return join(resolve(dataDir.trim()), 'cache', 'ha-catalog-latest.json.gz');
  }
  if (existsSync('/data')) {
    return '/data/cache/ha-catalog-latest.json.gz';
  }
  return undefined;
}

export interface DiscoveryPersistencePort {
  save<T>(kind: string, entryId: string, value: T): Promise<void>;
  remove(kind: string, entryId: string): Promise<void>;
  listByKind<T>(kind: string): Promise<Array<{ entryId: string; value: T }>>;
}

const IGNORED_KIND = 'ignored_discovery';

export async function loadIgnoredDiscoveries(
  persistence: DiscoveryPersistencePort | undefined,
  registry: DiscoveryRegistry,
): Promise<void> {
  if (!persistence) return;
  try {
    const items = await persistence.listByKind<{ ignored?: boolean }>(IGNORED_KIND);
    for (const item of items) {
      if (item.value?.ignored !== false) {
        registry.seedIgnored(item.entryId);
      }
    }
  } catch {
    // Ignore storage read failures during early startup or minimal tests.
  }
}

export async function saveIgnoredDiscovery(
  persistence: DiscoveryPersistencePort | undefined,
  candidateId: string,
): Promise<void> {
  if (!persistence) return;
  await persistence.save(IGNORED_KIND, candidateId, { ignored: true }).catch(() => undefined);
}

export async function removeIgnoredDiscovery(
  persistence: DiscoveryPersistencePort | undefined,
  candidateId: string,
): Promise<void> {
  if (!persistence) return;
  await persistence.remove(IGNORED_KIND, candidateId).catch(() => undefined);
}

function collectEntryIdentifiers(data: Readonly<Record<string, unknown>> | undefined): {
  hosts: Set<string>;
  macs: Set<string>;
  uuids: Set<string>;
} {
  const hosts = new Set<string>();
  const macs = new Set<string>();
  const uuids = new Set<string>();
  if (!data) return { hosts, macs, uuids };

  for (const key of ['host', 'ip', 'address', 'hostname', 'broker', 'url']) {
    const val = data[key];
    if (typeof val === 'string' && val.trim()) {
      const clean = val
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split(/[/:]/)[0];
      if (clean) hosts.add(clean);
    }
  }
  for (const key of ['mac', 'macaddress', 'accessoryId']) {
    const val = data[key];
    if (typeof val === 'string') {
      const norm = normalizeMac(val);
      if (norm) macs.add(norm);
    }
  }
  for (const key of ['uuid', 'udn', 'uniqueId', 'unique_id']) {
    const val = data[key];
    if (typeof val === 'string') {
      const norm = normalizeUuid(val);
      if (norm) uuids.add(norm);
    }
  }
  return { hosts, macs, uuids };
}

const autoConfiguredByRegistry = new WeakMap<DiscoveryRegistry, Set<string>>();

export async function reconcileConfiguredDiscoveries(
  registry: DiscoveryRegistry,
  homekit: Pick<HomeKitControllerService, 'listPairings'> | undefined,
  entriesService: Pick<HubIntegrationEntryService, 'listEntries'> | undefined,
  catalog: HaIntegrationCatalog,
): Promise<void> {
  registry.pruneExpired(Date.now());
  let autoConfigured = autoConfiguredByRegistry.get(registry);
  if (!autoConfigured) {
    autoConfigured = new Set<string>();
    autoConfiguredByRegistry.set(registry, autoConfigured);
  }

  const pairings = typeof homekit?.listPairings === 'function' ? homekit.listPairings() : [];
  const pairedAccessoryIds = new Set<string>();
  const currentlyMatched = new Set<string>();

  for (const pairing of pairings) {
    const hapKey = pairing.accessoryId.trim().toLowerCase();
    pairedAccessoryIds.add(hapKey);
    const hapId = `hap:${hapKey}`;
    registry.markConfigured(hapId, true);
    currentlyMatched.add(hapId);
    const mac = normalizeMac(pairing.accessoryId);
    if (mac) {
      const macId = `mac:${mac}`;
      registry.markConfigured(macId, true);
      currentlyMatched.add(macId);
    }
  }

  const entries = entriesService ? await entriesService.listEntries().catch(() => []) : [];
  const activeEntries = entries.filter((e) => !e.disabled_by && e.state !== 'setup_error');
  const activeDomains = new Set(activeEntries.map((e) => e.domain.toLowerCase()));

  const candidates = [
    ...registry.listCandidates({ status: 'discovered' }),
    ...Array.from(autoConfigured)
      .map((id) => registry.getCandidate(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c && c.status === 'configured')),
  ];

  for (const candidate of candidates) {
    const dom = candidate.domain.toLowerCase();
    let isMatched = false;

    if (dom === 'homekit' || dom === 'homekit_controller') {
      const hapIdentity = candidate.durableIdentities.find((i) => i.kind === 'hap');
      const hapId = hapIdentity?.value.slice('hap:'.length).toLowerCase();
      if (hapId && pairedAccessoryIds.has(hapId)) {
        isMatched = true;
      }
    }

    if (!isMatched) {
      const manifest = catalog.getManifest(dom);
      if (manifest?.single_config_entry && activeDomains.has(dom)) {
        isMatched = true;
      }
    }

    if (!isMatched) {
      const domainEntries = activeEntries.filter((e) => e.domain.toLowerCase() === dom);
      isMatched = domainEntries.some((entry) => {
        const ids = collectEntryIdentifiers(entry.data);
        if (candidate.addresses.some((addr) => ids.hosts.has(addr.trim().toLowerCase()))) {
          return true;
        }
        return candidate.durableIdentities.some((ident) => {
          if (ident.kind === 'mac') return ids.macs.has(ident.value.slice('mac:'.length));
          if (ident.kind === 'uuid') return ids.uuids.has(ident.value.slice('uuid:'.length));
          if (ident.kind === 'hap')
            return ids.macs.has(normalizeMac(ident.value.slice('hap:'.length)) ?? '');
          return false;
        });
      });
    }

    if (isMatched) {
      currentlyMatched.add(candidate.id);
      if (candidate.status !== 'configured') {
        registry.markConfigured(candidate.id, true);
        autoConfigured.add(candidate.id);
      }
    }
  }

  for (const id of Array.from(autoConfigured)) {
    if (!currentlyMatched.has(id)) {
      autoConfigured.delete(id);
      registry.markConfigured(id, false);
    }
  }
}
