/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type HaUpdateCategory =
  'core' | 'integration' | 'plugin' | 'addon' | 'homebridge' | 'scrypted' | 'hacs';

export interface HaUnifiedUpdateItem {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly category: HaUpdateCategory;
  readonly installedVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly canInstall: boolean;
  readonly inProgress?: boolean;
  readonly skippedVersion?: string;
  readonly releaseUrl?: string;
  readonly releaseSummary?: string;
  readonly checkedAt: string;
  readonly entityId?: string;
  readonly addonSlug?: string;
  readonly hacsRepositoryId?: string;
}

export interface HaUnifiedUpdatesResponse {
  readonly checkedAt: string;
  readonly total: number;
  readonly availableCount: number;
  readonly items: readonly HaUnifiedUpdateItem[];
}

export interface HaIntegrationDomainMeta {
  readonly domain: string;
  readonly name: string;
  readonly version?: string;
  readonly runtimeType:
    'built_in' | 'custom_integration' | 'homebridge' | 'scrypted' | 'docker_app' | 'addon';
  readonly iotClass?: string;
  readonly supportsOptions: boolean;
  readonly supportsReconfigure: boolean;
  readonly supportsMultiple: boolean;
  readonly documentationUrl?: string;
  readonly deviceCount: number;
  readonly entityCount: number;
  readonly entryCount: number;
  readonly brokenCount: number;
}

type HaRequestFn = <T = unknown>(message: Record<string, unknown>) => Promise<T>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function inferEntityCategory(entityId: string, attrs: Record<string, unknown>): HaUpdateCategory {
  const slug = entityId.slice('update.'.length).toLowerCase();
  if (
    slug.startsWith('home_assistant_') ||
    slug === 'home_assistant' ||
    slug.startsWith('hass_os') ||
    slug.includes('supervisor') ||
    attrs.title === 'Home Assistant Core' ||
    attrs.title === 'Home Assistant Operating System'
  ) {
    return 'core';
  }
  if (slug.includes('addon') || slug.includes('zigbee2mqtt') || slug.includes('mosquitto')) {
    return 'addon';
  }
  return 'integration';
}

export async function computeHaUpdates(requestFn: HaRequestFn): Promise<HaUnifiedUpdatesResponse> {
  const checkedAt = new Date().toISOString();
  const [statesRaw, hacsReposRaw, addonsRaw] = await Promise.all([
    requestFn<unknown[]>({ type: 'get_states' }).catch(() => []),
    requestFn<unknown[]>({ type: 'hacs/repositories/list' }).catch(() => []),
    requestFn<unknown>({
      type: 'supervisor/api',
      endpoint: '/addons',
      method: 'get',
    }).catch(() => null),
  ]);

  const items: HaUnifiedUpdateItem[] = [];
  const seenKeys = new Set<string>();

  if (Array.isArray(statesRaw)) {
    for (const raw of statesRaw) {
      if (!isRecord(raw) || typeof raw.entity_id !== 'string') continue;
      if (!raw.entity_id.startsWith('update.')) continue;
      const attrs = isRecord(raw.attributes) ? raw.attributes : {};
      const installedVersion = asStr(attrs.installed_version) ?? 'unknown';
      const latestVersion = asStr(attrs.latest_version) ?? installedVersion;
      const skippedVersion = asStr(attrs.skipped_version);
      const updateAvailable = raw.state === 'on';
      const title =
        asStr(attrs.title) ?? asStr(attrs.friendly_name) ?? raw.entity_id.slice('update.'.length);
      const domain = raw.entity_id.slice('update.'.length);
      const id = `entity:${raw.entity_id}`;
      seenKeys.add(title.toLowerCase());
      items.push({
        id,
        domain,
        title,
        category: inferEntityCategory(raw.entity_id, attrs),
        installedVersion,
        latestVersion,
        updateAvailable,
        canInstall: updateAvailable,
        inProgress: Boolean(attrs.in_progress),
        ...(skippedVersion ? { skippedVersion } : {}),
        ...(asStr(attrs.release_url) ? { releaseUrl: asStr(attrs.release_url) } : {}),
        ...(asStr(attrs.release_summary) ? { releaseSummary: asStr(attrs.release_summary) } : {}),
        checkedAt,
        entityId: raw.entity_id,
      });
    }
  }

  if (Array.isArray(hacsReposRaw)) {
    for (const repo of hacsReposRaw) {
      if (!isRecord(repo) || repo.installed !== true) continue;
      const repoId = repo.id !== undefined ? String(repo.id) : '';
      const name = asStr(repo.name) ?? asStr(repo.full_name) ?? repoId;
      if (!repoId || !name || seenKeys.has(name.toLowerCase())) continue;
      const installedVersion = asStr(repo.installed_version) ?? 'unknown';
      const latestVersion = asStr(repo.available_version) ?? installedVersion;
      const updateAvailable = Boolean(repo.pending_upgrade) || installedVersion !== latestVersion;
      const category: HaUpdateCategory = repo.category === 'plugin' ? 'plugin' : 'hacs';
      items.push({
        id: `hacs:${repoId}`,
        domain: asStr(repo.domain) ?? name.toLowerCase(),
        title: name,
        category,
        installedVersion,
        latestVersion,
        updateAvailable,
        canInstall: updateAvailable,
        ...(asStr(repo.full_name)
          ? { releaseUrl: `https://github.com/${String(repo.full_name)}/releases` }
          : {}),
        checkedAt,
        hacsRepositoryId: repoId,
      });
    }
  }

  const addonList = isRecord(addonsRaw) && Array.isArray(addonsRaw.addons) ? addonsRaw.addons : [];
  for (const addon of addonList) {
    if (!isRecord(addon) || typeof addon.slug !== 'string') continue;
    const title = asStr(addon.name) ?? addon.slug;
    if (seenKeys.has(title.toLowerCase())) continue;
    const installedVersion = asStr(addon.version) ?? 'unknown';
    const latestVersion = asStr(addon.version_latest) ?? installedVersion;
    const updateAvailable = Boolean(addon.update_available);
    items.push({
      id: `addon:${addon.slug}`,
      domain: addon.slug,
      title,
      category: 'addon',
      installedVersion,
      latestVersion,
      updateAvailable,
      canInstall: updateAvailable,
      checkedAt,
      addonSlug: addon.slug,
    });
  }

  items.sort((a, b) => {
    if (a.updateAvailable !== b.updateAvailable) return a.updateAvailable ? -1 : 1;
    if (a.category === 'core' && b.category !== 'core') return -1;
    if (b.category === 'core' && a.category !== 'core') return 1;
    return a.title.localeCompare(b.title);
  });

  return {
    checkedAt,
    total: items.length,
    availableCount: items.filter((item) => item.updateAvailable).length,
    items,
  };
}

export async function installHaUpdate(
  requestFn: HaRequestFn,
  id: string,
): Promise<{ status: string; id: string }> {
  if (id.startsWith('entity:') || id.startsWith('update.')) {
    const entityId = id.startsWith('entity:') ? id.slice('entity:'.length) : id;
    await requestFn({
      type: 'call_service',
      domain: 'update',
      service: 'install',
      target: { entity_id: entityId },
    });
    return { status: 'updated', id };
  }
  if (id.startsWith('addon:')) {
    const slug = id.slice('addon:'.length);
    await requestFn({
      type: 'supervisor/api',
      endpoint: `/store/addons/${encodeURIComponent(slug)}/update`,
      method: 'post',
    });
    return { status: 'updated', id };
  }
  if (id.startsWith('hacs:')) {
    const repo = id.slice('hacs:'.length);
    await requestFn({
      type: 'hacs/repository/download',
      repository: repo,
    });
    return { status: 'updated', id };
  }
  throw new Error(`Unsupported update target: ${id}`);
}

export async function computeHaIntegrationMetadata(
  requestFn: HaRequestFn,
): Promise<readonly HaIntegrationDomainMeta[]> {
  const [entriesRaw, manifestsRaw, devicesRaw, entitiesRaw, hacsReposRaw] = await Promise.all([
    requestFn<unknown[]>({ type: 'config_entries/get' }).catch(() => []),
    requestFn<unknown[]>({ type: 'manifest/list' }).catch(() => []),
    requestFn<unknown[]>({ type: 'config/device_registry/list' }).catch(() => []),
    requestFn<unknown[]>({ type: 'config/entity_registry/list' }).catch(() => []),
    requestFn<unknown[]>({ type: 'hacs/repositories/list' }).catch(() => []),
  ]);

  const hacsDomains = new Set<string>();
  if (Array.isArray(hacsReposRaw)) {
    for (const repo of hacsReposRaw) {
      if (isRecord(repo) && repo.installed === true && typeof repo.domain === 'string') {
        hacsDomains.add(repo.domain);
      }
    }
  }

  const manifests = new Map<string, Record<string, unknown>>();
  if (Array.isArray(manifestsRaw)) {
    for (const m of manifestsRaw) {
      if (isRecord(m) && typeof m.domain === 'string') manifests.set(m.domain, m);
    }
  }

  const entryIdsByDomain = new Map<string, Set<string>>();
  const entriesByDomain = new Map<string, Record<string, unknown>[]>();
  if (Array.isArray(entriesRaw)) {
    for (const entry of entriesRaw) {
      if (!isRecord(entry) || typeof entry.domain !== 'string') continue;
      const list = entriesByDomain.get(entry.domain) ?? [];
      list.push(entry);
      entriesByDomain.set(entry.domain, list);
      if (typeof entry.entry_id === 'string') {
        const set = entryIdsByDomain.get(entry.domain) ?? new Set<string>();
        set.add(entry.entry_id);
        entryIdsByDomain.set(entry.domain, set);
      }
    }
  }

  const deviceIdsByDomain = new Map<string, Set<string>>();
  if (Array.isArray(devicesRaw)) {
    for (const dev of devicesRaw) {
      if (!isRecord(dev) || typeof dev.id !== 'string' || !Array.isArray(dev.config_entries)) {
        continue;
      }
      for (const [domain, entrySet] of entryIdsByDomain) {
        if (dev.config_entries.some((cid) => typeof cid === 'string' && entrySet.has(cid))) {
          const devSet = deviceIdsByDomain.get(domain) ?? new Set<string>();
          devSet.add(dev.id);
          deviceIdsByDomain.set(domain, devSet);
        }
      }
    }
  }

  const entityCountByDomain = new Map<string, number>();
  if (Array.isArray(entitiesRaw)) {
    for (const ent of entitiesRaw) {
      if (!isRecord(ent)) continue;
      const cfgId = asStr(ent.config_entry_id);
      const devId = asStr(ent.device_id);
      const platform = asStr(ent.platform);
      let matchedDomain: string | undefined;
      for (const [domain, entrySet] of entryIdsByDomain) {
        const devSet = deviceIdsByDomain.get(domain);
        if ((cfgId && entrySet.has(cfgId)) || (devId && devSet?.has(devId))) {
          matchedDomain = domain;
          break;
        }
      }
      if (!matchedDomain && platform && entriesByDomain.has(platform)) matchedDomain = platform;
      if (matchedDomain) {
        entityCountByDomain.set(matchedDomain, (entityCountByDomain.get(matchedDomain) ?? 0) + 1);
      }
    }
  }

  const domains = new Set<string>([...manifests.keys(), ...entriesByDomain.keys()]);
  const out: HaIntegrationDomainMeta[] = [];

  for (const domain of domains) {
    const m = manifests.get(domain);
    const domainEntries = entriesByDomain.get(domain) ?? [];
    const custom = m?.is_built_in === false || hacsDomains.has(domain);
    const brokenCount = domainEntries.filter((e) =>
      ['setup_error', 'setup_retry', 'failed_unload'].includes(String(e.state ?? '')),
    ).length;

    out.push({
      domain,
      name: asStr(m?.name) ?? asStr(domainEntries[0]?.title) ?? domain,
      ...(asStr(m?.version) ? { version: asStr(m?.version) } : {}),
      runtimeType: custom ? 'custom_integration' : 'built_in',
      ...(asStr(m?.iot_class) ? { iotClass: asStr(m?.iot_class) } : {}),
      supportsOptions: domainEntries.some((e) => Boolean(e.supports_options)),
      supportsReconfigure: domainEntries.some((e) => Boolean(e.supports_reconfigure)),
      supportsMultiple: m?.single_config_entry !== true,
      ...(asStr(m?.documentation) ? { documentationUrl: asStr(m?.documentation) } : {}),
      deviceCount: deviceIdsByDomain.get(domain)?.size ?? 0,
      entityCount: entityCountByDomain.get(domain) ?? 0,
      entryCount: domainEntries.length,
      brokenCount,
    });
  }

  return out;
}
