/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  REDACTED_SECRET_PLACEHOLDER,
  formatAddonRepositoryError,
  isGoveeAddon,
  mergeCatalogFieldMeta,
  parseAddonRepositories,
  parseAppConfigInfo,
  parseAppLogsPayload,
  parseCatalogInstallPayload,
  type AddonRepositorySummary,
  type AppActionId,
  type InstalledAppRecord,
  type LoadedAppConfigInfo,
  type ManagementPort,
  type NativeConfigFieldMeta,
} from '@haus/core/transport';

export interface AppConfigState {
  readonly values: Record<string, unknown>;
  readonly configuredSecrets: ReadonlySet<string>;
  readonly fieldMeta?: Readonly<Record<string, NativeConfigFieldMeta>>;
}

function asRec(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertHubResponseOk(res: unknown, fallbackMessage: string): void {
  const rec = asRec(res);
  if (rec?.status === 'error') {
    throw new Error(typeof rec.reason === 'string' && rec.reason ? rec.reason : fallbackMessage);
  }
}

export function toAppConfigState(info: LoadedAppConfigInfo): AppConfigState {
  return {
    values: { ...info.config },
    configuredSecrets: new Set(info.configuredSecrets),
    fieldMeta: info.nativeFields,
  };
}

export function applyDemoConfigSave(
  previous: LoadedAppConfigInfo,
  submitted: Record<string, unknown>,
): LoadedAppConfigInfo {
  const secrets = new Set(previous.configuredSecrets);
  const nextConfig: Record<string, unknown> = { ...submitted };
  for (const key of secrets) {
    if (nextConfig[key] === REDACTED_SECRET_PLACEHOLDER || nextConfig[key] === '') {
      nextConfig[key] = REDACTED_SECRET_PLACEHOLDER;
    }
  }
  return {
    ...previous,
    config: nextConfig,
    configuredSecrets: [...secrets],
  };
}

export async function executeHubAppAction(
  management: ManagementPort,
  appId: string,
  action: AppActionId,
): Promise<void> {
  const res = await management.management({
    method: 'POST',
    path: `apps/${encodeURIComponent(appId)}/execute`,
    data: { action },
  });
  assertHubResponseOk(res, `App ${action} failed.`);
}

export async function fetchHubAppLogs(
  management: ManagementPort,
  appId: string,
  tail = 400,
): Promise<string> {
  const payload = await management.management({
    method: 'POST',
    path: `apps/${encodeURIComponent(appId)}/operate`,
    data: { operation: 'logs', options: { tail } },
  });
  return parseAppLogsPayload(payload);
}

export async function installHubCatalogApp(
  management: ManagementPort,
  entryId: string,
): Promise<void> {
  const detail = await management.management({
    method: 'GET',
    path: `apps/catalog/${encodeURIComponent(entryId)}`,
  });
  const install = parseCatalogInstallPayload(detail);
  if (!install) {
    throw new Error('Could not resolve App manifest from the Hub catalog.');
  }
  const res = await management.management({
    method: 'POST',
    path: 'apps/install',
    data: {
      manifest: install.manifest,
      grantedPermissions: [...install.grantedPermissions],
    },
  });
  assertHubResponseOk(res, 'App installation failed.');
}

export async function loadHubAppConfig(
  management: ManagementPort,
  app: InstalledAppRecord,
): Promise<AppConfigState> {
  const infoRes = await management.management({
    method: 'POST',
    path: `apps/${encodeURIComponent(app.id)}/operate`,
    data: { operation: 'info' },
  });
  const info = parseAppConfigInfo(infoRes);
  let fieldMeta = info?.nativeFields;
  if (!isGoveeAddon(app.externalId, info?.image)) {
    try {
      const catalogDetail = await management.management({
        method: 'GET',
        path: `apps/catalog/${encodeURIComponent(app.externalId)}`,
      });
      fieldMeta = mergeCatalogFieldMeta(fieldMeta, catalogDetail);
    } catch {
      /* Catalog metadata is optional; native config remains authoritative. */
    }
  }
  return {
    values: info?.config ?? {},
    configuredSecrets: new Set(info?.configuredSecrets ?? []),
    fieldMeta,
  };
}

export async function saveHubAppConfig(
  management: ManagementPort,
  app: InstalledAppRecord,
  options: Record<string, unknown>,
  restartAfter: boolean,
): Promise<void> {
  const res = await management.management({
    method: 'POST',
    path: `apps/${encodeURIComponent(app.id)}/configure`,
    data: { options, replace: true },
  });
  assertHubResponseOk(res, 'Could not save App configuration.');
  if (restartAfter && app.state === 'running') {
    await executeHubAppAction(management, app.id, 'restart');
  }
}

export async function removeHubApp(management: ManagementPort, appId: string): Promise<void> {
  const res = await management.management({
    method: 'POST',
    path: `apps/${encodeURIComponent(appId)}/remove`,
    data: {},
  });
  assertHubResponseOk(res, 'Could not remove App.');
}

export async function listHubAddonRepositories(
  management: ManagementPort,
): Promise<AddonRepositorySummary[]> {
  const raw = await management.management({ method: 'GET', path: 'apps/repositories' });
  return parseAddonRepositories(raw);
}

export async function addHubAddonRepository(
  management: ManagementPort,
  url: string,
): Promise<void> {
  try {
    const res = await management.management({
      method: 'POST',
      path: 'apps/repositories',
      data: { url: url.trim() },
    });
    assertHubResponseOk(res, 'Could not add custom repository.');
  } catch (err: unknown) {
    throw new Error(formatAddonRepositoryError(err));
  }
}

export async function reloadHubAddonRepositories(
  management: ManagementPort,
  id?: string,
): Promise<void> {
  try {
    const path = id ? `apps/repositories/${id}/reload` : 'apps/repositories/reload';
    const res = await management.management({ method: 'POST', path, data: {} });
    assertHubResponseOk(res, 'Could not reload custom repository.');
  } catch (err: unknown) {
    throw new Error(formatAddonRepositoryError(err));
  }
}

export async function removeHubAddonRepository(
  management: ManagementPort,
  id: string,
): Promise<void> {
  try {
    const res = await management.management({
      method: 'POST',
      path: `apps/repositories/${id}/remove`,
      data: {},
    });
    assertHubResponseOk(res, 'Could not remove custom repository.');
  } catch (err: unknown) {
    throw new Error(formatAddonRepositoryError(err));
  }
}

export function addDemoAddonRepository(
  current: readonly AddonRepositorySummary[],
  rawUrl: string,
): AddonRepositorySummary[] {
  const trimmed = rawUrl.trim();
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#([A-Za-z0-9_./-]+))?\/?$/.exec(
      trimmed,
    );
  if (!match) {
    throw new Error(formatAddonRepositoryError('invalid_addon_repository_url'));
  }
  const [, owner, repoName, branch] = match;
  const normalizedBase = `https://github.com/${owner}/${repoName}`.toLowerCase();
  if (
    current.some((existing) => {
      const existingBase = existing.url
        .split('#')[0]
        ?.replace(/\.git$/i, '')
        .toLowerCase();
      return existingBase === normalizedBase && (existing.branch ?? '') === (branch ?? '');
    })
  ) {
    throw new Error(formatAddonRepositoryError('addon_repository_already_exists'));
  }
  const seed = `${owner}/${repoName}/${branch ?? ''}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  const id = (hash >>> 0).toString(16).padStart(8, '0');
  const next: AddonRepositorySummary = {
    id,
    url: trimmed,
    ...(branch ? { branch } : {}),
    name: `${owner}/${repoName}`,
    maintainer: owner,
    infoUrl: `https://github.com/${owner}/${repoName}`,
    addonIds: [],
    updatedAt: new Date().toISOString(),
  };
  return [...current, next];
}

export function removeDemoAddonRepository(
  current: readonly AddonRepositorySummary[],
  repo: AddonRepositorySummary,
  installedIds: ReadonlySet<string>,
): AddonRepositorySummary[] {
  const activeSlugs = repo.addonIds.filter((id) => installedIds.has(id));
  if (activeSlugs.length > 0) {
    throw new Error(
      formatAddonRepositoryError(`addon_repository_in_use:${activeSlugs.join(', ')}`),
    );
  }
  return current.filter((item) => item.id !== repo.id);
}
