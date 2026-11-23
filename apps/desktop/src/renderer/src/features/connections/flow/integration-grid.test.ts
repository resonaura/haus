/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  buildIntegrationCatalog,
  buildIntegrationVirtualLayout,
  computeIntegrationGridColumns,
  filterIntegrationCatalog,
  getIntegrationLetter,
  INTEGRATION_BATCH_STEP,
  loadedCountForSectionJump,
  nextProgressiveLoadedCount,
  nextProgressiveLoadedCountForRows,
  sliceProgressiveVirtualRows,
} from './integration-grid';

describe('integration catalog helpers', () => {
  it('deduplicates, unifies Govee into Haus Govee, assigns letter buckets, and sorts by letter then stability/title', () => {
    const catalog = buildIntegrationCatalog(['xiaomi_miot', 'hue', 'hue', 'govee', '17track'], {
      'component.hue.title': 'Philips Hue',
      'component.xiaomi_miot.title': 'Xiaomi Miot Auto',
      'component.17track.title': '17TRACK',
    });

    expect(catalog.map((item) => item.id)).toEqual(['17track', 'govee', 'hue', 'xiaomi_miot']);
    expect(catalog.map((item) => item.letter)).toEqual(['#', 'G', 'P', 'X']);
    expect(catalog.map((item) => item.title)).toEqual([
      '17TRACK',
      'Haus Govee',
      'Philips Hue',
      'Xiaomi Miot Auto',
    ]);
    const hausGovee = catalog.find((item) => item.id === 'govee');
    expect(hausGovee?.isCombinedHausGovee).toBe(true);
    expect(hausGovee?.driverCount).toBeGreaterThanOrEqual(2);
  });

  it('normalizes accented Latin letters and routes non-Latin or numeric prefixes to #', () => {
    expect(getIntegrationLetter('Éclairage')).toBe('E');
    expect(getIntegrationLetter('  aqara')).toBe('A');
    expect(getIntegrationLetter('3M Filtrete')).toBe('#');
    expect(getIntegrationLetter('')).toBe('#');
  });

  it('ranks exact, then prefix, then substring search matches', () => {
    const catalog = buildIntegrationCatalog(
      ['my_hue_bridge', 'hue', 'hue_ble', 'philips_hue_sync'],
      {
        'component.my_hue_bridge.title': 'Custom Hue Bridge',
        'component.hue.title': 'Hue',
        'component.hue_ble.title': 'Hue BLE',
        'component.philips_hue_sync.title': 'Philips Hue Sync',
      },
    );

    const matched = filterIntegrationCatalog(catalog, 'hue');
    expect(matched.map((item) => item.id)).toEqual([
      'hue',
      'hue_ble',
      'my_hue_bridge',
      'philips_hue_sync',
    ]);
  });

  it('returns the full catalog reference when query is blank', () => {
    const catalog = buildIntegrationCatalog(['matter', 'homekit'], {});
    expect(filterIntegrationCatalog(catalog, '   ')).toBe(catalog);
  });

  it('builds grouped virtual rows with exact section header indices for alphabet jumps', () => {
    const catalog = buildIntegrationCatalog(
      ['aqara', 'apple_tv', 'asus', 'august', 'bosch', 'zigbee'],
      {
        'component.aqara.title': 'Aqara',
        'component.apple_tv.title': 'Apple TV',
        'component.asus.title': 'ASUS',
        'component.august.title': 'August',
        'component.bosch.title': 'Bosch',
        'component.zigbee.title': 'Zigbee',
      },
    );

    const layout = buildIntegrationVirtualLayout(catalog, 3, true);
    expect(layout.sections.map((s) => `${s.letter}:${s.count}@${s.rowIndex}`)).toEqual([
      'A:4@0',
      'B:1@3',
      'Z:1@5',
    ]);
    expect(
      layout.rows.map((r) => (r.kind === 'header' ? `H:${r.letter}` : `I:${r.items.length}`)),
    ).toEqual(['H:A', 'I:3', 'I:1', 'H:B', 'I:1', 'H:Z', 'I:1']);
    expect(layout.sectionByLetter.get('Z')).toEqual({
      letter: 'Z',
      count: 1,
      rowIndex: 5,
      firstItemIndex: 5,
      endItemIndex: 6,
    });
  });

  it('slices grouped rows progressively and expands loaded count on section jump', () => {
    const catalog = buildIntegrationCatalog(['a1', 'a2', 'a3', 'b1', 'b2', 'z1', 'z2'], {});
    const layout = buildIntegrationVirtualLayout(catalog, 2, true);

    const initial = sliceProgressiveVirtualRows(layout.rows, 4, catalog.length);
    expect(
      initial.map((r) => (r.kind === 'header' ? `H:${r.letter}` : `I:${r.items.length}`)),
    ).toEqual(['H:A', 'I:2', 'I:1', 'H:B', 'I:1']);

    const zSection = layout.sectionByLetter.get('Z')!;
    const expanded = loadedCountForSectionJump(4, zSection, catalog.length, 48);
    expect(expanded).toBe(catalog.length);
    const afterJump = sliceProgressiveVirtualRows(layout.rows, expanded, catalog.length);
    expect(afterJump[zSection.rowIndex]).toMatchObject({ kind: 'header', letter: 'Z' });
  });

  it('advances progressive scroll loading only near the end of loaded rows', () => {
    expect(nextProgressiveLoadedCount(48, 1300, 4, 3)).toBe(48);
    expect(nextProgressiveLoadedCount(48, 1300, 10, 3)).toBe(48);
    expect(nextProgressiveLoadedCount(48, 1300, 11, 3)).toBe(48 + INTEGRATION_BATCH_STEP);
    expect(nextProgressiveLoadedCount(1280, 1300, 425, 3)).toBe(1300);
    expect(nextProgressiveLoadedCount(1300, 1300, 430, 3)).toBe(1300);

    expect(nextProgressiveLoadedCountForRows(48, 1300, 14, 20)).toBe(48);
    expect(nextProgressiveLoadedCountForRows(48, 1300, 15, 20)).toBe(48 + INTEGRATION_BATCH_STEP);
  });

  it('selects responsive grid columns by viewport width', () => {
    expect(computeIntegrationGridColumns(860)).toBe(3);
    expect(computeIntegrationGridColumns(520)).toBe(2);
    expect(computeIntegrationGridColumns(360)).toBe(1);
  });

  it('groups vendors into brand cards, unifies Govee2MQTT + Homebridge Govee into Haus Govee, and ranks drivers by trust score', () => {
    const catalog = buildIntegrationCatalog(
      ['hue', 'reolink'],
      {
        'component.hue.title': 'Philips Hue',
        'component.reolink.title': 'Reolink',
      },
      [
        {
          id: 'homebridge-govee',
          name: 'Homebridge Govee',
          runtimeType: 'homebridge',
          packageName: 'homebridge-govee',
          verified: true,
          trustScore: 96,
          stabilityTier: 'gold',
        },
        {
          id: 'govee2mqtt',
          name: 'Govee to MQTT',
          runtimeType: 'docker',
          packageName: 'govee2mqtt',
          verified: true,
          trustScore: 95,
          stabilityTier: 'gold',
        },
        {
          id: 'scrypted-reolink',
          name: 'Scrypted Reolink',
          runtimeType: 'scrypted',
          packageName: '@scrypted/reolink',
          verified: true,
          trustScore: 93,
          stabilityTier: 'gold',
          installed: true,
        },
        {
          id: 'homebridge-reolink-experimental',
          name: 'Reolink Experimental',
          runtimeType: 'homebridge',
          packageName: 'homebridge-reolink-experimental',
          verified: false,
          trustScore: 39,
          stabilityTier: 'low',
        },
        {
          id: 'homebridge-ralpha-obscure',
          name: 'Ralpha Obscure',
          runtimeType: 'homebridge',
          packageName: 'homebridge-ralpha-obscure',
          verified: false,
          trustScore: 35,
          stabilityTier: 'low',
        },
      ],
    );

    // 4 brand groups: Haus Govee (G), Philips Hue (P), Reolink (R - gold), Ralpha Obscure (R - low)
    expect(catalog.map((i) => i.title)).toEqual([
      'Haus Govee',
      'Philips Hue',
      'Reolink',
      'Ralpha Obscure',
    ]);

    // Inside letter R, Gold-tier Reolink ranks ahead of Low-tier Ralpha Obscure even though "Ralpha" < "Reolink" alphabetically
    const rBrands = catalog.filter((i) => i.letter === 'R');
    expect(rBrands.map((i) => i.title)).toEqual(['Reolink', 'Ralpha Obscure']);

    // Inside Reolink brand group, drivers are ranked descending by trustScore: HA (94) -> Scrypted (93) -> Experimental (39)
    const reolinkGroup = catalog.find((i) => i.vendorId === 'reolink')!;
    expect(reolinkGroup.driverCount).toBe(3);
    expect(reolinkGroup.groupItems?.map((d) => d.trustScore)).toEqual([94, 93, 39]);

    // Ecosystem filtering scopes brand groups and drivers
    expect(filterIntegrationCatalog(catalog, '', 'ha').map((i) => i.id)).toEqual([
      'hue',
      'reolink',
    ]);
    expect(filterIntegrationCatalog(catalog, '', 'scrypted').map((i) => i.appId)).toEqual([
      'scrypted-reolink',
    ]);
    expect(
      filterIntegrationCatalog(catalog, '@scrypted/reolink', 'all').map((i) => i.vendorId),
    ).toEqual(['reolink']);
  });

  it('includes HACS library integrations in brand groups, filters by hacs ecosystem, and deduplicates already-installed HA handlers', () => {
    const catalog = buildIntegrationCatalog(
      ['tuya', 'meross_lan'],
      {
        'component.tuya.title': 'Tuya',
        'component.meross_lan.title': 'Meross LAN',
      },
      [
        {
          id: 'hacs-tuya-local',
          name: 'Tuya Local',
          runtimeType: 'hacs',
          domain: 'tuya_local',
          hacsRepositoryId: '272272536',
          repositoryUrl: 'https://github.com/make-all/tuya-local',
          verified: true,
          trustScore: 90,
          stabilityTier: 'gold',
          vendorId: 'tuya',
          vendorName: 'Tuya',
          stars: 2400,
        },
        {
          id: 'hacs-meross-lan',
          name: 'Meross LAN',
          runtimeType: 'hacs',
          domain: 'meross_lan',
          hacsRepositoryId: '348697135',
          repositoryUrl: 'https://github.com/krahabb/meross_lan',
          verified: true,
          trustScore: 91,
          stabilityTier: 'gold',
          vendorId: 'meross',
          vendorName: 'Meross',
        },
        {
          id: 'hacs-dreame-vacuum',
          name: 'Dreame Vacuum',
          runtimeType: 'hacs',
          domain: 'dreame_vacuum',
          hacsRepositoryId: '528416044',
          repositoryUrl: 'https://github.com/Tasshack/dreame-vacuum',
          verified: true,
          trustScore: 89,
          stabilityTier: 'gold',
          vendorId: 'dreame',
          vendorName: 'Dreame',
        },
      ],
    );

    // Tuya brand merges official HA Core tuya + HACS Tuya Local
    const tuyaGroup = catalog.find((i) => i.vendorId === 'tuya')!;
    expect(tuyaGroup.driverCount).toBe(2);
    expect(tuyaGroup.groupItems?.map((d) => `${d.runtime}:${d.domain ?? d.id}`)).toEqual([
      'ha:tuya',
      'hacs:tuya_local',
    ]);

    // Already-installed meross_lan handler is enriched, not duplicated
    const merossGroup = catalog.find((i) => i.vendorId === 'meross')!;
    expect(merossGroup.driverCount).toBe(1);
    expect(merossGroup.groupItems?.[0]?.repositoryUrl).toBe(
      'https://github.com/krahabb/meross_lan',
    );

    // Ecosystem tab 'hacs' scopes to HACS-only entries and preserves hacsRepositoryId + domain
    const hacsOnly = filterIntegrationCatalog(catalog, '', 'hacs');
    expect(hacsOnly.map((i) => i.domain)).toEqual(['dreame_vacuum', 'tuya_local']);
    expect(hacsOnly.find((i) => i.domain === 'tuya_local')?.hacsRepositoryId).toBe('272272536');
  });
});
