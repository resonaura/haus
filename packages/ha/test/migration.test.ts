/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { LocalAutomationEngine, type AutomationExecutorEnvironment } from '@haus/core/automation';
import {
  AutomationMigrator,
  convertHaAutomation,
} from '../src/index.js';

describe('Home Assistant Automation Migration', () => {
  const sampleHaLightingAutomation = {
    id: '16987654321',
    alias: 'Evening Porch Light',
    description: 'Turn on porch light at sunset if anyone home',
    trigger: [
      {
        platform: 'sun',
        event: 'sunset',
        offset: '-00:15:00',
      },
      {
        platform: 'state',
        entity_id: 'binary_sensor.porch_motion',
        to: 'on',
      },
    ],
    condition: [
      {
        condition: 'state',
        entity_id: 'input_boolean.vacation_mode',
        state: 'off',
      },
      {
        condition: 'time',
        after: '17:00:00',
        before: '23:00:00',
      },
    ],
    action: [
      {
        service: 'light.turn_on',
        target: { entity_id: 'light.porch' },
        data: {
          brightness: 180,
          color_temp: 370, // HA Mireds
        },
      },
      {
        delay: '00:10:00',
      },
      {
        service: 'light.turn_off',
        target: { entity_id: 'light.porch' },
      },
    ],
    mode: 'restart',
  };

  it('converts HA automation triggers, conditions, and actions into Haus rules', () => {
    const item = convertHaAutomation(sampleHaLightingAutomation);

    expect(item.status).toBe('supported');
    expect(item.hausRule).toBeDefined();

    const rule = item.hausRule!;
    expect(rule.id).toBe('automation.ha_evening_porch_light');
    expect(rule.name).toBe('Evening Porch Light');
    expect(rule.mode).toBe('restart');
    expect(rule.enabled).toBe(true);

    // Triggers
    expect(rule.triggers).toHaveLength(2);
    expect(rule.triggers[0]?.type).toBe('time');
    expect((rule.triggers[0] as any).sun).toBe('sunset');
    expect((rule.triggers[0] as any).offsetMinutes).toBe(-15);
    expect(rule.triggers[1]?.type).toBe('state');

    // Conditions
    expect(rule.conditions).toHaveLength(2);
    expect(rule.conditions?.[0]?.type).toBe('state');
    expect(rule.conditions?.[1]?.type).toBe('time');

    // Actions & Mireds to Kelvin conversion
    expect(rule.actions).toHaveLength(3);
    const lightOn = rule.actions[0] as any;
    expect(lightOn.type).toBe('action');
    expect(lightOn.action.kind).toBe('device_command');
    expect(lightOn.action.payload.endpointId).toBe('light.porch');
    expect(lightOn.action.payload.command).toBe('turn_on');
    // Mireds 370 -> Kelvin 1,000,000 / 370 ~= 2703K
    expect(lightOn.action.payload.parameters.color_temp).toBe(2703);

    // Delay
    const delay = rule.actions[1] as any;
    expect(delay.type).toBe('delay');
    expect(delay.durationMs).toBe(600000); // 10 minutes in ms
  });

  it('converts scene and script calls and choose branching', () => {
    const complexHaAuto = {
      id: 'auto_complex',
      alias: 'Movie Mode Sequence',
      trigger: [{ platform: 'event', event_type: 'cinema_button' }],
      action: [
        {
          service: 'scene.turn_on',
          target: { entity_id: 'scene.cinema_dim' },
        },
        {
          choose: [
            {
              conditions: [
                {
                  condition: 'state',
                  entity_id: 'media_player.living_room_tv',
                  state: 'off',
                },
              ],
              sequence: [
                {
                  service: 'script.turn_on',
                  target: { entity_id: 'script.boot_projector' },
                },
              ],
            },
          ],
        },
      ],
    };

    const item = convertHaAutomation(complexHaAuto);
    expect(item.status).toBe('supported');

    const rule = item.hausRule!;
    expect(rule.actions).toHaveLength(2);
    expect((rule.actions[0] as any).action.kind).toBe('activate_scene');
    expect(rule.actions[1]?.type).toBe('choose');
  });

  it('identifies unsupported HA template automations and captures reasons', () => {
    const templateAuto = {
      id: 'auto_template',
      alias: 'Jinja Template Automation',
      trigger: [{ platform: 'template', value_template: "{{ states('sensor.power') > 100 }}" }],
      action: [{ service: 'light.turn_on', entity_id: 'light.desk' }],
    };

    const item = convertHaAutomation(templateAuto);
    expect(item.status).toBe('unsupported');
    expect(item.unsupportedReasons).toBeDefined();
    expect(item.unsupportedReasons?.[0]).toContain('template');
  });

  it('generates migration diff and lists automations to disable to prevent duplicates', () => {
    const migrator = new AutomationMigrator();
    const rawList = [
      sampleHaLightingAutomation,
      {
        id: 'auto_bad',
        alias: 'Bad Automation',
        trigger: [{ platform: 'unknown_vendor_platform' }],
        action: [],
      },
    ];

    const diff = migrator.createMigrationDiff(rawList);

    expect(diff.totalCount).toBe(2);
    expect(diff.supportedCount).toBe(1);
    expect(diff.unsupportedCount).toBe(1);
    expect(diff.duplicateActiveWarning).toBe(true);
    expect(diff.haAutomationsToDisable).toContain('automation.evening_porch_light');
  });

  it('applies migration, disables HA rules to prevent duplicates, and performs clean rollback', async () => {
    const migrator = new AutomationMigrator();
    const diff = migrator.createMigrationDiff([sampleHaLightingAutomation]);

    const disabledInHa: string[] = [];
    const reEnabledInHa: string[] = [];

    const dummyEnv: AutomationExecutorEnvironment = {
      getEndpointState: () => undefined,
      executeDeviceCommand: async () => {},
      activateScene: async () => {},
      callScript: async () => {},
      sendNotification: async () => {},
      now: () => new Date(),
    };
    const engine = new LocalAutomationEngine(dummyEnv);

    // Apply migration
    const snapshot = await migrator.applyMigration(diff, engine, async (entityId) => {
      disabledInHa.push(entityId);
    });

    expect(snapshot.createdHausRuleIds).toHaveLength(1);
    expect(snapshot.createdHausRuleIds[0]).toBe('automation.ha_evening_porch_light');
    expect(disabledInHa).toContain('automation.evening_porch_light');

    // Rollback
    await migrator.rollback(snapshot, engine, async (entityId) => {
      reEnabledInHa.push(entityId);
    });

    expect(reEnabledInHa).toContain('automation.evening_porch_light');
  });
});
