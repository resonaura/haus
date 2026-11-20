/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scanInstalledCustomComponents } from './archive-stage.js';
import {
  compareHacsVersions,
  deriveRepositoryId,
  evaluateHacsCompatibility,
  KNOWN_HACS_REPOS,
  normalizeHacsVersion,
  type HacsReleaseSummary,
  type HacsRepositoryCategory,
  type HacsRepositoryView,
  type HacsUpdateOperation,
} from './update-types.js';

export interface PersistedRepoSettings {
  readonly id: string;
  readonly fullName: string;
  readonly domain?: string;
  readonly title?: string;
  readonly category: HacsRepositoryCategory;
  readonly custom?: boolean;
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
    const matchingAsset =
      assets.find(
        (a) =>
          typeof a.browser_download_url === 'string' &&
          typeof a.name === 'string' &&
          (a.name === `${input.domain}.zip` ||
            a.name.endsWith('.zip') ||
            a.name.endsWith('.tar.gz')),
      ) ?? assets[0];
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
    const hacsJson =
      releaseObj.hacs && typeof releaseObj.hacs === 'object' && !Array.isArray(releaseObj.hacs)
        ? (releaseObj.hacs as Record<string, unknown>)
        : undefined;
    return { version, downloadUrl, releaseUrl, summary, hacsJson };
  }

  // Fallback for repositories without GitHub releases: resolve default branch commit
  const targetRef =
    input.requestedVersion && input.requestedVersion !== 'latest'
      ? input.requestedVersion
      : branch;
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
}): Promise<readonly HacsRepositoryView[]> {
  const installedDisk = await scanInstalledCustomComponents(input.customComponentsDir);
  const configuredByDomain = new Map<string, string>();
  for (const entry of input.configuredEntries) {
    if (entry.domain && !configuredByDomain.has(entry.domain)) {
      configuredByDomain.set(entry.domain, entry.version ?? '0.0.0');
    }
  }

  const byId = new Map<string, HacsRepositoryView>();
  const upsertRepo = async (repoInput: {
    id: string;
    fullName: string;
    domain?: string;
    title: string;
    description: string;
    category: HacsRepositoryCategory;
    defaultBranch?: string;
    custom?: boolean;
  }) => {
    const saved = input.state.repositories[repoInput.id];
    const diskInfo = repoInput.domain ? installedDisk.get(repoInput.domain) : undefined;
    const isConfigured = repoInput.domain ? configuredByDomain.has(repoInput.domain) : false;
    const installed = Boolean(diskInfo || isConfigured || saved?.installedVersion);
    const installedVersion =
      diskInfo?.version ??
      saved?.installedVersion ??
      (repoInput.domain ? configuredByDomain.get(repoInput.domain) : undefined);

    let availableVersion = saved?.availableVersion ?? installedVersion;
    let releaseUrl = saved?.releaseUrl ?? `https://github.com/${repoInput.fullName}`;
    let releaseSummary = saved?.releaseSummary;
    let remoteHacsJson: Record<string, unknown> | undefined;

    if (input.refreshRemote && (installed || saved?.custom)) {
      try {
        const remote = await resolveRemoteRelease({
          fetchImpl: input.fetchImpl,
          timeoutMs: input.timeoutMs,
          fullName: repoInput.fullName,
          domain: repoInput.domain,
          requestedVersion: saved?.selectedTag,
          includeBeta: saved?.beta,
          defaultBranch: repoInput.defaultBranch,
        });
        if (remote) {
          availableVersion = remote.version;
          releaseUrl = remote.releaseUrl;
          releaseSummary = remote.summary;
          remoteHacsJson = remote.hacsJson;
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
    const pendingRestart = Boolean(
      diskInfo?.receipt?.pendingRestart || saved?.pendingRestart,
    );
    const pendingUpgrade =
      installed &&
      Boolean(availableVersion) &&
      Boolean(installedVersion) &&
      compareHacsVersions(installedVersion!, availableVersion!) < 0;

    byId.set(repoInput.id, {
      id: repoInput.id,
      name: repoInput.title,
      full_name: repoInput.fullName,
      description: repoInput.description,
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
      config_flow: diskInfo?.configFlow ?? true,
      status: pendingRestart ? 'pending-restart' : pendingUpgrade ? 'pending-update' : 'installed',
      state: 'loaded',
      beta: saved?.beta ?? false,
      selected_tag: saved?.selectedTag,
      default_branch: repoInput.defaultBranch ?? 'main',
      compatibility: compatibility.status,
      compatibility_reason: compatibility.reason,
      min_ha_version: compatibility.minHaVersion,
      release_url: releaseUrl,
      release_summary:
        compatibility.status === 'incompatible'
          ? compatibility.reason
          : pendingRestart
            ? `Downloaded ${diskInfo?.receipt?.downloadedVersion ?? availableVersion ?? ''}; restart required to activate.`
            : releaseSummary,
    });
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

  for (const [domain, disk] of installedDisk) {
    if (KNOWN_HACS_REPOS[domain]) continue;
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
    if (byId.has(saved.id)) continue;
    const domain =
      saved.domain ?? saved.fullName.split('/')[1]?.toLowerCase().replaceAll('-', '_');
    await upsertRepo({
      id: saved.id,
      fullName: saved.fullName,
      domain,
      title: saved.title ?? saved.fullName.split('/')[1] ?? saved.fullName,
      description: `Custom ${saved.category} repository (${saved.fullName})`,
      category: saved.category,
      custom: saved.custom ?? true,
    });
  }

  return Array.from(byId.values());
}

export async function executeHacsRpcCommand(input: {
  readonly command: Record<string, unknown>;
  readonly configuredEntries: ReadonlyArray<{ readonly domain: string; readonly version?: string }>;
  readonly state: PersistedHacsState;
  readonly customComponentsDir: string;
  readonly hasPendingTasks: boolean;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly saveState: () => Promise<void>;
  readonly listRepositories: (
    entries: ReadonlyArray<{ readonly domain: string; readonly version?: string }>,
    refresh: boolean,
  ) => Promise<readonly HacsRepositoryView[]>;
  readonly resolveTargetRepository: (
    id: string,
    entries: ReadonlyArray<{ readonly domain: string; readonly version?: string }>,
  ) => Promise<HacsRepositoryView>;
  readonly installUpdate: (
    id: string,
    opts: {
      readonly version?: string;
      readonly configuredEntries?: ReadonlyArray<{ readonly domain: string; readonly version?: string }>;
    },
  ) => Promise<HacsUpdateOperation>;
}): Promise<unknown> {
  const { command, configuredEntries, state } = input;
  const type = String(command.type ?? '');

  switch (type) {
    case 'hacs/info': {
      const hacsRepo = KNOWN_HACS_REPOS.hacs!;
      const saved = state.repositories[hacsRepo.id];
      return {
        categories: ['integration', 'plugin', 'theme', 'template'],
        version: saved?.installedVersion ?? '2.0.5',
        stage: 'running',
        disabled_reason: null,
        has_pending_tasks: input.hasPendingTasks,
      };
    }
    case 'hacs/repositories/list':
      return input.listRepositories(configuredEntries, false);
    case 'hacs/repositories/removed':
      return state.removed;
    case 'hacs/critical/list':
      return [];
    case 'hacs/critical/acknowledge': {
      const repository = String(command.repository ?? '');
      if (repository && !state.acknowledgedCritical.includes(repository)) {
        state.acknowledgedCritical.push(repository);
        await input.saveState();
      }
      return { acknowledged: true, repository };
    }
    case 'hacs/repository/info': {
      const repoId = String(command.repository_id ?? command.repository ?? '');
      return input.resolveTargetRepository(repoId, configuredEntries);
    }
    case 'hacs/repository/releases': {
      const repoId = String(command.repository_id ?? command.repository ?? '');
      const repo = await input.resolveTargetRepository(repoId, configuredEntries);
      const res = await fetchGitHubJson(
        input.fetchImpl,
        `https://api.github.com/repos/${repo.full_name}/releases`,
        input.timeoutMs,
      );
      if (!Array.isArray(res.data)) return [];
      return (res.data as Array<Record<string, unknown>>)
        .filter((r) => typeof r.tag_name === 'string')
        .map(
          (r): HacsReleaseSummary => ({
            tag: String(r.tag_name),
            name: typeof r.name === 'string' && r.name ? r.name : String(r.tag_name),
            body: typeof r.body === 'string' ? r.body : '',
            prerelease: Boolean(r.prerelease),
            htmlUrl: typeof r.html_url === 'string' ? r.html_url : undefined,
          }),
        );
    }
    case 'hacs/repository/release_notes': {
      const repoId = String(command.repository ?? command.repository_id ?? '');
      const releases = (await executeHacsRpcCommand({
        ...input,
        command: { type: 'hacs/repository/releases', repository_id: repoId },
      })) as HacsReleaseSummary[];
      return releases.map((r) => ({ tag: r.tag, name: r.name, body: r.body }));
    }
    case 'hacs/repository/refresh': {
      const repoId = String(command.repository ?? '');
      const all = await input.listRepositories(configuredEntries, true);
      return all.find((r) => r.id === repoId || r.domain === repoId) ?? { refreshed: true };
    }
    case 'hacs/repository/download': {
      const repoId = String(command.repository ?? '');
      const version = typeof command.version === 'string' ? command.version : undefined;
      return input.installUpdate(repoId, { version, configuredEntries });
    }
    case 'hacs/repository/remove': {
      const repoId = String(command.repository ?? '');
      const repo = await input.resolveTargetRepository(repoId, configuredEntries);
      if (repo.domain) {
        await rm(join(input.customComponentsDir, repo.domain), { recursive: true, force: true });
      }
      if (state.repositories[repo.id]) {
        state.repositories[repo.id] = {
          ...state.repositories[repo.id]!,
          installedVersion: undefined,
          downloadedVersion: undefined,
          pendingRestart: false,
        };
        await input.saveState();
      }
      return { removed: true, id: repo.id };
    }
    case 'hacs/repository/beta':
    case 'hacs/repository/version':
    case 'hacs/repository/ignore': {
      const repoId = String(command.repository ?? '');
      const repo = await input.resolveTargetRepository(repoId, configuredEntries);
      const prev = state.repositories[repo.id] ?? {
        id: repo.id,
        fullName: repo.full_name,
        domain: repo.domain,
        title: repo.name,
        category: repo.category,
      };
      state.repositories[repo.id] = {
        ...prev,
        ...(type === 'hacs/repository/beta' ? { beta: Boolean(command.show_beta) } : {}),
        ...(type === 'hacs/repository/version'
          ? { selectedTag: typeof command.version === 'string' ? command.version : undefined }
          : {}),
        ...(type === 'hacs/repository/ignore' ? { hide: true } : {}),
      };
      await input.saveState();
      return { id: repo.id, ok: true };
    }
    case 'hacs/repositories/add': {
      const fullName = String(command.repository ?? '').trim();
      const category = (command.category as HacsRepositoryCategory | undefined) ?? 'integration';
      const id = deriveRepositoryId(fullName);
      const slug = fullName.split('/')[1] ?? fullName;
      const domain = slug
        .toLowerCase()
        .replace(/^hass-|^home-assistant-|-custom-component$/g, '')
        .replaceAll('-', '_');
      state.repositories[id] = { id, fullName, domain, title: slug, category, custom: true };
      await input.saveState();
      return input.resolveTargetRepository(id, configuredEntries);
    }
    case 'hacs/repositories/remove': {
      const repoId = String(command.repository ?? '');
      delete state.repositories[repoId];
      await input.saveState();
      return { removed: true, id: repoId };
    }
    case 'hacs/repositories/clear_new':
      return { cleared: true };
    default:
      throw new Error(`unsupported_hacs_command:${type}`);
  }
}
