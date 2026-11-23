/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { nativeApi } from '../../ha/management';
export interface HacsInfo {
  categories: string[];
  version: string;
  stage: string;
  disabled_reason?: string | null;
  has_pending_tasks: boolean;
}
export interface CommunityRepository {
  id: string | number;
  name: string;
  full_name: string;
  description?: string;
  category: string;
  domain?: string;
  installed: boolean;
  installed_version?: string;
  available_version?: string;
  pending_upgrade?: boolean;
  hide?: boolean;
  custom?: boolean;
  can_download?: boolean;
  config_flow?: boolean;
  status?: string;
  state?: string;
  stars?: number;
  downloads?: number;
  additional_info?: string;
  releases?: string[];
  beta?: boolean;
  selected_tag?: string;
  default_branch?: string;
  hide_default_branch?: boolean;
}
export interface CriticalRepository {
  repository: string;
  reason?: string;
  acknowledged?: boolean;
  link?: string;
}
export const hacs = <T>(command: string, fields: Record<string, unknown> = {}) =>
  nativeApi().request<T>({ type: `hacs/${command}`, ...fields });
export function communityRepositoryName(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) && !/^https?:\/\/(?:www\.)?github\.com\//i.test(trimmed)) {
    throw Error('Enter a GitHub repository URL or owner/name.');
  }
  const stripped = trimmed
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/\.git(?:[/?#].*)?$/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const parts = stripped.split('/');
  const name = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : stripped;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(name))
    throw Error('Enter a GitHub repository as https://github.com/owner/name or owner/name.');
  return name;
}

export function formatHacsRepositoryError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  if (raw.includes('hacs_is_addon_repository')) {
    return 'This repository is a Home Assistant Add-on repository (repository.yaml), not a HACS repository. Add it under Apps → Catalog → Repositories instead.';
  }
  if (raw.includes('hacs_repository_exists')) {
    return 'This repository already exists in HACS.';
  }
  if (raw.includes('hacs_repository_archived')) {
    return 'This GitHub repository is archived and cannot be added to HACS.';
  }
  if (raw.includes('hacs_repository_not_found')) {
    return 'Repository was not found on GitHub. Check the URL and ensure it is public.';
  }
  if (raw.includes('hacs_manifest_missing')) {
    return 'No Home Assistant manifest.json found in custom_components/<domain>/ (or root with content_in_root: true).';
  }
  if (raw.includes('hacs_repository_installed_remove_first')) {
    return 'Remove the downloaded integration first before deleting this custom repository.';
  }
  if (raw.includes('github_rate_limited')) {
    return 'GitHub API rate limit reached. Please wait a minute and try again.';
  }
  return raw || 'The community operation failed.';
}
export function filterCommunity(
  repositories: CommunityRepository[],
  query: string,
  scope: string,
  category: string,
) {
  const text = query.trim().toLocaleLowerCase();
  return repositories
    .filter(
      (repo) =>
        (category === 'all' || repo.category === category) &&
        (scope === 'installed'
          ? repo.installed
          : scope === 'updates'
            ? repo.pending_upgrade
            : scope === 'hidden'
              ? repo.hide
              : !repo.hide) &&
        (!text ||
          `${repo.name} ${repo.full_name} ${repo.description ?? ''}`
            .toLocaleLowerCase()
            .includes(text)),
    )
    .sort((a, b) =>
      scope === 'browse'
        ? (b.stars ?? 0) - (a.stars ?? 0) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
}
