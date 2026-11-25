/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildDemoHaImportBundleJson,
  buildHaImportSummaries,
  describeHaImportFailure,
  MAX_HA_DATA_TRANSFER_BYTES,
  parseHaImportBundleText,
  stageHaImportEntries,
} from '../../src/transport/index.js';

function createValidTransferJson(entryOverrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entries: [
      {
        entry: {
          entryId: 'entry_hue_1',
          domain: 'hue',
          title: 'Philips Hue Bridge',
          data: { host: '192.168.1.40' },
          disabledBy: 'user',
          subentries: [
            {
              subentryId: 'sub_1',
              subentryType: 'bridge_device',
              title: 'Living Room Hub',
              data: { id: 1 },
              uniqueId: 'sub_uid_1',
            },
          ],
          ...entryOverrides,
        },
        devices: [{ id: 'dev_1', config_subentry_id: 'sub_1' }],
        entities: [{ entity_id: 'light.lamp', config_subentry_id: 'sub_1' }],
        areas: [{ id: 'living_room', name: 'Living Room' }],
      },
    ],
  });
}

describe('ha-import transport core', () => {
  it('validates HA transfer bundles, subentry referential integrity, size cap, and demo fixture', () => {
    const entries = parseHaImportBundleText(createValidTransferJson());
    expect(entries).toHaveLength(1);
    expect(buildHaImportSummaries(entries)).toEqual([
      {
        id: 'entry_hue_1',
        domain: 'hue',
        title: 'Philips Hue Bridge',
        devices: 1,
        entities: 1,
      },
    ]);

    const demo = parseHaImportBundleText(buildDemoHaImportBundleJson());
    expect(demo).toHaveLength(2);
    expect(buildHaImportSummaries(demo).map((item) => item.domain)).toEqual(['hue', 'mqtt']);

    expect(() => parseHaImportBundleText('{}', MAX_HA_DATA_TRANSFER_BYTES + 1)).toThrow(
      'The transfer file exceeds 80 KB.',
    );

    expect(() => parseHaImportBundleText('{"entries":[]}')).toThrow(
      'Choose a Home Assistant transfer JSON file.',
    );

    expect(() => parseHaImportBundleText(createValidTransferJson({ disabledBy: null }))).toThrow(
      'This file is not a supported, disabled Home Assistant transfer bundle.',
    );

    expect(() =>
      parseHaImportBundleText(
        JSON.stringify({
          entries: [
            {
              entry: {
                entryId: 'e1',
                domain: 'hue',
                title: 'Hue',
                data: {},
                disabledBy: 'user',
                subentries: [
                  { subentryId: 'dup', subentryType: 'device', title: 'A', data: {} },
                  { subentryId: 'dup', subentryType: 'device', title: 'B', data: {} },
                ],
              },
            },
          ],
        }),
      ),
    ).toThrow('The integration subentries are invalid.');

    expect(() =>
      parseHaImportBundleText(
        JSON.stringify({
          entries: [
            {
              entry: {
                entryId: 'e1',
                domain: 'hue',
                title: 'Hue',
                data: {},
                disabledBy: 'user',
              },
              entities: [{ entity_id: 'light.a', config_subentry_id: 'missing_sub' }],
            },
          ],
        }),
      ),
    ).toThrow('An entity refers to an integration subentry that is missing.');

    expect(() =>
      parseHaImportBundleText(
        JSON.stringify({
          entries: [
            {
              entry: {
                entryId: 'e1',
                domain: 'hue',
                title: 'Hue',
                data: {},
                disabledBy: 'user',
              },
              devices: [{ id: 'dev_a', config_subentry_id: 'missing_sub' }],
            },
          ],
        }),
      ),
    ).toThrow('A device refers to an integration subentry that is missing.');
  });

  it('maps all HA import failure codes and stages entries sequentially with progress updates', async () => {
    expect(describeHaImportFailure(new Error('integration_entry_identity_conflict'))).toContain(
      'physical integration already has an owner',
    );
    expect(describeHaImportFailure(new Error('integration_entity_conflict'))).toContain(
      'One or more entity IDs are already owned',
    );
    expect(describeHaImportFailure(new Error('integration_entry_conflict'))).toContain(
      'different copy of this integration entry',
    );
    expect(describeHaImportFailure(new Error('ha_flow_runtime_unavailable'))).toContain(
      'could not start the integration runtime',
    );
    expect(describeHaImportFailure(new Error('unsupported_import_domain'))).toContain(
      'does not support this Home Assistant integration',
    );
    expect(describeHaImportFailure(new Error('custom failure'))).toBe('custom failure');
    expect(describeHaImportFailure('non-error')).toBe('Import stopped before completion.');

    const demoEntries = parseHaImportBundleText(buildDemoHaImportBundleJson());
    const stagedOrder: string[] = [];
    const progress: number[] = [];
    const result = await stageHaImportEntries(
      demoEntries,
      async (item) => {
        stagedOrder.push(item.entry.entryId);
      },
      ({ completed }) => progress.push(completed),
    );
    expect(stagedOrder).toEqual(['ha_hue_willow_bridge', 'ha_mqtt_willow']);
    expect(progress).toEqual([1, 2]);
    expect(result).toEqual({ completed: 2, imported: 2 });

    await expect(
      stageHaImportEntries(demoEntries, async (item) => {
        if (item.entry.domain === 'mqtt') throw new Error('integration_entity_conflict');
      }),
    ).rejects.toThrow('integration_entity_conflict');
  });
});
