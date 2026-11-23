/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { scanInstalledCustomComponents } from './archive-stage.js';
import type { HacsDefaultCatalogItem } from './default-catalog.js';
import {
  compareHacsVersions,
  deriveRepositoryId,
  evaluateHacsCompatibility,
  KNOWN_HACS_REPOS,
  normalizeHacsVersion,
  type HacsRepositoryCategory,
  type HacsRepositoryView,
} from './update-types.js';

export { executeHacsRpcCommand, type ExecuteHacsRpcInput } from './rpc-commands.js';

export interface PersistedRepoSettings {
  readonly id: string;
  readonly fullName: string;
  readonly domain?: string;
  readonly title?: string;
  readonly description?: string;
  readonly category: HacsRepositoryCategory;
  readonly custom?: boolean;
  readonly defaultBranch?: string;
  readonly stars?: number;
  readonly downloads?: number;
  readonly topics?: readonly string[];
  readonly configFlow?: boolean;
  readonly hacsJson?: Record<string, unknown>;
  readonly beta?: boolean;
  readonly hide?: boolean;
  readonly selectedTag?: string;
  readonly installedVersion?: string;
  readonly downloadedVersion?: string;
  readonly pendingRestart?: boolean;
  readonly availableVersion?: string;
  readonly releaseUrl?: string;
  readonly releaseSummary?: string;
}

export interface PersistedHacsState {
  readonly repositories: Record<string, PersistedRepoSettings>;
  readonly acknowledgedCritical: string[];
  readonly removed: Array<{ readonly repository: string; readonly reason?: string }>;
}

export function findTargetHacsRepository(
  repos: readonly HacsRepositoryView[],
  identifier: string,
): HacsRepositoryView {
  const clean = identifier.startsWith('hacs:') ? identifier.slice('hacs:'.length) : identifier;
  const found = repos.find(
    (r) =>
      r.id === clean || r.domain === clean || r.full_name.toLowerCase() === clean.toLowerCase(),
  );
  if (!found) throw new Error(`hacs_unknown_repository:${clean}`);
  return found;
}

export async function fetchGitHubJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; data?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Haus-Hub' },
      signal: controller.signal,
    });
    if (res.status === 403 || res.status === 429) return { status: res.status };
    if (!res.ok) return { status: res.status };
    return { status: 200, data: await res.json() };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveRemoteRelease(input: {
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly fullName: string;
  readonly domain?: string;
  readonly requestedVersion?: string;
  readonly includeBeta?: boolean;
  readonly defaultBranch?: string;
  readonly hacsJson?: Record<string, unknown>;
}): Promise<{
  readonly version: string;
  readonly downloadUrl: string;
  readonly releaseUrl: string;
  readonly summary?: string;
  readonly hacsJson?: Record<string, unknown>;
} | null> {
  const branch = input.defaultBranch ?? 'main';
  const endpoint =
    input.requestedVersion && input.requestedVersion !== 'latest'
      ? `https://api.github.com/repos/${input.fullName}/releases/tags/${encodeURIComponent(input.requestedVersion)}`
      : input.includeBeta
        ? `https://api.github.com/repos/${input.fullName}/releases`
        : `https://api.github.com/repos/${input.fullName}/releases/latest`;
  const res = await fetchGitHubJson(input.fetchImpl, endpoint, input.timeoutMs);
  if (res.status === 403 || res.status === 429) {
    throw new Error('github_rate_limited');
  }

  const releaseObj = Array.isArray(res.data)
    ? (res.data[0] as Record<string, unknown> | undefined)
    : (res.data as Record<string, unknown> | undefined);

  if (res.status === 200 && releaseObj && typeof releaseObj.tag_name === 'string') {
    const tag = releaseObj.tag_name;
    const version = normalizeHacsVersion(tag);
    const assets = Array.isArray(releaseObj.assets)
      ? (releaseObj.assets as Array<Record<string, unknown>>)
      : [];
    const releaseHacs =
      releaseObj.hacs && typeof releaseObj.hacs === 'object' && !Array.isArray(releaseObj.hacs)
        ? (releaseObj.hacs as Record<string, unknown>)
        : input.hacsJson;
    const zipRelease = releaseHacs?.zip_release;
    const explicitFilename =
      typeof releaseHacs?.filename === 'string' && releaseHacs.filename.trim()
        ? releaseHacs.filename.trim()
        : undefined;

    let matchingAsset: Record<string, unknown> | undefined;
    if (zipRelease === true) {
      matchingAsset =
        (explicitFilename
          ? assets.find(
              (a) =>
                typeof a.browser_download_url === 'string' &&
                typeof a.name === 'string' &&
                a.name === explicitFilename,
            )
          : undefined) ??
        assets.find(
          (a) =>
            typeof a.browser_download_url === 'string' &&
            typeof a.name === 'string' &&
            (a.name === `${input.domain}.zip` || a.name.endsWith('.zip')),
        );
    } else if (zipRelease !== false) {
      matchingAsset =
        assets.find(
          (a) =>
            typeof a.browser_download_url === 'string' &&
            typeof a.name === 'string' &&
            (a.name === `${input.domain}.zip` ||
              a.name.endsWith('.zip') ||
              a.name.endsWith('.tar.gz')),
        ) ?? assets[0];
    }

    const downloadUrl =
      (typeof matchingAsset?.browser_download_url === 'string' &&
        matchingAsset.browser_download_url) ||
      (typeof releaseObj.zipball_url === 'string' && releaseObj.zipball_url) ||
      (typeof releaseObj.tarball_url === 'string' && releaseObj.tarball_url) ||
      `https://api.github.com/repos/${input.fullName}/zipball/${encodeURIComponent(tag)}`;
    const releaseUrl =
      typeof releaseObj.html_url === 'string'
        ? releaseObj.html_url
        : `https://github.com/${input.fullName}/releases/tag/${encodeURIComponent(tag)}`;
    const summary =
      typeof releaseObj.name === 'string' && releaseObj.name.trim()
        ? releaseObj.name.trim()
        : typeof releaseObj.body === 'string' && releaseObj.body.trim()
          ? releaseObj.body.trim().slice(0, 240)
          : undefined;
    return { version, downloadUrl, releaseUrl, summary, hacsJson: releaseHacs };
  }

  // Fallback for repositories without GitHub releases: resolve default branch commit
  const targetRef =
    input.requestedVersion && input.requestedVersion !== 'latest' ? input.requestedVersion : branch;
  const commitRes = await fetchGitHubJson(
    input.fetchImpl,
    `https://api.github.com/repos/${input.fullName}/commits/${encodeURIComponent(targetRef)}`,
    input.timeoutMs,
  );
  if (commitRes.status === 403 || commitRes.status === 429) {
    throw new Error('github_rate_limited');
  }
  const commitObj = commitRes.data as Record<string, unknown> | undefined;
  if (commitRes.status === 200 && commitObj && typeof commitObj.sha === 'string') {
    const shortSha = commitObj.sha.slice(0, 7);
    const commitMeta = commitObj.commit as Record<string, unknown> | undefined;
    return {
      version: shortSha,
      downloadUrl: `https://api.github.com/repos/${input.fullName}/zipball/${commitObj.sha}`,
      releaseUrl:
        typeof commitObj.html_url === 'string'
          ? commitObj.html_url
          : `https://github.com/${input.fullName}/commit/${commitObj.sha}`,
      summary:
        typeof commitMeta?.message === 'string' ? commitMeta.message.split('\n')[0] : undefined,
      ...(input.hacsJson ? { hacsJson: input.hacsJson } : {}),
    };
  }
  return null;
}

export async function buildHacsRepositoryCatalog(input: {
  readonly customComponentsDir: string;
  readonly state: PersistedHacsState;
  readonly configuredEntries: ReadonlyArray<{ readonly domain: string; readonly version?: string }>;
  readonly refreshRemote: boolean;
  readonly runtimeHaVersion?: string;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly defaultCatalogItems?: readonly HacsDefaultCatalogItem[];
}): Promise<readonly HacsRepositoryView[]> {
  const installedDisk = await scanInstalledCustomComponents(input.customComponentsDir);
  const configuredByDomain = new Map<string, string>();
  for (const entry of input.configuredEntries) {
    if (entry.domain && !configuredByDomain.has(entry.domain)) {
      configuredByDomain.set(entry.domain, entry.version ?? '0.0.0');
    }
  }

  const byId = new Map<string, HacsRepositoryView>();
  const idByFullName = new Map<string, string>();
  const idByDomain = new Map<string, string>();

  const upsertRepo = async (repoInput: {
    id: string;
    fullName: string;
    domain?: string;
    title: string;
    description: string;
    category: HacsRepositoryCategory;
    defaultBranch?: string;
    custom?: boolean;
    stars?: number;
    downloads?: number;
    topics?: readonly string[];
    availableVersion?: string;
    minHaVersion?: string;
    configFlow?: boolean;
    hacsJson?: Record<string, unknown>;
  }) => {
    const saved = input.state.repositories[repoInput.id];
    const diskInfo = repoInput.domain ? installedDisk.get(repoInput.domain) : undefined;
    const isConfigured = repoInput.domain ? configuredByDomain.has(repoInput.domain) : false;
    const installed = Boolean(diskInfo || isConfigured || saved?.installedVersion);
    const installedVersion =
      diskInfo?.version ??
      saved?.installedVersion ??
      (repoInput.domain ? configuredByDomain.get(repoInput.domain) : undefined);

    let availableVersion =
      saved?.availableVersion ?? repoInput.availableVersion ?? installedVersion;
    let releaseUrl = saved?.releaseUrl ?? `https://github.com/${repoInput.fullName}`;
    let releaseSummary = saved?.releaseSummary;
    let remoteHacsJson: Record<string, unknown> | undefined =
      saved?.hacsJson ??
      repoInput.hacsJson ??
      (repoInput.minHaVersion ? { homeassistant: repoInput.minHaVersion } : undefined);

    if (input.refreshRemote && (installed || saved?.custom)) {
      try {
        const remote = await resolveRemoteRelease({
          fetchImpl: input.fetchImpl,
          timeoutMs: input.timeoutMs,
          fullName: repoInput.fullName,
          domain: repoInput.domain,
          requestedVersion: saved?.selectedTag,
          includeBeta: saved?.beta,
          defaultBranch: saved?.defaultBranch ?? repoInput.defaultBranch,
          hacsJson: remoteHacsJson,
        });
        if (remote) {
          availableVersion = remote.version;
          releaseUrl = remote.releaseUrl;
          releaseSummary = remote.summary;
          if (remote.hacsJson) remoteHacsJson = remote.hacsJson;
          input.state.repositories[repoInput.id] = {
            ...(saved ?? {
              id: repoInput.id,
              fullName: repoInput.fullName,
              domain: repoInput.domain,
              title: repoInput.title,
              category: repoInput.category,
            }),
            installedVersion,
            availableVersion,
            releaseUrl,
            releaseSummary,
          };
        }
      } catch {
        // Offline or rate-limited during passive list; retain cached version
      }
    }

    const compatibility = evaluateHacsCompatibility({
      category: repoInput.category,
      hacsJson: remoteHacsJson,
      manifest: diskInfo?.manifest,
      runtimeHaVersion: input.runtimeHaVersion,
    });
    const pendingRestart = Boolean(diskInfo?.receipt?.pendingRestart || saved?.pendingRestart);
    const pendingUpgrade =
      installed &&
      Boolean(availableVersion) &&
      Boolean(installedVersion) &&
      compareHacsVersions(installedVersion!, availableVersion!) < 0;

    const view: HacsRepositoryView = {
      id: repoInput.id,
      name: saved?.title || repoInput.title,
      full_name: repoInput.fullName,
      description: saved?.description || repoInput.description,
      category: repoInput.category,
      domain: repoInput.domain,
      installed,
      installed_version: installedVersion,
      available_version: availableVersion ?? installedVersion,
      pending_upgrade: pendingUpgrade,
      pending_restart: pendingRestart,
      hide: saved?.hide ?? false,
      custom: saved?.custom ?? repoInput.custom ?? false,
      can_download: repoInput.category === 'integration' && compatibility.status !== 'incompatible',
      config_flow: diskInfo?.configFlow ?? saved?.configFlow ?? repoInput.configFlow ?? true,
      status: pendingRestart ? 'pending-restart' : pendingUpgrade ? 'pending-update' : 'installed',
      state: 'loaded',
      ...(repoInput.stars !== undefined || saved?.stars !== undefined
        ? { stars: saved?.stars ?? repoInput.stars }
        : {}),
      ...(repoInput.downloads !== undefined || saved?.downloads !== undefined
        ? { downloads: saved?.downloads ?? repoInput.downloads }
        : {}),
      ...(repoInput.topics || saved?.topics ? { topics: saved?.topics ?? repoInput.topics } : {}),
      ...(remoteHacsJson ? { hacs_json: remoteHacsJson } : {}),
      beta: saved?.beta ?? false,
      selected_tag: saved?.selectedTag,
      default_branch: saved?.defaultBranch ?? repoInput.defaultBranch ?? 'main',
      hide_default_branch: remoteHacsJson?.hide_default_branch === true,
      compatibility: compatibility.status,
      compatibility_reason: compatibility.reason,
      min_ha_version: compatibility.minHaVersion ?? repoInput.minHaVersion,
      release_url: releaseUrl,
      release_summary:
        compatibility.status === 'incompatible'
          ? compatibility.reason
          : pendingRestart
            ? `Downloaded ${diskInfo?.receipt?.downloadedVersion ?? availableVersion ?? ''}; restart required to activate.`
            : releaseSummary,
    };
    byId.set(repoInput.id, view);
    idByFullName.set(repoInput.fullName.toLowerCase(), repoInput.id);
    if (repoInput.domain) idByDomain.set(repoInput.domain, repoInput.id);
  };

  for (const known of Object.values(KNOWN_HACS_REPOS)) {
    await upsertRepo({
      id: known.id,
      fullName: known.repo,
      domain: known.domain,
      title: known.title,
      description: known.description,
      category: known.category,
      defaultBranch: known.defaultBranch,
    });
  }

  for (const item of input.defaultCatalogItems ?? []) {
    const existingId = byId.has(item.id)
      ? item.id
      : (idByFullName.get(item.fullName.toLowerCase()) ?? idByDomain.get(item.domain));
    if (existingId) {
      const existing = byId.get(existingId);
      if (existing) {
        byId.set(existingId, {
          ...existing,
          stars: existing.stars ?? item.stars,
          downloads: existing.downloads ?? item.downloads,
          topics: existing.topics ?? item.topics,
          available_version: existing.available_version ?? item.version,
        });
      }
      continue;
    }
    await upsertRepo({
      id: item.id,
      fullName: item.fullName,
      domain: item.domain,
      title: item.name,
      description: item.description,
      category: 'integration',
      availableVersion: item.version,
      stars: item.stars,
      downloads: item.downloads,
      topics: item.topics,
      minHaVersion: item.minHaVersion,
    });
  }

  for (const [domain, disk] of installedDisk) {
    if (idByDomain.has(domain)) continue;
    const fullName = disk.repository ?? `custom-components/${domain}`;
    const id = disk.receipt?.repositoryId ?? deriveRepositoryId(fullName);
    await upsertRepo({
      id,
      fullName,
      domain,
      title: disk.name,
      description: `${disk.name} custom integration`,
      category: 'integration',
      custom: true,
    });
  }

  for (const saved of Object.values(input.state.repositories)) {
    if (byId.has(saved.id) || idByFullName.has(saved.fullName.toLowerCase())) continue;
    const domain = saved.domain ?? saved.fullName.split('/')[1]?.toLowerCase().replaceAll('-', '_');
    await upsertRepo({
      id: saved.id,
      fullName: saved.fullName,
      domain,
      title: saved.title ?? saved.fullName.split('/')[1] ?? saved.fullName,
      description: saved.description ?? `Custom ${saved.category} repository (${saved.fullName})`,
      category: saved.category,
      defaultBranch: saved.defaultBranch,
      stars: saved.stars,
      downloads: saved.downloads,
      topics: saved.topics,
      configFlow: saved.configFlow,
      hacsJson: saved.hacsJson,
      custom: saved.custom ?? true,
    });
  }

  return Array.from(byId.values());
}
