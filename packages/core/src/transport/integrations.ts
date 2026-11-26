/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type IntegrationRuntimeType =
  'built_in' | 'custom_integration' | 'homebridge' | 'scrypted' | 'docker_app' | 'addon';

export interface IntegrationEntryRecord {
  readonly entry_id: string;
  readonly domain: string;
  readonly title: string;
  readonly state: string;
  readonly disabled_by: string | null;
  readonly reason?: string | null;
  readonly source?: string;
  readonly version?: string;
  readonly runtimeType?: IntegrationRuntimeType;
  readonly iotClass?: string;
  readonly documentationUrl?: string;
  readonly supports_options?: boolean;
  readonly supports_reconfigure?: boolean;
  readonly supports_remove_device?: boolean;
  readonly supports_unload?: boolean;
}

export interface IntegrationDomainMetaRecord {
  readonly domain: string;
  readonly name: string;
  readonly version?: string;
  readonly runtimeType: IntegrationRuntimeType;
  readonly iotClass?: string;
  readonly supportsOptions: boolean;
  readonly supportsReconfigure: boolean;
  readonly supportsMultiple: boolean;
  readonly documentationUrl?: string;
  readonly deviceCount: number;
  readonly entityCount: number;
  readonly entryCount: number;
  readonly brokenCount: number;
}

export interface IntegrationGroupSummary {
  readonly domain: string;
  readonly name: string;
  readonly entries: readonly IntegrationEntryRecord[];
}

export type IntegrationFilterId = 'all' | 'discovered' | 'loaded' | 'issues' | 'disabled';

export interface DiscoveredFlowItem {
  readonly flow_id: string;
  readonly handler: string;
  readonly title: string;
  readonly source?: string;
}

export interface RepairIssueRecord {
  readonly domain: string;
  readonly issue_id: string;
  readonly severity?: string;
  readonly translation_key?: string;
  readonly title?: string;
  readonly description?: string;
  readonly ignored?: boolean;
  readonly created?: string;
  readonly sourceLabel?: string;
}

export type UpdateCategory =
  'core' | 'integration' | 'plugin' | 'addon' | 'homebridge' | 'scrypted' | 'hacs' | 'firmware';

export interface UnifiedUpdateRecord {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly category: UpdateCategory;
  readonly installedVersion: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly canInstall: boolean;
  readonly compatibility?: 'verified' | 'unknown' | 'incompatible';
  readonly releaseSummary?: string;
}

export interface UnifiedUpdatesSummary {
  readonly checkedAt: string;
  readonly total: number;
  readonly availableCount: number;
  readonly items: readonly UnifiedUpdateRecord[];
}

export type UpdatesFilterId = 'available' | 'all' | 'firmware' | 'core_addon' | 'hacs' | 'bridges';

export interface DemoIntegrationsState {
  readonly entries: readonly IntegrationEntryRecord[];
  readonly metaByDomain: ReadonlyMap<string, IntegrationDomainMetaRecord>;
  readonly titles: Readonly<Record<string, string>>;
  readonly progress: readonly DiscoveredFlowItem[];
  readonly issues: readonly RepairIssueRecord[];
  readonly updates: UnifiedUpdatesSummary;
}

const FAMILY_MAP = new Map<string, string>([
  ['tuya', 'tuya'],
  ['tuya-rtsp-bridge', 'tuya'],
  ['govee', 'govee'],
  ['homebridge-govee', 'govee'],
  ['govee2mqtt', 'govee'],
]);

const ERROR_STATES = new Set(['setup_error', 'migration_error', 'setup_retry', 'failed_unload']);

export function integrationFamilyKey(domain: string): string {
  const normalized = domain
    .toLowerCase()
    .replace(/^[a-f0-9]{8}_/, '')
    .replaceAll('_', '-');
  return FAMILY_MAP.get(normalized) ?? domain;
}

export function humanizeIdentifier(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function formatRuntimeLabel(runtime?: IntegrationRuntimeType): string {
  switch (runtime) {
    case 'custom_integration':
      return 'Custom integration';
    case 'homebridge':
      return 'Homebridge plugin';
    case 'scrypted':
      return 'Scrypted plugin';
    case 'docker_app':
      return 'Docker app';
    case 'addon':
      return 'Add-on';
    case 'built_in':
      return 'Built-in integration';
    default:
      return 'Integration';
  }
}

export function formatIotClass(iotClass?: string): string | undefined {
  if (!iotClass) return undefined;
  const normalized = iotClass.toLowerCase();
  if (normalized.startsWith('cloud_')) return 'Requires Internet';
  if (normalized === 'local_push') return 'Local push';
  if (normalized === 'local_polling') return 'Local polling';
  if (normalized === 'assumed_state') return 'Assumed state';
  if (normalized === 'calculated') return 'Calculated';
  return iotClass.replaceAll('_', ' ');
}

export function formatRelativeAge(iso?: string, nowMs = Date.now()): string | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return undefined;
  const diffMin = Math.max(0, Math.floor((nowMs - ts) / 60_000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export function isIntegrationEntryIssue(
  entry: IntegrationEntryRecord,
  issues: readonly RepairIssueRecord[],
): boolean {
  if (ERROR_STATES.has(entry.state)) return true;
  const entryFamily = integrationFamilyKey(entry.domain);
  return issues.some(
    (issue) => !issue.ignored && integrationFamilyKey(issue.domain) === entryFamily,
  );
}

export function groupIntegrationsByDomain(
  entries: readonly IntegrationEntryRecord[],
  resolveTitle: (domain: string) => string,
): IntegrationGroupSummary[] {
  const byDomain = new Map<string, IntegrationEntryRecord[]>();
  for (const entry of entries) {
    const family = integrationFamilyKey(entry.domain);
    const list = byDomain.get(family) ?? [];
    list.push(entry);
    byDomain.set(family, list);
  }
  return [...byDomain.entries()]
    .map(([domain, domainEntries]) => ({
      domain,
      name: domain === 'tuya' ? 'Tuya' : domain === 'govee' ? 'Govee' : resolveTitle(domain),
      entries: domainEntries,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterIntegrationGroups(
  groups: readonly IntegrationGroupSummary[],
  filter: IntegrationFilterId,
  query: string,
  issues: readonly RepairIssueRecord[],
): IntegrationGroupSummary[] {
  const needle = query.trim().toLowerCase();
  return groups.filter((group) => {
    const matchesQuery =
      !needle ||
      group.name.toLowerCase().includes(needle) ||
      group.domain.toLowerCase().includes(needle) ||
      group.entries.some((entry) => entry.title.toLowerCase().includes(needle));
    if (!matchesQuery) return false;
    if (filter === 'loaded')
      return group.entries.some((e) => e.state === 'loaded' && !e.disabled_by);
    if (filter === 'disabled') return group.entries.every((e) => Boolean(e.disabled_by));
    if (filter === 'issues') return group.entries.some((e) => isIntegrationEntryIssue(e, issues));
    return true;
  });
}

export function countIntegrationFilters(
  entries: readonly IntegrationEntryRecord[],
  discoveredCount: number,
  issues: readonly RepairIssueRecord[],
): Record<IntegrationFilterId, number> {
  let loaded = 0;
  let disabled = 0;
  let issueCount = 0;
  for (const entry of entries) {
    if (entry.state === 'loaded') loaded += 1;
    if (entry.disabled_by) disabled += 1;
    if (isIntegrationEntryIssue(entry, issues)) issueCount += 1;
  }
  return {
    all: entries.length,
    discovered: discoveredCount,
    loaded,
    issues: issueCount,
    disabled,
  };
}

export function filterUpdates(
  items: readonly UnifiedUpdateRecord[],
  filter: UpdatesFilterId,
): UnifiedUpdateRecord[] {
  return items.filter((item) => {
    if (filter === 'available') return item.updateAvailable;
    if (filter === 'firmware') return item.category === 'firmware';
    if (filter === 'core_addon') return item.category === 'core' || item.category === 'addon';
    if (filter === 'hacs') return item.category === 'hacs' || item.category === 'integration';
    if (filter === 'bridges') {
      return (
        item.category === 'homebridge' || item.category === 'scrypted' || item.category === 'plugin'
      );
    }
    return true;
  });
}

export function buildDemoIntegrationsState(): DemoIntegrationsState {
  const entries: IntegrationEntryRecord[] = [
    {
      entry_id: 'hue-main',
      domain: 'hue',
      title: 'Hue Bridge · Living Room',
      state: 'loaded',
      disabled_by: null,
      runtimeType: 'built_in',
      iotClass: 'local_push',
      supports_options: true,
    },
    {
      entry_id: 'matter-main',
      domain: 'matter',
      title: 'Matter Fabric',
      state: 'loaded',
      disabled_by: null,
      runtimeType: 'built_in',
      iotClass: 'local_push',
    },
    {
      entry_id: 'zigbee-main',
      domain: 'zha',
      title: 'SkyConnect Radio',
      state: 'loaded',
      disabled_by: null,
      runtimeType: 'built_in',
      iotClass: 'local_push',
    },
    {
      entry_id: 'sonos-main',
      domain: 'sonos',
      title: 'Living Room Sonos',
      state: 'loaded',
      disabled_by: null,
      runtimeType: 'built_in',
      iotClass: 'local_push',
    },
  ];
  const metaByDomain = new Map<string, IntegrationDomainMetaRecord>([
    [
      'hue',
      {
        domain: 'hue',
        name: 'Philips Hue',
        version: '2.4.1',
        runtimeType: 'built_in',
        iotClass: 'local_push',
        supportsOptions: true,
        supportsReconfigure: false,
        supportsMultiple: true,
        deviceCount: 8,
        entityCount: 14,
        entryCount: 1,
        brokenCount: 0,
      },
    ],
    [
      'matter',
      {
        domain: 'matter',
        name: 'Matter',
        version: '1.3.0',
        runtimeType: 'built_in',
        iotClass: 'local_push',
        supportsOptions: false,
        supportsReconfigure: false,
        supportsMultiple: false,
        deviceCount: 6,
        entityCount: 9,
        entryCount: 1,
        brokenCount: 0,
      },
    ],
    [
      'zha',
      {
        domain: 'zha',
        name: 'Zigbee Home',
        version: '2026.10.0',
        runtimeType: 'built_in',
        iotClass: 'local_push',
        supportsOptions: true,
        supportsReconfigure: true,
        supportsMultiple: false,
        deviceCount: 9,
        entityCount: 16,
        entryCount: 1,
        brokenCount: 0,
      },
    ],
    [
      'sonos',
      {
        domain: 'sonos',
        name: 'Sonos',
        version: '1.9.0',
        runtimeType: 'built_in',
        iotClass: 'local_push',
        supportsOptions: false,
        supportsReconfigure: false,
        supportsMultiple: false,
        deviceCount: 2,
        entityCount: 4,
        entryCount: 1,
        brokenCount: 0,
      },
    ],
  ]);
  const updates: UnifiedUpdatesSummary = {
    checkedAt: '2026-11-24T00:00:00Z',
    total: 2,
    availableCount: 1,
    items: [
      {
        id: 'hue-firmware',
        domain: 'hue',
        title: 'Hue Bridge Firmware',
        category: 'firmware',
        installedVersion: '1.65.196505',
        latestVersion: '1.66.196601',
        updateAvailable: true,
        canInstall: true,
        compatibility: 'verified',
        releaseSummary: 'Improves local Matter bridge latency.',
      },
      {
        id: 'matter-core',
        domain: 'matter',
        title: 'Matter Server',
        category: 'addon',
        installedVersion: '1.3.0',
        latestVersion: '1.3.0',
        updateAvailable: false,
        canInstall: true,
        compatibility: 'verified',
      },
    ],
  };
  return {
    entries,
    metaByDomain,
    titles: {
      hue: 'Philips Hue',
      matter: 'Matter',
      zha: 'Zigbee Home',
      sonos: 'Sonos',
      homekit_controller: 'Apple HomeKit Device',
      apple_tv: 'Apple TV',
    },
    progress: [
      {
        flow_id: 'demo-flow-hue',
        handler: 'hue',
        title: 'Philips Hue Bridge',
        source: 'zeroconf',
      },
      {
        flow_id: 'demo-flow-matter',
        handler: 'matter',
        title: 'Matter Smart Plug',
        source: 'matter',
      },
      {
        flow_id: 'demo-flow-homekit',
        handler: 'homekit_controller',
        title: 'Aqara Presence FP2',
        source: 'homekit',
      },
    ],
    issues: [
      {
        domain: 'zha',
        issue_id: 'zigbee_channel_overlap',
        severity: 'warning',
        title: 'Zigbee channel overlaps 2.4 GHz Wi-Fi',
        description: 'Moving the mesh to channel 25 reduces packet retries.',
        created: '2026-11-23T18:00:00Z',
        sourceLabel: 'Zigbee Home',
      },
    ],
    updates,
  };
}
