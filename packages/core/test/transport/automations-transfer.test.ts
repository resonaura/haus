/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  buildDemoTransferBundleJson,
  buildEntityAliases,
  describeAutomationMigration,
  friendlyTransferError,
  importTransferBundle,
  MAX_TRANSFER_BUNDLE_BYTES,
  normalizedRule,
  parseTransferBundleText,
  simulateDemoTransferImport,
  type ManagementPort,
  type ManagementRequest,
  type TransferBundle,
} from '../../src/transport/index.js';

function createValidBundleJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    source: 'home_assistant',
    registryEntityIds: {
      '0123456789abcdef0123456789abcdef': 'light.old_lamp',
    },
    deviceEntities: {
      abcdef0123456789abcdef0123456789: [
        {
          entityId: 'light.old_lamp',
          domain: 'light',
          platform: 'hue',
          uniqueId: 'lamp_uid_1',
          deviceIdentifiers: [['hue', 'bulb_1']],
          friendlyName: 'Living Room Lamp',
        },
      ],
    },
    scripts: [
      {
        id: 'night_lamp',
        name: 'Night Lamp Script',
        sourceEntityId: 'script.night_lamp',
        config: {
          alias: 'Night Lamp Script',
          sequence: [
            { action: 'light.turn_on', target: { entity_id: '0123456789abcdef0123456789abcdef' } },
          ],
        },
      },
    ],
    automations: [
      {
        id: 'morning_lamp',
        name: 'Morning Lamp',
        sourceEntityId: 'automation.morning_lamp',
        sourceEnabled: true,
        config: {
          alias: 'Morning Lamp',
          triggers: [{ trigger: 'state', entity_id: 'light.old_lamp', to: 'on' }],
          actions: [{ action: 'light.turn_off', target: { entity_id: 'light.old_lamp' } }],
        },
      },
    ],
    ...overrides,
  });
}

describe('automations transfer core', () => {
  it('parses valid transfer bundles and demo JSON while rejecting malformed or oversized inputs', () => {
    const bundle = parseTransferBundleText(createValidBundleJson());
    expect(bundle.scripts).toHaveLength(1);
    expect(bundle.automations).toHaveLength(1);

    const demoBundle = parseTransferBundleText(buildDemoTransferBundleJson());
    expect(demoBundle.scripts[0]?.id).toBe('welcome_hallway_glow');
    expect(demoBundle.automations[0]?.id).toBe('front_door_evening_light');

    const demoResult = simulateDemoTransferImport(demoBundle);
    expect(demoResult.saved).toBe(2);
    expect(demoResult.completed).toBe(2);
    expect(demoResult.entries.every((entry) => entry.status === 'saved')).toBe(true);

    expect(() => parseTransferBundleText('{"a":1}', MAX_TRANSFER_BUNDLE_BYTES + 1)).toThrow(
      'The rule transfer file exceeds 1 MB.',
    );

    const protoJson = '{"schemaVersion":1,"source":"home_assistant","__proto__":{}}';
    expect(() => parseTransferBundleText(protoJson)).toThrow(
      'Choose a valid Home Assistant rules transfer file.',
    );

    expect(() =>
      parseTransferBundleText(
        createValidBundleJson({
          scripts: [],
          automations: [
            {
              id: 'dup_id',
              name: 'One',
              sourceEntityId: 'automation.one',
              sourceEnabled: true,
              config: { alias: 'One' },
            },
            {
              id: 'dup_id',
              name: 'Two',
              sourceEntityId: 'automation.two',
              sourceEnabled: false,
              config: { alias: 'Two' },
            },
          ],
        }),
      ),
    ).toThrow('The transfer file is empty or contains duplicate Haus IDs.');

    expect(() =>
      parseTransferBundleText(
        createValidBundleJson({
          automations: [
            {
              id: 'missing_enabled',
              name: 'Missing enabled',
              sourceEntityId: 'automation.missing_enabled',
              config: { alias: 'Missing enabled' },
            },
          ],
        }),
      ),
    ).toThrow('The transfer file is missing an automation enabled state.');
  });

  it('normalizes entities through aliases and rejects unsupported templates', () => {
    const bundle: TransferBundle = parseTransferBundleText(createValidBundleJson());
    const aliases = buildEntityAliases(bundle, [
      {
        entityId: 'light.haus_lamp',
        deviceId: 'dev_1',
        domain: 'light',
        platform: 'hue',
        uniqueId: 'lamp_uid_1',
      },
    ]);
    expect(aliases.get('light.old_lamp')).toBe('light.haus_lamp');

    const firstAutomation = bundle.automations[0];
    expect(firstAutomation).toBeDefined();
    if (!firstAutomation) return;

    const normalized = normalizedRule(firstAutomation, 'automation', bundle, aliases);
    expect(normalized.triggers).toEqual([
      { trigger: 'state', entity_id: 'light.haus_lamp', to: 'on' },
    ]);
    expect(normalized.actions).toEqual([
      { action: 'light.turn_off', target: { entity_id: 'light.haus_lamp' } },
    ]);
    expect(normalized._hausMigration).toEqual({
      source: 'home_assistant',
      schemaVersion: 1,
      sourceEntityId: 'automation.morning_lamp',
      sourceEnabled: true,
    });

    expect(() =>
      normalizedRule(
        {
          id: 'templated',
          name: 'Templated',
          sourceEntityId: 'automation.templated',
          sourceEnabled: true,
          config: { alias: 'Templated', message: '{{ states("light.old_lamp") }}' },
        },
        'automation',
        bundle,
        aliases,
      ),
    ).toThrow('unsupported_automation_template');

    expect(friendlyTransferError('unsupported_automation_template')).toBe(
      'This rule uses Home Assistant templates that Haus cannot execute yet.',
    );
  });

  it('imports scripts before automations, skips already-imported rules, and fails ID conflicts', async () => {
    const bundle = parseTransferBundleText(
      createValidBundleJson({
        automations: [
          {
            id: 'new_rule',
            name: 'New Rule',
            sourceEntityId: 'automation.new_rule',
            sourceEnabled: true,
            config: {
              alias: 'New Rule',
              triggers: [{ trigger: 'state', entity_id: 'light.old_lamp', to: 'on' }],
              actions: [{ action: 'light.turn_off', target: { entity_id: 'light.old_lamp' } }],
            },
          },
          {
            id: 'already_rule',
            name: 'Already Rule',
            sourceEntityId: 'automation.already_rule',
            sourceEnabled: false,
            config: {
              alias: 'Already Rule',
              triggers: [{ trigger: 'time', at: '07:00:00' }],
              actions: [{ action: 'light.turn_on', target: { entity_id: 'light.old_lamp' } }],
            },
          },
          {
            id: 'conflict_rule',
            name: 'Conflict Rule',
            sourceEntityId: 'automation.conflict_rule',
            sourceEnabled: true,
            config: {
              alias: 'Conflict Rule',
              triggers: [{ trigger: 'time', at: '08:00:00' }],
              actions: [{ action: 'light.turn_on', target: { entity_id: 'light.old_lamp' } }],
            },
          },
        ],
      }),
    );

    const requests: ManagementRequest[] = [];
    const port: ManagementPort = {
      async management<T = unknown>(input: ManagementRequest): Promise<T> {
        requests.push(input);
        if (input.method === 'GET' && input.path === 'haus/rules/scripts') {
          return { scripts: [] } as T;
        }
        if (input.method === 'GET' && input.path === 'haus/rules/automations') {
          return {
            automations: [
              {
                id: 'already_rule',
                metadata: { migration: { sourceEntityId: 'automation.already_rule' } },
              },
              {
                id: 'conflict_rule',
                metadata: { migration: { sourceEntityId: 'automation.other_rule' } },
              },
            ],
          } as T;
        }
        if (input.method === 'GET' && input.path === 'haus/rules/entities') {
          return {
            entities: [
              {
                entityId: 'light.haus_lamp',
                deviceId: 'dev_1',
                domain: 'light',
                platform: 'hue',
                uniqueId: 'lamp_uid_1',
              },
            ],
          } as T;
        }
        return { ok: true } as T;
      },
    };

    const progressUpdates: number[] = [];
    const result = await importTransferBundle(port, bundle, (progress) => {
      progressUpdates.push(progress.completed);
    });

    expect(progressUpdates).toEqual([1, 2, 3, 4]);
    expect(result.completed).toBe(4);
    expect(result.saved).toBe(2);
    expect(result.entries.map((entry) => [entry.key, entry.status])).toEqual([
      ['script:night_lamp', 'saved'],
      ['automation:new_rule', 'saved'],
      ['automation:already_rule', 'skipped'],
      ['automation:conflict_rule', 'failed'],
    ]);

    const postPaths = requests.filter((req) => req.method === 'POST').map((req) => req.path);
    expect(postPaths).toEqual([
      'config/script/config/night_lamp',
      'config/automation/config/new_rule',
    ]);
  });

  it('describes all 4 automation migration states accurately', () => {
    expect(
      describeAutomationMigration(
        {
          id: 'r1',
          friendly_name: 'Morning',
          haus_migration_source: 'home_assistant',
          haus_migration_source_entity_id: 'automation.morning',
        },
        'off',
      ),
    ).toMatchObject({
      ruleId: 'r1',
      friendlyName: 'Morning',
      waitingForSourceCutover: true,
      statusLabel: 'Imported and paused here · Home Assistant is the source',
    });

    expect(
      describeAutomationMigration(
        {
          id: 'r2',
          friendly_name: 'Cutover',
          haus_migration_source: 'home_assistant',
          haus_migration_source_cutover_at: '2026-11-24T00:00:00Z',
        },
        'on',
      ).statusLabel,
    ).toBe('Haus runs this rule · Home Assistant copy is paused for rollback');

    expect(
      describeAutomationMigration(
        {
          id: 'r3',
          friendly_name: 'Removed',
          haus_migration_source: 'home_assistant',
          haus_migration_source_cutover_at: '2026-11-24T00:00:00Z',
          haus_migration_source_removed_at: '2026-11-24T01:00:00Z',
        },
        'on',
      ).statusLabel,
    ).toBe('Haus runs this rule · Removed from Home Assistant');

    expect(
      describeAutomationMigration({ id: 'r4', friendly_name: 'Native' }, 'on').statusLabel,
    ).toBe('Ready when you need it · Managed by Haus Hub');
  });
});
