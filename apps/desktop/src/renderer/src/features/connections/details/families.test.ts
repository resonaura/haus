import { describe, expect, it } from 'vitest';
import type { AddonInfo, IntegrationEntry } from '../../../ha/management';
import type { Snapshot } from '../../../model';
import { buildIntegrationGroups, computeIntegrationStats, filterAddonItems } from '../system/types';
import {
  familyEntries,
  groupAddonFamilies,
  integrationFamily,
  integrationSummary,
} from './families';

const entry = (domain: string, extra: Partial<IntegrationEntry> = {}): IntegrationEntry => ({
  entry_id: domain,
  domain,
  title: domain,
  state: 'loaded',
  disabled_by: null,
  ...extra,
});
const entries = [
  entry('tuya', { title: 'Cloud account' }),
  entry('tuya-rtsp-bridge', { entry_id: 'app:tuya-rtsp-bridge', source: 'app' }),
  entry('govee', { entry_id: 'app:govee', source: 'app' }),
  entry('homebridge-govee', {
    entry_id: 'app:homebridge-govee',
    source: 'app',
    state: 'setup_error',
  }),
  entry('hue'),
];
const groups = (filter = 'all', query = '', items = entries) =>
  buildIntegrationGroups(
    items,
    filter,
    query,
    (item) => item.state === 'setup_error',
    (id) => id,
  );
const addons: AddonInfo[] = [
  { slug: 'govee', name: 'Govee to MQTT', description: 'Lights', state: 'started' },
  {
    slug: 'homebridge-govee',
    name: 'Homebridge Govee',
    description: 'Switches',
    state: 'error',
    update_available: true,
  },
  {
    slug: 'tuya-rtsp-bridge',
    name: 'Tuya Camera Bridge',
    description: 'Cameras',
    state: 'started',
  },
  { slug: 'nixie', name: 'Clock', description: 'Time', state: 'started' },
];

describe('integration and App presentation families', () => {
  it('groups only exact known component identities, including Supervisor-prefixed slugs', () => {
    expect(integrationFamily('a0b1c2d3_govee2mqtt')).toBe('govee');
    expect(integrationFamily('homebridge_govee')).toBe('govee');
    expect(integrationFamily('tuya-rtsp-bridge')).toBe('tuya');
    expect(integrationFamily('my-govee-copy')).toBe('my-govee-copy');
    expect(integrationFamily('mqtt')).toBe('mqtt');
    expect(integrationFamily('homebridge')).toBe('homebridge');
  });

  it('shows one Tuya and one Govee card, preserving the actual entries and IDs', () => {
    expect(groups().map((group) => [group.domain, group.name, group.entries.length])).toEqual([
      ['govee', 'Govee', 2],
      ['hue', 'hue', 1],
      ['tuya', 'Tuya', 2],
    ]);
    expect(familyEntries(entries, 'tuya-rtsp-bridge')).toEqual(entries.slice(0, 2));
    expect(familyEntries(entries, 'govee')[1]).toBe(entries[3]);
  });

  it('finds a family by a component title/domain and retains its sibling', () => {
    expect(groups('all', 'homebridge-govee')[0]?.entries).toEqual(entries.slice(2, 4));
    expect(groups('all', ' Cloud account ')[0]?.entries).toEqual(entries.slice(0, 2));
    expect(groups('all', 'not-present')).toEqual([]);
  });

  it('keeps mixed family statuses visible when filtering for issues or disabled components', () => {
    expect(groups('issues').map((group) => group.domain)).toEqual(['govee']);
    expect(groups('issues')[0]?.entries).toEqual(entries.slice(2, 4));
    const mixed = entries.map((item) =>
      item.domain === 'tuya-rtsp-bridge'
        ? { ...item, disabled_by: 'user', state: 'not_loaded' }
        : item,
    );
    const result = groups('disabled', '', mixed);
    expect(result[0]?.domain).toBe('tuya');
    expect(result[0]?.entries.some((item) => !item.disabled_by)).toBe(true);
    expect(groups('discovered')).toEqual([]);
  });

  it('preserves the existing entry filter for unrelated providers', () => {
    const items = [entry('hue'), entry('hue', { entry_id: 'second', disabled_by: 'user' })];
    expect(groups('disabled', '', items)[0]?.entries.map((item) => item.entry_id)).toEqual([
      'second',
    ]);
  });

  it('counts a shared device once and includes both component platforms', () => {
    const snapshot: Snapshot = {
      config: { location_name: 'Home', version: '2026.11.0' },
      user: { id: 'admin', name: 'Admin', is_admin: true },
      areas: [],
      states: [],
      services: {},
      devices: [
        { id: 'shared', config_entries: ['app:govee', 'app:homebridge-govee'] },
        { id: 'switch', config_entries: ['app:homebridge-govee'] },
      ],
      entities: [
        {
          entity_id: 'light.shared',
          device_id: 'shared',
          config_entry_id: 'app:govee',
          platform: 'govee',
        },
        {
          entity_id: 'sensor.shared',
          device_id: 'shared',
          config_entry_id: 'app:homebridge-govee',
          platform: 'homebridge-govee',
        },
        { entity_id: 'switch.second', device_id: 'switch', platform: 'homebridge-govee' },
        { entity_id: 'light.unrelated', platform: 'hue' },
      ],
    };
    expect(computeIntegrationStats('govee', familyEntries(entries, 'govee'), snapshot)).toEqual({
      deviceCount: 2,
      entityCount: 3,
    });
  });

  it('labels installed components separately from cloud accounts', () => {
    expect(integrationSummary(entries.slice(0, 2), 4)).toBe('1 account · 1 component · 4 devices');
    expect(integrationSummary(entries.slice(2, 4), 13)).toBe('2 components · 13 devices');
  });

  it('groups Apps in installed and store results without merging action targets', () => {
    for (const viewStore of [true, false]) {
      const filtered = filterAddonItems(addons, viewStore, 'all', 'govee');
      const result = groupAddonFamilies(filtered);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Govee');
      expect(result[0]?.items).toEqual(addons.slice(0, 2));
      expect(result[0]?.items[1]).toBe(addons[1]);
    }
  });

  it('searches any App component and exposes other component states and updates', () => {
    expect(filterAddonItems(addons, false, 'all', 'Switches')).toEqual(addons.slice(0, 2));
    expect(filterAddonItems(addons, false, 'updates', '')).toEqual(addons.slice(0, 2));
    expect(filterAddonItems(addons, false, 'error', '')).toEqual(addons.slice(0, 2));
    expect(
      groupAddonFamilies(filterAddonItems(addons, false, 'started', '')).map((g) => g.id),
    ).toEqual(['govee', 'tuya', 'nixie']);
  });
});
