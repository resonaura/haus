/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { CommunityRepository } from '@haus/core/transport';

export function buildDemoCustomRepository(
  repository: string,
  category: string,
): CommunityRepository {
  const slug = repository.split('/')[1] ?? repository;
  return {
    id: `custom-${repository}`,
    name: slug,
    full_name: repository,
    description: `Custom HACS ${category} repository`,
    category,
    domain: category === 'integration' ? slug.replace(/[^a-z0-9_]/gi, '_') : undefined,
    installed: false,
    custom: true,
    can_download: true,
    config_flow: category === 'integration',
    available_version: 'v1.0.0',
    default_branch: 'main',
    additional_info: `# ${slug}\n\nAdded from ${repository}.`,
  };
}

export function applyDemoDownload(
  repositories: readonly CommunityRepository[],
  id: string,
  version: string,
): CommunityRepository[] {
  return repositories.map((item) =>
    String(item.id) === id
      ? {
          ...item,
          installed: true,
          pending_upgrade: false,
          installed_version: version,
          selected_tag: version,
        }
      : item,
  );
}

export function applyDemoRemoveDownload(
  repositories: readonly CommunityRepository[],
  id: string,
): CommunityRepository[] {
  return repositories.map((item) =>
    String(item.id) === id
      ? {
          ...item,
          installed: false,
          installed_version: undefined,
          pending_upgrade: false,
        }
      : item,
  );
}
