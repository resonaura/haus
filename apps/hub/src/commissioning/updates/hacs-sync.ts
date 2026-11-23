/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppCatalog } from '@haus/apps';
import type { HacsUpdateManager } from '@haus/kitsune';
import type { HubIntegrationEntryService } from '../entries.js';
import type { UnifiedUpdateItem } from '../updates.js';

/** Collects unified update items for all installed HACS integrations. */
export async function collectInstalledHacsUpdates(params: {
  readonly hacs: HacsUpdateManager;
  readonly entries: HubIntegrationEntryService;
  readonly installing: ReadonlySet<string>;
  readonly forceRefresh: boolean;
  readonly checkedAt: string;
}): Promise<UnifiedUpdateItem[]> {
  const entries = await params.entries.listEntries();
  const configuredRefs = entries.map((e) => ({ domain: e.domain, version: e.version }));
  const hacsRepos = await params.hacs.listRepositories(configuredRefs, params.forceRefresh);
  const out: UnifiedUpdateItem[] = [];
  for (const repo of hacsRepos) {
    if (!repo.installed) continue;
    const domain = repo.domain ?? repo.id;
    const id = `hacs:${domain}`;
    const installedVersion = repo.installed_version ?? '0.0.0';
    const latestVersion = repo.available_version ?? installedVersion;
    const updateAvailable = repo.pending_upgrade;
    const canInstall = updateAvailable && repo.can_download && repo.category === 'integration';
    out.push({
      id,
      domain,
      title: repo.name,
      category: 'hacs',
      installedVersion,
      latestVersion,
      updateAvailable,
      canInstall,
      inProgress: params.installing.has(id),
      releaseUrl: repo.release_url,
      releaseSummary: repo.release_summary,
      checkedAt: params.checkedAt,
      hacsRepositoryId: repo.id,
      compatibility: repo.compatibility,
      compatibilityReason: repo.compatibility_reason,
      pendingRestart: repo.pending_restart,
    });
  }
  return out;
}

/** Synchronizes the HACS integration library (default + custom) into Haus `AppCatalog`. */
export async function syncHacsCatalogEntries(params: {
  readonly hacs: HacsUpdateManager;
  readonly entries: HubIntegrationEntryService;
  readonly appCatalog: AppCatalog;
  readonly trackedAppIds: Set<string>;
}): Promise<number> {
  const entries = await params.entries.listEntries().catch(() => []);
  const configured = entries.map((e) => ({ domain: e.domain, version: e.version }));
  const repos = await params.hacs.listRepositories(configured, false);
  const count = params.hacs.defaultCatalog.syncRepositoriesIntoAppCatalog(params.appCatalog, repos);
  const nextIds = new Set<string>();
  for (const item of params.appCatalog.list({ runtimeType: 'hacs' })) {
    if (item.hacsRepositoryId) nextIds.add(item.manifest.id);
  }
  for (const prevId of params.trackedAppIds) {
    if (!nextIds.has(prevId)) params.appCatalog.unregister(prevId);
  }
  params.trackedAppIds.clear();
  for (const id of nextIds) params.trackedAppIds.add(id);
  return count;
}
