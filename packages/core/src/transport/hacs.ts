/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export const DEFAULT_HACS_CATEGORIES = ['integration', 'plugin', 'theme', 'template'] as const;

export type HacsScope = 'installed' | 'updates' | 'browse' | 'hidden' | 'removed';

export interface HacsInfo {
  readonly categories: readonly string[];
  readonly version: string;
  readonly stage: string;
  readonly disabled_reason?: string | null;
  readonly has_pending_tasks: boolean;
}

export interface CommunityRepository {
  readonly id: string | number;
  readonly name: string;
  readonly full_name: string;
  readonly description?: string;
  readonly category: string;
  readonly domain?: string;
  readonly installed: boolean;
  readonly installed_version?: string;
  readonly available_version?: string;
  readonly pending_upgrade?: boolean;
  readonly hide?: boolean;
  readonly custom?: boolean;
  readonly can_download?: boolean;
  readonly config_flow?: boolean;
  readonly status?: string;
  readonly state?: string;
  readonly stars?: number;
  readonly downloads?: number;
  readonly additional_info?: string;
  readonly releases?: readonly string[];
  readonly beta?: boolean;
  readonly selected_tag?: string;
  readonly default_branch?: string;
  readonly hide_default_branch?: boolean;
}

export interface CriticalRepository {
  readonly repository: string;
  readonly reason?: string;
  readonly acknowledged?: boolean;
  readonly link?: string;
}

export interface RemovedRepository {
  readonly repository: string;
  readonly reason?: string;
}

export interface HacsReleaseTag {
  readonly tag: string;
  readonly name: string;
  readonly prerelease?: boolean;
}

export interface HacsReleaseNote {
  readonly tag: string;
  readonly name: string;
  readonly body: string;
}

export interface DemoHacsState {
  readonly info: HacsInfo;
  readonly repositories: readonly CommunityRepository[];
  readonly critical: readonly CriticalRepository[];
  readonly removed: readonly RemovedRepository[];
  readonly releasesById: Readonly<Record<string, readonly HacsReleaseTag[]>>;
  readonly notesById: Readonly<Record<string, readonly HacsReleaseNote[]>>;
}

export function communityRepositoryName(value: string): string {
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(name)) {
    throw Error('Enter a GitHub repository as https://github.com/owner/name or owner/name.');
  }
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
  repositories: readonly CommunityRepository[],
  query: string,
  scope: HacsScope | string,
  category: string,
): CommunityRepository[] {
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

export function buildHacsVersionOptions(
  info: CommunityRepository,
  releases: readonly HacsReleaseTag[],
): string[] {
  return [
    ...new Set(
      [
        info.available_version,
        info.installed_version,
        ...releases.filter((item) => info.beta || !item.prerelease).map((item) => item.tag),
        !info.hide_default_branch && info.default_branch ? info.default_branch : undefined,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function buildDemoHacsState(): DemoHacsState {
  const repositories: CommunityRepository[] = [
    {
      id: 'demo-adaptive-lighting',
      name: 'Adaptive Lighting',
      full_name: 'basnijholt/adaptive-lighting',
      description: 'Circadian color temperature and brightness curves synced automatically.',
      category: 'integration',
      domain: 'adaptive_lighting',
      installed: true,
      installed_version: 'v1.22.0',
      available_version: 'v1.24.1',
      pending_upgrade: true,
      can_download: true,
      config_flow: true,
      stars: 4120,
      default_branch: 'main',
      beta: false,
      additional_info:
        '# Adaptive Lighting\n\nAutomatically adjusts light color temperature throughout the day.\n\n- Configure per-room sleep and take-over schedules\n- See [project notes](https://github.com/basnijholt/adaptive-lighting)\n\n```yaml\nmin_color_temp: 2200\nmax_color_temp: 5500\n```',
    },
    {
      id: 'demo-localtuya',
      name: 'LocalTuya',
      full_name: 'rospogrigio/localtuya',
      description: 'Local LAN control for Tuya Wi-Fi switches, plugs, and dimmers.',
      category: 'integration',
      domain: 'localtuya',
      installed: true,
      installed_version: 'v5.2.1',
      available_version: 'v5.2.1',
      pending_upgrade: false,
      can_download: true,
      config_flow: true,
      stars: 3480,
      default_branch: 'master',
      beta: false,
      additional_info: '# LocalTuya\n\nDirect LAN control without cloud polling.',
    },
    {
      id: 'demo-frigate',
      name: 'Frigate NVR',
      full_name: 'blakeblackshear/frigate-hass-integration',
      description: 'Camera motion events, zones, and snapshot entities for local NVR.',
      category: 'integration',
      domain: 'frigate',
      installed: false,
      available_version: 'v5.4.0',
      can_download: true,
      config_flow: true,
      stars: 2890,
      default_branch: 'master',
      beta: false,
      additional_info:
        '# Frigate Integration\n\nPairs Frigate NVR object detections with Haus automation triggers.',
    },
    {
      id: 'demo-catppuccin-theme',
      name: 'Catppuccin Theme',
      full_name: 'catppuccin/home-assistant',
      description: 'Warm low-contrast palette presets for wall displays and dashboards.',
      category: 'theme',
      installed: false,
      custom: true,
      available_version: 'v2.1.0',
      can_download: true,
      stars: 1640,
      default_branch: 'main',
      beta: false,
      additional_info: '# Catppuccin\n\nIncludes Latte, Frappe, Macchiato, and Mocha palettes.',
    },
  ];

  const info: HacsInfo = {
    categories: [...DEFAULT_HACS_CATEGORIES],
    version: '2.0.5',
    stage: 'running',
    disabled_reason: null,
    has_pending_tasks: false,
  };

  const critical: CriticalRepository[] = [
    {
      repository: 'legacy-community/deprecated-bridge',
      reason: 'Maintainer archived the upstream API; replace with the built-in Matter bridge.',
      acknowledged: false,
    },
  ];

  const removed: RemovedRepository[] = [
    {
      repository: 'retired-author/old-sensor-pack',
      reason: 'Repository removed from the default catalog after archival.',
    },
  ];

  const releasesById: Record<string, readonly HacsReleaseTag[]> = {
    'demo-adaptive-lighting': [
      { tag: 'v1.24.1', name: 'v1.24.1' },
      { tag: 'v1.25.0-beta.1', name: 'v1.25.0-beta.1', prerelease: true },
      { tag: 'v1.22.0', name: 'v1.22.0' },
    ],
    'demo-localtuya': [{ tag: 'v5.2.1', name: 'v5.2.1' }],
    'demo-frigate': [
      { tag: 'v5.4.0', name: 'v5.4.0' },
      { tag: 'v5.5.0-rc.1', name: 'v5.5.0-rc.1', prerelease: true },
    ],
    'demo-catppuccin-theme': [{ tag: 'v2.1.0', name: 'v2.1.0' }],
  };

  const notesById: Record<string, readonly HacsReleaseNote[]> = {
    'demo-adaptive-lighting': [
      {
        tag: 'v1.24.1',
        name: 'Adaptive Lighting v1.24.1',
        body: '- Reduced initial transition jitter on Matter bulbs\n- Improved sleep brightness clamping',
      },
    ],
    'demo-frigate': [
      {
        tag: 'v5.4.0',
        name: 'Frigate v5.4.0',
        body: '- Adds sub-label sensor attributes and lower latency event streams',
      },
    ],
  };

  return { info, repositories, critical, removed, releasesById, notesById };
}
