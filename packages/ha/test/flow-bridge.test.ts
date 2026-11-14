/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationFlowEngine } from '@haus/core';
import { HaFlowRuntime } from '@haus/kitsune';
import { afterAll, describe, expect, it } from 'vitest';
import { DynamicCatalogService } from '../src/catalog/dynamic.js';
import { evaluateFlowStep } from '../src/flow/index.js';
import { HaConfigFlowBridge, convertHaSchemaToFlowFields } from '../src/node/flow-bridge.js';

describe('HaConfigFlowBridge & Schema Conversion', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'haus-ha-bridge-test-'));
  let runtime: HaFlowRuntime | undefined;

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('converts expandable sections, selectors, suggested values, and localized selector options', () => {
    const fields = convertHaSchemaToFlowFields(
      [
        {
          name: 'mode',
          required: true,
          selector: {
            select: {
              options: ['fast', 'accurate'],
              translation_key: 'scan_mode',
              custom_value: true,
            },
          },
          description: { suggested_value: 'fast' },
        },
        {
          name: 'advanced',
          type: 'expandable',
          expanded: false,
          schema: [
            { name: 'retries', type: 'integer', optional: true, value_min: 1, value_max: 10 },
            { name: 'rgb', selector: { color_rgb: {} } },
          ],
        },
      ],
      {
        title: 'Demo',
        integrationTitle: 'Demo',
        flowTitle: null,
        stepTitle: 'Configure',
        description: null,
        submitLabel: 'Save',
        fieldLabels: {
          mode: 'Scan Mode',
          advanced: 'Advanced Settings',
          'advanced.retries': 'Max Retries',
        },
        dataDescriptions: {
          'advanced.retries': 'Number of retries before failing.',
        },
        errors: {},
        abortReason: null,
        menuOptions: {},
        menuOptionDescriptions: {},
        selectorTranslations: {
          'component.demo.selector.scan_mode.options.fast': 'Fast Scan',
          'component.demo.selector.scan_mode.options.accurate': 'Accurate Scan',
        },
        supportedBy: null,
      },
      'demo',
    );

    expect(fields).toBeDefined();
    expect(fields![0]).toMatchObject({
      name: 'mode',
      type: 'select',
      label: 'Scan Mode',
      suggestedValue: 'fast',
      custom: true,
      options: [
        { value: 'fast', label: 'Fast Scan' },
        { value: 'accurate', label: 'Accurate Scan' },
      ],
    });
    expect(fields![1]).toMatchObject({
      name: 'advanced',
      type: 'expandable',
      label: 'Advanced Settings',
      expanded: false,
    });
    expect(fields![1].schema?.[0]).toMatchObject({
      name: 'retries',
      type: 'integer',
      label: 'Max Retries',
      description: 'Number of retries before failing.',
      min: 1,
      max: 10,
      optional: true,
    });
    expect(fields![1].schema?.[1]?.type).toBe('color_rgb');
  });

  it('allows standalone Hub selectors and integrations without HA Web fallback', () => {
    const hubAssessment = evaluateFlowStep(
      {
        type: 'form',
        flow_id: 'flow_1',
        handler: 'bluetooth',
        step_id: 'user',
        data_schema: [
          { name: 'zone_loc', selector: { location: {} } },
          { name: 'color', selector: { color_rgb: {} } },
          { name: 'cert', selector: { file: {} } },
        ],
      },
      { mode: 'standalone-hub' },
    );

    expect(hubAssessment.supported).toBe(true);
    expect(hubAssessment.status).toBe('supported');
    expect(hubAssessment.fallbackUrl).toBeUndefined();
  });

  it('executes real HA flows through IntegrationFlowEngine (group menu, 3_day_blinds supported_by, tasmota discovery)', async () => {
    const catalog = new DynamicCatalogService({
      cachePath: join(tempRoot, 'missing-cache.json.gz'),
      translationsCachePath: join(tempRoot, 'missing-tr.json.gz'),
    });
    runtime = new HaFlowRuntime({
      configDir: join(tempRoot, 'config'),
      depsDir: join(tempRoot, 'deps'),
      autoInstallReqs: true,
      startupTimeoutMs: 45_000,
    });

    const bridge = new HaConfigFlowBridge(runtime, catalog);
    const engine = new IntegrationFlowEngine(undefined, undefined, bridge);

    expect(bridge.supportsDomain('group')).toBe(true);
    expect(bridge.supportsDomain('3_day_blinds')).toBe(true);
    expect(bridge.supportsDomain('spotify')).toBe(true);

    // 1. HA menu -> form flow ('group' helper)
    const groupInit = await engine.startFlow({
      domain: 'group',
      homeId: 'home_1',
      userId: 'user_1',
    });
    expect(groupInit.type).toBe('menu');
    expect(groupInit.handler).toBe('group');
    expect(groupInit.menuOptions).toBeDefined();

    const lightStep = await engine.submitStep({
      flowId: groupInit.flowId,
      homeId: 'home_1',
      userId: 'user_1',
      nextStepId: 'light',
      values: { next_step_id: 'light' },
    });
    expect(lightStep.type).toBe('form');
    expect(lightStep.dataSchema?.some((f) => f.name === 'name')).toBe(true);
    await engine.cancelFlowAsync(groupInit.flowId, { homeId: 'home_1', userId: 'user_1' });

    // 2. Virtual supported_by flow ('3_day_blinds' -> 'motion_blinds')
    const virtualStep = await engine.startFlow({
      domain: '3_day_blinds',
      homeId: 'home_1',
      userId: 'user_1',
    });
    expect(virtualStep.handler).toBe('motion_blinds');
    expect(virtualStep.supportedBy).toBe('3_day_blinds');
    await engine.cancelFlowAsync(virtualStep.flowId, { homeId: 'home_1', userId: 'user_1' });

    // 3. Discovery trigger ('tasmota' MQTT) -> progress list -> abort
    const disc = await bridge.triggerDiscovery({
      domain: 'tasmota',
      protocol: 'mqtt',
      discoveryKey: 'tasmota:test:tasmota_bridge_1',
      info: {
        topic: 'tasmota/discovery/AABBCCDDEEFF/config',
        payload: JSON.stringify({
          ip: '192.168.5.90',
          dn: 'Desk Lamp',
          fn: ['Desk Lamp'],
          hn: 'tasmota-test',
          mac: 'AABBCCDDEEFF',
          md: 'Generic',
          ofln: 'Offline',
          onln: 'Online',
          state: ['OFF', 'ON', 'TOGGLE', 'HOLD'],
          sw: '13.1.0',
          t: 'tasmota_test',
          ft: '%prefix%/%topic%/',
          tp: ['cmnd', 'stat', 'tele'],
          rl: [1, 0, 0, 0, 0, 0, 0, 0],
          swc: [-1, -1, -1, -1, -1, -1, -1, -1],
          swn: [null, null, null, null, null, null, null, null],
          btn: [0, 0, 0, 0],
          so: {
            '4': 0,
            '11': 0,
            '13': 0,
            '17': 0,
            '20': 0,
            '30': 0,
            '68': 0,
            '73': 0,
            '82': 0,
            '114': 0,
            '117': 0,
          },
          lk: 0,
          lt_st: 0,
          sho: [0, 0, 0, 0],
          sht: [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
          ver: 1,
        }),
      },
    });
    expect(disc.outcome).toBe('form');
    expect(disc.step).toBeDefined();
    expect(disc.step?.stepId).toBe('confirm');

    const progress = await engine.listProgressFlows('home_1');
    expect(progress.some((p) => p.handler === 'tasmota')).toBe(true);
    await bridge.abortFlow(disc.step!.flowId, 'discovery');
  }, 60_000);
});
