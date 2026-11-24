/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type AppActionId = 'start' | 'stop' | 'restart';

export type AppLifecycleState = 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';

export interface InstalledAppRecord {
  readonly id: string;
  readonly externalId: string;
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly latestVersion?: string;
  readonly state: AppLifecycleState;
  readonly available: boolean;
  readonly managed: boolean;
  readonly actions: readonly AppActionId[];
  readonly logs: boolean;
  readonly updateAvailable: boolean;
  readonly sourceKind: 'haus-app' | 'supervisor-addon';
  readonly accessories?: {
    readonly mqtt?: boolean;
    readonly camera?: boolean;
  };
}

export interface CatalogAppRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly category: string;
  readonly runtimeType: string;
  readonly installed: boolean;
  readonly state?: string;
  readonly currentVersion?: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly verified?: boolean;
}

export type AppsTabId = 'installed' | 'catalog';

export type AppsFilterId = 'all' | 'running' | 'stopped' | 'updates';

export interface DemoAppsState {
  readonly installed: readonly InstalledAppRecord[];
  readonly catalog: readonly CatalogAppRecord[];
  readonly logsById: Readonly<Record<string, string>>;
}

const VALID_ACTIONS: readonly AppActionId[] = ['start', 'stop', 'restart'];
const VALID_STATES: readonly AppLifecycleState[] = [
  'running',
  'stopped',
  'starting',
  'stopping',
  'unknown',
];

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppAction(value: unknown): value is AppActionId {
  return typeof value === 'string' && VALID_ACTIONS.some((item) => item === value);
}

function isLifecycleState(value: unknown): value is AppLifecycleState {
  return typeof value === 'string' && VALID_STATES.some((item) => item === value);
}

export function formatAppCapabilityLabel(app: InstalledAppRecord): string {
  if (app.accessories?.mqtt) return 'Accessories connect automatically';
  if (app.accessories?.camera) return 'Camera accessories';
  if (app.description) return app.description;
  return 'Home App';
}

export function parseInstalledAppsPayload(value: unknown): InstalledAppRecord[] {
  if (!isRec(value) || !Array.isArray(value.apps) || !Array.isArray(value.drivers)) {
    throw new Error('The Hub returned an invalid App inventory.');
  }
  const logDrivers = new Set<string>();
  for (const driver of value.drivers) {
    if (
      isRec(driver) &&
      typeof driver.id === 'string' &&
      isRec(driver.capabilities) &&
      driver.capabilities.logs === true
    ) {
      logDrivers.add(driver.id);
    }
  }
  return value.apps.map((item): InstalledAppRecord => {
    if (
      !isRec(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      !isLifecycleState(item.state) ||
      typeof item.available !== 'boolean' ||
      typeof item.managed !== 'boolean' ||
      !Array.isArray(item.actions) ||
      !item.actions.every(isAppAction)
    ) {
      throw new Error('The Hub returned an invalid App entry.');
    }
    const source = isRec(item.source) ? item.source : undefined;
    const externalId =
      source && typeof source.externalId === 'string' && source.externalId.length > 0
        ? source.externalId
        : item.id;
    const updateAvailable = item.update_available === true || item.updateAvailable === true;
    const version = typeof item.version === 'string' ? item.version : undefined;
    const latestVersion =
      typeof item.latestVersion === 'string'
        ? item.latestVersion
        : typeof item.version_latest === 'string'
          ? item.version_latest
          : undefined;
    return {
      id: item.id,
      externalId,
      name: item.name,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(version ? { version } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      state: item.state,
      available: item.available,
      managed: item.managed,
      actions: item.actions,
      logs: Boolean(source && typeof source.instanceId === 'string' && logDrivers.has(source.instanceId)),
      updateAvailable,
      sourceKind: 'haus-app',
      ...(isRec(item.accessories)
        ? {
            accessories: {
              mqtt: item.accessories.mqtt === true,
              camera: item.accessories.camera === true,
            },
          }
        : {}),
    };
  });
}

export function parseCatalogAppsPayload(value: unknown): CatalogAppRecord[] {
  const raw = isRec(value) && Array.isArray(value.apps) ? value.apps : Array.isArray(value) ? value : [];
  const items: CatalogAppRecord[] = [];
  for (const entry of raw) {
    if (!isRec(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
    items.push({
      id: entry.id,
      name: entry.name,
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      category: typeof entry.category === 'string' ? entry.category : 'app',
      runtimeType: typeof entry.runtimeType === 'string' ? entry.runtimeType : 'docker_app',
      installed: entry.installed === true,
      ...(typeof entry.state === 'string' ? { state: entry.state } : {}),
      ...(typeof entry.currentVersion === 'string' ? { currentVersion: entry.currentVersion } : {}),
      latestVersion: typeof entry.latestVersion === 'string' ? entry.latestVersion : 'latest',
      updateAvailable: entry.updateAvailable === true,
      verified: entry.verified === true,
    });
  }
  return items;
}

export function parseSupervisorAddonsPayload(
  addonsPayload: unknown,
  storePayload?: unknown,
): { readonly installed: InstalledAppRecord[]; readonly catalog: CatalogAppRecord[] } {
  const rawAddons = isRec(addonsPayload) && Array.isArray(addonsPayload.addons) ? addonsPayload.addons : [];
  const installed: InstalledAppRecord[] = [];
  const installedSlugs = new Set<string>();
  for (const addon of rawAddons) {
    if (!isRec(addon) || typeof addon.slug !== 'string' || typeof addon.name !== 'string') continue;
    installedSlugs.add(addon.slug);
    const state: AppLifecycleState =
      addon.state === 'started'
        ? 'running'
        : addon.state === 'stopped'
          ? 'stopped'
          : 'unknown';
    installed.push({
      id: addon.slug,
      externalId: addon.slug,
      name: addon.name,
      ...(typeof addon.description === 'string' ? { description: addon.description } : {}),
      ...(typeof addon.version === 'string' ? { version: addon.version } : {}),
      ...(typeof addon.version_latest === 'string' ? { latestVersion: addon.version_latest } : {}),
      state,
      available: addon.available !== false,
      managed: addon.system_managed !== true,
      actions: state === 'running' ? ['stop', 'restart'] : ['start'],
      logs: true,
      updateAvailable: addon.update_available === true,
      sourceKind: 'supervisor-addon',
    });
  }
  const rawStore =
    isRec(storePayload) && Array.isArray(storePayload.addons) ? storePayload.addons : [];
  const catalog: CatalogAppRecord[] = [];
  for (const item of rawStore) {
    if (!isRec(item) || typeof item.slug !== 'string' || typeof item.name !== 'string') continue;
    catalog.push({
      id: item.slug,
      name: item.name,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      category: 'addon',
      runtimeType: 'addon',
      installed: installedSlugs.has(item.slug) || item.installed === true,
      ...(typeof item.version === 'string' ? { currentVersion: item.version } : {}),
      latestVersion:
        typeof item.version_latest === 'string'
          ? item.version_latest
          : typeof item.version === 'string'
            ? item.version
            : 'latest',
      updateAvailable: item.update_available === true,
    });
  }
  return { installed, catalog };
}

export function countAppFilters(apps: readonly InstalledAppRecord[]): Record<AppsFilterId, number> {
  let running = 0;
  let stopped = 0;
  let updates = 0;
  for (const app of apps) {
    if (app.state === 'running') running += 1;
    else if (app.state === 'stopped') stopped += 1;
    if (app.updateAvailable) updates += 1;
  }
  return { all: apps.length, running, stopped, updates };
}

export function filterInstalledApps(
  apps: readonly InstalledAppRecord[],
  filter: AppsFilterId,
  query: string,
): InstalledAppRecord[] {
  const needle = query.trim().toLowerCase();
  return apps.filter((app) => {
    if (filter === 'running' && app.state !== 'running') return false;
    if (filter === 'stopped' && app.state !== 'stopped') return false;
    if (filter === 'updates' && !app.updateAvailable) return false;
    if (!needle) return true;
    const hay = `${app.name} ${app.id} ${app.externalId} ${app.description ?? ''}`.toLowerCase();
    return hay.includes(needle);
  });
}

export function filterCatalogApps(
  apps: readonly CatalogAppRecord[],
  query: string,
): CatalogAppRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...apps];
  return apps.filter((app) =>
    `${app.name} ${app.id} ${app.description ?? ''} ${app.category}`.toLowerCase().includes(needle),
  );
}

export function buildDemoAppsState(): DemoAppsState {
  const installed: InstalledAppRecord[] = [
    {
      id: 'zigbee2mqtt',
      externalId: 'zigbee2mqtt',
      name: 'Zigbee2MQTT',
      version: '2.1.3',
      latestVersion: '2.1.3',
      state: 'running',
      available: true,
      managed: true,
      actions: ['stop', 'restart'],
      logs: true,
      updateAvailable: false,
      sourceKind: 'haus-app',
      accessories: { mqtt: true },
    },
    {
      id: 'go2rtc',
      externalId: 'go2rtc',
      name: 'Haus Media Relay',
      version: '1.9.8',
      latestVersion: '1.9.9',
      state: 'running',
      available: true,
      managed: true,
      actions: ['stop', 'restart'],
      logs: true,
      updateAvailable: true,
      sourceKind: 'haus-app',
      accessories: { camera: true },
    },
    {
      id: 'thread-border',
      externalId: 'thread-border',
      name: 'Thread Border Router',
      version: '1.4.2',
      state: 'stopped',
      available: true,
      managed: true,
      actions: ['start'],
      logs: true,
      updateAvailable: false,
      sourceKind: 'haus-app',
    },
  ];
  const catalog: CatalogAppRecord[] = [
    {
      id: 'zigbee2mqtt',
      name: 'Zigbee2MQTT',
      description: 'Connect Zigbee radios and accessories locally over MQTT.',
      category: 'zigbee',
      runtimeType: 'docker_app',
      installed: true,
      state: 'running',
      currentVersion: '2.1.3',
      latestVersion: '2.1.3',
      updateAvailable: false,
      verified: true,
    },
    {
      id: 'matter-bridge',
      name: 'Matter Controller',
      description: 'Commission and control local Thread and Wi-Fi Matter accessories.',
      category: 'matter',
      runtimeType: 'docker_app',
      installed: false,
      latestVersion: '1.5.0',
      updateAvailable: false,
      verified: true,
    },
  ];
  const logsById: Record<string, string> = {
    zigbee2mqtt: '[info] Coordinator ready on /dev/ttyACM0\n[info] MQTT bridge connected (28 entities published)',
    go2rtc: '[info] Relay listener ready on :1984\n[info] 3 local camera streams warming',
    'thread-border': '[info] Service stopped by user',
  };
  return { installed, catalog, logsById };
}
