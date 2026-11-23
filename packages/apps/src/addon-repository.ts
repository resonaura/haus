/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import type { AppCatalogEntry } from './catalog.js';
import { convertHaAddonConfigToCatalogEntry } from './addon-config-converter.js';
import { parseHaConfigDocument } from './addon-yaml.js';

export interface ParsedAddonRepositoryUrl {
  readonly id: string;
  readonly sourceUrl: string;
  readonly gitUrl: string;
  readonly owner: string;
  readonly repo: string;
  readonly branch?: string;
}

export interface AddonRepositoryMetadata {
  readonly id: string;
  readonly url: string;
  readonly branch?: string;
  readonly name: string;
  readonly maintainer?: string;
  readonly infoUrl?: string;
  readonly commitSha: string;
  readonly addonIds: readonly string[];
  readonly updatedAt: string;
}

export interface ScannedAddonRepository {
  readonly repository: AddonRepositoryMetadata;
  readonly entries: readonly AppCatalogEntry[];
}

const RE_REPOSITORY = /^([^#\s]+)(?:#([\w\-./]+))?$/;
const RE_GITHUB_HTTPS =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;
const RE_CONFIG_FILE = /(?:^|\/)config\.(?:yaml|yml|json)$/i;
const RE_REPO_META_FILE = /^repository\.(?:yaml|yml|json)$/i;
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_ADDONS_PER_REPO = 64;

/** Generates the exact 8-character SHA-1 repository slug used by Home Assistant Supervisor. */
export function getAddonRepositoryHash(sourceUrl: string): string {
  return createHash('sha1').update(sourceUrl.trim().toLowerCase()).digest('hex').slice(0, 8);
}

/** Validates and parses a Home Assistant Supervisor add-on repository URL with optional `#branch`. */
export function parseAddonRepositoryUrl(rawInput: string): ParsedAddonRepositoryUrl {
  const trimmed = rawInput.trim();
  const match = RE_REPOSITORY.exec(trimmed);
  if (!match?.[1]) {
    throw new Error('invalid_addon_repository_url');
  }
  const rawBaseUrl = match[1].trim();
  const branch = match[2]?.trim() || undefined;
  const ghMatch = RE_GITHUB_HTTPS.exec(rawBaseUrl);
  if (!ghMatch?.[1] || !ghMatch?.[2]) {
    throw new Error('unsupported_addon_repository_host');
  }
  const owner = ghMatch[1];
  const repo = ghMatch[2];
  const gitUrl = `https://github.com/${owner}/${repo}`;
  const sourceUrl = branch ? `${gitUrl}#${branch}` : gitUrl;
  return {
    id: getAddonRepositoryHash(sourceUrl),
    sourceUrl,
    gitUrl,
    owner,
    repo,
    ...(branch ? { branch } : {}),
  };
}

/** Validates root `repository.yaml` or `repository.json` matching HA Supervisor `SCHEMA_REPOSITORY_CONFIG`. */
export function parseAddonRepositoryConfig(
  rawText: string,
  fileName = 'repository.yaml',
): { readonly name: string; readonly url?: string; readonly maintainer?: string } {
  const doc = parseHaConfigDocument(rawText, fileName);
  const name = typeof doc.name === 'string' ? doc.name.trim() : '';
  if (!name) {
    throw new Error('invalid_repository_config_missing_name');
  }
  const url =
    typeof doc.url === 'string' && /^https?:\/\//i.test(doc.url.trim())
      ? doc.url.trim()
      : undefined;
  const maintainer =
    typeof doc.maintainer === 'string' && doc.maintainer.trim() ? doc.maintainer.trim() : undefined;
  return {
    name,
    ...(url ? { url } : {}),
    ...(maintainer ? { maintainer } : {}),
  };
}

async function fetchGitHubJson<T>(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly data?: T }> {
  const res = await fetchFn(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Haus-Hub' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error('github_rate_limited');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status };
  }
  return { status: 200, data: (await res.json()) as T };
}

async function fetchRawFile(
  fetchFn: typeof fetch,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const encodedPath = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodedPath}`;
  const res = await fetchFn(url, {
    headers: { Accept: 'text/plain, application/json', 'User-Agent': 'Haus-Hub' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error('github_rate_limited');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
    return undefined;
  }
  return text;
}

function isSkippedAddonPath(filePath: string): boolean {
  const segments = filePath.split('/');
  return segments.some((seg) => seg.startsWith('.') || seg === 'rootfs' || seg === 'node_modules');
}

/**
 * Fetches, validates, and scans a Home Assistant Supervisor add-on GitHub repository
 * (`repository.yaml`/`json` + subdirectory add-on `config.yaml`/`json`).
 */
export async function fetchAndScanAddonRepository(
  rawUrl: string,
  options: {
    readonly fetchFn?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
): Promise<ScannedAddonRepository> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const parsed = parseAddonRepositoryUrl(rawUrl);

  const repoMetaRes = await fetchGitHubJson<{
    readonly default_branch?: string;
    readonly archived?: boolean;
  }>(fetchFn, `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, timeoutMs);
  if (repoMetaRes.status === 404 || !repoMetaRes.data) {
    throw new Error(`addon_repository_not_found:${parsed.owner}/${parsed.repo}`);
  }
  const targetRef =
    parsed.branch ||
    (typeof repoMetaRes.data.default_branch === 'string' && repoMetaRes.data.default_branch) ||
    'main';

  const treeRes = await fetchGitHubJson<{
    readonly sha?: string;
    readonly tree?: ReadonlyArray<{ readonly path?: string; readonly type?: string }>;
  }>(
    fetchFn,
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(targetRef)}?recursive=1`,
    timeoutMs,
  );
  if (treeRes.status !== 200 || !treeRes.data || !Array.isArray(treeRes.data.tree)) {
    throw new Error(`addon_repository_branch_not_found:${targetRef}`);
  }

  const commitSha =
    typeof treeRes.data.sha === 'string' && /^[a-f0-9]{40}$/i.test(treeRes.data.sha)
      ? treeRes.data.sha
      : '';
  const blobPaths = treeRes.data.tree
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path as string);
  const blobSet = new Set(blobPaths);

  const repoMetaFile = blobPaths.find((p) => RE_REPO_META_FILE.test(p));
  if (!repoMetaFile) {
    const looksLikeHacs =
      blobSet.has('hacs.json') || blobPaths.some((p) => p.startsWith('custom_components/'));
    if (looksLikeHacs) {
      throw new Error('addon_repository_is_hacs_repo');
    }
    throw new Error('invalid_addon_repository_missing_repository_yaml');
  }

  const repoMetaRaw = await fetchRawFile(
    fetchFn,
    parsed.owner,
    parsed.repo,
    targetRef,
    repoMetaFile,
    timeoutMs,
  );
  if (!repoMetaRaw) {
    throw new Error('invalid_addon_repository_unreadable_metadata');
  }
  const repoConfig = parseAddonRepositoryConfig(repoMetaRaw, repoMetaFile);

  const configPaths = blobPaths
    .filter((p) => RE_CONFIG_FILE.test(p) && !isSkippedAddonPath(p))
    .slice(0, MAX_ADDONS_PER_REPO);

  const entries: AppCatalogEntry[] = [];
  const seenIds = new Set<string>();

  for (const configPath of configPaths) {
    const rawConfig = await fetchRawFile(
      fetchFn,
      parsed.owner,
      parsed.repo,
      targetRef,
      configPath,
      timeoutMs,
    );
    if (!rawConfig) continue;
    let parsedDoc: Record<string, unknown>;
    try {
      parsedDoc = parseHaConfigDocument(rawConfig, configPath);
    } catch {
      continue;
    }
    const dir = configPath.includes('/') ? configPath.slice(0, configPath.lastIndexOf('/')) : '';
    const dockerfilePath = dir ? `${dir}/Dockerfile` : 'Dockerfile';
    const hasDockerfile = blobSet.has(dockerfilePath);

    const entry = convertHaAddonConfigToCatalogEntry({
      repositoryId: parsed.id,
      repositoryName: repoConfig.name,
      repositoryUrl: parsed.gitUrl,
      repositoryMaintainer: repoConfig.maintainer,
      commitSha,
      addonConfigPath: configPath,
      hasDockerfile,
      config: parsedDoc,
    });
    if (!entry || seenIds.has(entry.manifest.id)) continue;
    seenIds.add(entry.manifest.id);
    entries.push(entry);
  }

  return {
    repository: {
      id: parsed.id,
      url: parsed.sourceUrl,
      branch: targetRef,
      name: repoConfig.name,
      ...(repoConfig.maintainer ? { maintainer: repoConfig.maintainer } : {}),
      ...(repoConfig.url ? { infoUrl: repoConfig.url } : {}),
      commitSha,
      addonIds: entries.map((e) => e.manifest.id),
      updatedAt: new Date().toISOString(),
    },
    entries,
  };
}
