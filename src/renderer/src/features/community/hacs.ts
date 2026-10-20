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
  const name = value
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(name))
    throw Error('Enter a GitHub repository as owner/name.');
  return name;
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
