/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import {
  evaluateHacsCompatibility,
  type HacsCompatibilityStatus,
  type HacsRepositoryCategory,
} from './update-types.js';

export interface HacsManifestConfig {
  readonly name?: string;
  readonly content_in_root?: boolean;
  readonly zip_release?: boolean;
  readonly filename?: string;
  readonly homeassistant?: string;
  readonly hacs?: string;
  readonly hide_default_branch?: boolean;
  readonly render_readme?: boolean;
  readonly country?: readonly string[];
  readonly persistent_directory?: string;
}

export interface InspectedCustomHacsRepo {
  readonly id: string;
  readonly fullName: string;
  readonly domain?: string;
  readonly title: string;
  readonly description: string;
  readonly category: HacsRepositoryCategory;
  readonly defaultBranch: string;
  readonly stars: number;
  readonly topics: readonly string[];
  readonly configFlow: boolean;
  readonly hacsJson?: HacsManifestConfig;
  readonly compatibility: HacsCompatibilityStatus;
  readonly compatibilityReason?: string;
  readonly minHaVersion?: string;
}

const RE_HACS_REPOSITORY =
  /^(?:(?:https?:\/\/(?:www\.)?github\.com\/)|^)?([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*|#.*|\?.*)?$/i;

const VALID_CATEGORIES = new Set<HacsRepositoryCategory>([
  'integration',
  'plugin',
  'theme',
  'template',
  'python_script',
  'appdaemon',
  'netdaemon',
]);

/** Matches official HACS `extract_repository_from_url`, accepting `owner/repo` and GitHub URLs. */
export function extractHacsRepositoryFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed) && !/^https?:\/\/(?:www\.)?github\.com\//i.test(trimmed)) {
    return null;
  }
  const match = RE_HACS_REPOSITORY.exec(trimmed);
  if (!match?.[1]) return null;
  const normalized = match[1].replace(/\.git$/i, '');
  const parts = normalized.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[1] === '.' || parts[1] === '..') {
    return null;
  }
  return normalized;
}

/** Normalizes HACS categories including official `lovelace`/`dashboard` aliases for `plugin`. */
export function normalizeHacsCategory(raw: unknown): HacsRepositoryCategory {
  const lowered = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!lowered || lowered === 'integration') return 'integration';
  if (lowered === 'lovelace' || lowered === 'dashboard' || lowered === 'plugin') return 'plugin';
  if (VALID_CATEGORIES.has(lowered as HacsRepositoryCategory)) {
    return lowered as HacsRepositoryCategory;
  }
  throw new Error(`hacs_invalid_category:${lowered}`);
}

export function parseHacsManifestJson(raw: unknown): HacsManifestConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const country =
    typeof obj.country === 'string' && obj.country.trim()
      ? [obj.country.trim()]
      : Array.isArray(obj.country)
        ? obj.country.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : undefined;
  return {
    ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
    ...(typeof obj.content_in_root === 'boolean' ? { content_in_root: obj.content_in_root } : {}),
    ...(typeof obj.zip_release === 'boolean' ? { zip_release: obj.zip_release } : {}),
    ...(typeof obj.filename === 'string' && obj.filename.trim()
      ? { filename: obj.filename.trim() }
      : {}),
    ...(typeof obj.homeassistant === 'string' && obj.homeassistant.trim()
      ? { homeassistant: obj.homeassistant.trim() }
      : {}),
    ...(typeof obj.hacs === 'string' && obj.hacs.trim() ? { hacs: obj.hacs.trim() } : {}),
    ...(typeof obj.hide_default_branch === 'boolean'
      ? { hide_default_branch: obj.hide_default_branch }
      : {}),
    ...(typeof obj.render_readme === 'boolean' ? { render_readme: obj.render_readme } : {}),
    ...(country && country.length > 0 ? { country } : {}),
    ...(typeof obj.persistent_directory === 'string' && obj.persistent_directory.trim()
      ? { persistent_directory: obj.persistent_directory.trim() }
      : {}),
  };
}

async function fetchJsonChecked<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly data?: T }> {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json, application/json', 'User-Agent': 'Haus-Hub' },
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

async function fetchRawJsonFile(
  fetchImpl: typeof fetch,
  fullName: string,
  ref: string,
  path: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | undefined> {
  const encodedPath = path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const res = await fetchImpl(
    `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(ref)}/${encodedPath}`,
    {
      headers: { Accept: 'application/json, text/plain', 'User-Agent': 'Haus-Hub' },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (res.status === 403 || res.status === 429) {
    throw new Error('github_rate_limited');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function findFirstCustomComponentDir(blobPaths: readonly string[]): string | undefined {
  const dirs = new Set<string>();
  for (const path of blobPaths) {
    if (!path.startsWith('custom_components/')) continue;
    const parts = path.split('/');
    if (parts.length >= 3 && parts[1] && !parts[1].startsWith('.')) {
      dirs.add(parts[1]);
    }
  }
  const sorted = Array.from(dirs).sort();
  // Prefer a directory that actually contains manifest.json
  for (const dir of sorted) {
    if (blobPaths.includes(`custom_components/${dir}/manifest.json`)) {
      return dir;
    }
  }
  return sorted[0];
}

/**
 * Validates and inspects a custom HACS repository on GitHub matching official `hacs/integration` rules:
 * repo existence, non-archived status, Add-on repository detection, `hacs.json`, and category structure
 * (including reading real `custom_components/<domain>/manifest.json` instead of guessing the domain).
 */
export async function validateAndInspectCustomHacsRepo(input: {
  readonly rawRepository: string;
  readonly rawCategory: unknown;
  readonly existingFullNames: ReadonlySet<string>;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly runtimeHaVersion?: string;
}): Promise<InspectedCustomHacsRepo> {
  const extracted = extractHacsRepositoryFromUrl(input.rawRepository);
  if (!extracted) {
    throw new Error('hacs_invalid_repository_url');
  }
  const category = normalizeHacsCategory(input.rawCategory);
  if (input.existingFullNames.has(extracted.toLowerCase())) {
    throw new Error(`hacs_repository_exists:${extracted}`);
  }

  const metaRes = await fetchJsonChecked<{
    readonly id?: number;
    readonly full_name?: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly default_branch?: string;
    readonly archived?: boolean;
    readonly stargazers_count?: number;
    readonly topics?: readonly string[];
  }>(input.fetchImpl, `https://api.github.com/repos/${extracted}`, input.timeoutMs);

  if (metaRes.status === 404 || !metaRes.data) {
    throw new Error(`hacs_repository_not_found:${extracted}`);
  }
  if (metaRes.data.archived === true) {
    throw new Error(`hacs_repository_archived:${extracted}`);
  }

  const canonicalFullName =
    typeof metaRes.data.full_name === 'string' && metaRes.data.full_name
      ? metaRes.data.full_name
      : extracted;
  if (input.existingFullNames.has(canonicalFullName.toLowerCase())) {
    throw new Error(`hacs_repository_exists:${canonicalFullName}`);
  }

  const defaultBranch =
    typeof metaRes.data.default_branch === 'string' && metaRes.data.default_branch
      ? metaRes.data.default_branch
      : 'main';
  const repoId =
    typeof metaRes.data.id === 'number' && Number.isFinite(metaRes.data.id)
      ? String(metaRes.data.id)
      : canonicalFullName;
  const stars =
    typeof metaRes.data.stargazers_count === 'number' &&
    Number.isFinite(metaRes.data.stargazers_count)
      ? metaRes.data.stargazers_count
      : 0;
  const topics = Array.isArray(metaRes.data.topics)
    ? metaRes.data.topics.filter((t): t is string => typeof t === 'string')
    : [];

  const treeRes = await fetchJsonChecked<{
    readonly tree?: ReadonlyArray<{ readonly path?: string; readonly type?: string }>;
  }>(
    input.fetchImpl,
    `https://api.github.com/repos/${canonicalFullName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
    input.timeoutMs,
  );
  const blobPaths =
    treeRes.status === 200 && Array.isArray(treeRes.data?.tree)
      ? treeRes.data.tree
          .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
          .map((entry) => entry.path as string)
      : [];
  const blobSet = new Set(blobPaths);

  const hasAddonRepoYaml =
    blobSet.has('repository.yaml') ||
    blobSet.has('repository.yml') ||
    blobSet.has('repository.json');
  const hasCustomComponents = blobPaths.some((p) => p.startsWith('custom_components/'));
  if (hasAddonRepoYaml && !hasCustomComponents && !blobSet.has('hacs.json')) {
    throw new Error(`hacs_is_addon_repository:${canonicalFullName}`);
  }

  let rawHacsJson: Record<string, unknown> | undefined;
  if (blobSet.has('hacs.json')) {
    rawHacsJson = await fetchRawJsonFile(
      input.fetchImpl,
      canonicalFullName,
      defaultBranch,
      'hacs.json',
      input.timeoutMs,
    );
  }
  const hacsJson = rawHacsJson ? parseHacsManifestJson(rawHacsJson) : undefined;

  let domain: string | undefined;
  let manifestObj: Record<string, unknown> | undefined;
  let configFlow = false;

  if (category === 'integration') {
    const manifestPath = hacsJson?.content_in_root
      ? 'manifest.json'
      : (() => {
          const dir = findFirstCustomComponentDir(blobPaths);
          return dir ? `custom_components/${dir}/manifest.json` : undefined;
        })();

    if (!manifestPath || !blobSet.has(manifestPath)) {
      throw new Error(`hacs_manifest_missing:${canonicalFullName}`);
    }
    manifestObj = await fetchRawJsonFile(
      input.fetchImpl,
      canonicalFullName,
      defaultBranch,
      manifestPath,
      input.timeoutMs,
    );
    if (!manifestObj || typeof manifestObj.domain !== 'string' || !manifestObj.domain.trim()) {
      throw new Error(`hacs_invalid_manifest_json:${canonicalFullName}`);
    }
    domain = manifestObj.domain.trim();
    configFlow = manifestObj.config_flow === true;
  } else if (category === 'plugin') {
    const hasJs =
      Boolean(hacsJson?.filename) ||
      blobPaths.some((p) => p.endsWith('.js') && (!p.includes('/') || p.startsWith('dist/')));
    if (blobPaths.length > 0 && !hasJs && !hacsJson?.zip_release) {
      throw new Error(`hacs_plugin_js_missing:${canonicalFullName}`);
    }
  } else if (category === 'theme') {
    const hasTheme = blobPaths.some(
      (p) => p.startsWith('themes/') && (p.endsWith('.yaml') || p.endsWith('.yml')),
    );
    if (blobPaths.length > 0 && !hasTheme) {
      throw new Error(`hacs_theme_yaml_missing:${canonicalFullName}`);
    }
  } else if (category === 'template') {
    const hasTemplate = blobPaths.some(
      (p) => p.startsWith('custom_templates/') && p.endsWith('.jinja'),
    );
    if (blobPaths.length > 0 && !hasTemplate) {
      throw new Error(`hacs_template_jinja_missing:${canonicalFullName}`);
    }
  }

  const compatibility = evaluateHacsCompatibility({
    category,
    hacsJson: rawHacsJson,
    manifest: manifestObj,
    runtimeHaVersion: input.runtimeHaVersion,
  });

  const manifestName =
    typeof manifestObj?.name === 'string' && manifestObj.name.trim()
      ? manifestObj.name.trim()
      : undefined;
  const repoLeaf = canonicalFullName.split('/')[1] ?? canonicalFullName;
  const title = hacsJson?.name || manifestName || metaRes.data.name || repoLeaf;
  const description =
    typeof metaRes.data.description === 'string' && metaRes.data.description.trim()
      ? metaRes.data.description.trim()
      : `Custom HACS ${category} (${canonicalFullName})`;

  return {
    id: repoId,
    fullName: canonicalFullName,
    ...(domain ? { domain } : {}),
    title,
    description,
    category,
    defaultBranch,
    stars,
    topics,
    configFlow,
    ...(hacsJson ? { hacsJson } : {}),
    compatibility: compatibility.status,
    compatibilityReason: compatibility.reason,
    minHaVersion: compatibility.minHaVersion,
  };
}
