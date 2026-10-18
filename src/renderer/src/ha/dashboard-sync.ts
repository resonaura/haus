export const HAUS_DASHBOARD_PATH = 'haus-home';

export interface DashboardRequest {
  <T = unknown>(message: Record<string, unknown>): Promise<T>;
}

export interface ManagedDashboard {
  urlPath?: string;
  lastGenerated?: Record<string, unknown>;
}

export type DashboardSyncResult =
  { kind: 'created' | 'updated' } | { kind: 'conflict'; current: Record<string, unknown> };

export class DashboardConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardConflictError';
  }
}

export class DashboardSaveError extends Error {
  constructor(
    readonly createdUrlPath: string,
    cause: unknown,
  ) {
    super(
      `The Haus dashboard was created at “/${createdUrlPath}”, but its configuration could not be saved. ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'DashboardSaveError';
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortKeys(item)]),
  );
}

/** A JSON-safe, deterministic copy of the same Lovelace data that HA stores. */
export function canonicalDashboardConfig(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(sortKeys(value))) as Record<string, unknown>;
}

const canonical = (value: Record<string, unknown>) =>
  JSON.stringify(canonicalDashboardConfig(value));

function validPath(value: string): boolean {
  return (
    /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value) && !['overview', 'default', 'lovelace'].includes(value)
  );
}

/** Create a separate storage dashboard, and update it only while the last Haus version is intact. */
export async function syncDashboard(
  request: DashboardRequest,
  desiredConfig: Record<string, unknown>,
  managed?: ManagedDashboard,
): Promise<DashboardSyncResult> {
  const urlPath = managed?.urlPath ?? HAUS_DASHBOARD_PATH;
  if (!validPath(urlPath)) {
    throw new DashboardConflictError(
      'Haus needs a safe URL for its separate dashboard. Choose a lowercase name with a hyphen.',
    );
  }

  const dashboards = await request<unknown>({ type: 'lovelace/dashboards/list' });
  if (!Array.isArray(dashboards))
    throw new Error('Home Assistant returned an unsupported dashboard list.');
  const existing = dashboards.find(
    (item): item is { url_path: string; mode?: string } =>
      !!item && typeof item === 'object' && (item as { url_path?: unknown }).url_path === urlPath,
  );
  const config = canonicalDashboardConfig(desiredConfig);

  if (!existing) {
    await request({
      type: 'lovelace/dashboards/create',
      title: 'Haus',
      icon: 'mdi:home-heart',
      url_path: urlPath,
      mode: 'storage',
      show_in_sidebar: true,
      require_admin: false,
    });
    try {
      await request({ type: 'lovelace/config/save', url_path: urlPath, config });
    } catch (error) {
      throw new DashboardSaveError(urlPath, error);
    }
    return { kind: 'created' };
  }

  let current: Record<string, unknown>;
  try {
    current = await request<Record<string, unknown>>({
      type: 'lovelace/config',
      url_path: urlPath,
      force: true,
    });
  } catch (error) {
    throw new Error(
      `Haus could not read the existing dashboard. It was left untouched. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    existing.mode !== 'storage' ||
    !managed ||
    (managed.urlPath !== undefined && managed.urlPath !== urlPath) ||
    !managed.lastGenerated ||
    canonical(current) !== canonical(managed.lastGenerated)
  ) {
    return { kind: 'conflict', current };
  }

  await request({ type: 'lovelace/config/save', url_path: urlPath, config });
  return { kind: 'updated' };
}
