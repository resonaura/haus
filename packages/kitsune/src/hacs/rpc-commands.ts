/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateAndInspectCustomHacsRepo } from './custom-repo.js';
import { fetchGitHubJson, type PersistedHacsState } from './repository-catalog.js';
import {
  KNOWN_HACS_REPOS,
  type HacsReleaseSummary,
  type HacsRepositoryView,
  type HacsUpdateOperation,
} from './update-types.js';

export interface ExecuteHacsRpcInput {
  readonly command: Record<string, unknown>;
  readonly configuredEntries: ReadonlyArray<{ readonly domain: string; readonly version?: string }>;
  readonly state: PersistedHacsState;
  readonly customComponentsDir: string;
  readonly hasPendingTasks: boolean;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly runtimeHaVersion?: string;
  readonly saveState: () => Promise<void>;
  readonly onRemoved?: (domain: string) => Promise<void>;
  readonly onCatalogChanged?: () => Promise<void>;
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
      readonly configuredEntries?: ReadonlyArray<{
        readonly domain: string;
        readonly version?: string;
      }>;
    },
  ) => Promise<HacsUpdateOperation>;
}

export async function executeHacsRpcCommand(input: ExecuteHacsRpcInput): Promise<unknown> {
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
        .map((r): HacsReleaseSummary => ({
          tag: String(r.tag_name),
          name: typeof r.name === 'string' && r.name ? r.name : String(r.tag_name),
          body: typeof r.body === 'string' ? r.body : '',
          prerelease: Boolean(r.prerelease),
          htmlUrl: typeof r.html_url === 'string' ? r.html_url : undefined,
        }));
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
      if (repo.domain) {
        await input.onRemoved?.(repo.domain);
      }
      await input.onCatalogChanged?.();
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
      const existingRepos = await input.listRepositories(configuredEntries, false);
      const existingFullNames = new Set(existingRepos.map((r) => r.full_name.toLowerCase()));
      const inspected = await validateAndInspectCustomHacsRepo({
        rawRepository: String(command.repository ?? ''),
        rawCategory: command.category,
        existingFullNames,
        fetchImpl: input.fetchImpl,
        timeoutMs: Math.max(input.timeoutMs, 10_000),
        runtimeHaVersion: input.runtimeHaVersion,
      });
      state.repositories[inspected.id] = {
        id: inspected.id,
        fullName: inspected.fullName,
        ...(inspected.domain ? { domain: inspected.domain } : {}),
        title: inspected.title,
        description: inspected.description,
        category: inspected.category,
        custom: true,
        defaultBranch: inspected.defaultBranch,
        stars: inspected.stars,
        topics: inspected.topics,
        configFlow: inspected.configFlow,
        ...(inspected.hacsJson ? { hacsJson: inspected.hacsJson as Record<string, unknown> } : {}),
      };
      await input.saveState();
      await input.onCatalogChanged?.();
      return input.resolveTargetRepository(inspected.id, configuredEntries);
    }
    case 'hacs/repositories/remove': {
      const repoId = String(command.repository ?? '');
      const existing = await input
        .resolveTargetRepository(repoId, configuredEntries)
        .catch(() => null);
      if (existing?.installed) {
        throw new Error('hacs_repository_installed_remove_first');
      }
      const targetId = existing?.id ?? repoId;
      delete state.repositories[targetId];
      await input.saveState();
      await input.onCatalogChanged?.();
      return { removed: true, id: targetId };
    }
    case 'hacs/repositories/clear_new':
      return { cleared: true };
    default:
      throw new Error(`unsupported_hacs_command:${type}`);
  }
}
