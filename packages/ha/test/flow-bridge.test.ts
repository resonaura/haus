/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationFlowEngine } from '@haus/core';
import { HaFlowRuntime, HaFlowWorkerError } from '@haus/kitsune';
import { afterAll, describe, expect, it, vi } from 'vitest';
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

  it('returns an actionable dependency failure without exposing compiler logs in the form', async () => {
    const failed = new HaFlowRuntime();
    vi.spyOn(failed, 'initFlow').mockRejectedValue(
      new HaFlowWorkerError('compiler log /private/build/path', {
        code: 'missing_requirements',
        missingRequirements: ['pyspeex-noise==1.0.2'],
      }),
    );
    const catalog = new DynamicCatalogService({ cachePath: join(tempRoot, 'missing.json.gz') });
    try {
      const step = await new HaConfigFlowBridge(failed, catalog).startFlow({ domain: 'esphome' });
      expect(step).toMatchObject({ type: 'abort', abortReason: 'requirements_install_failed' });
      expect(step?.title).not.toBe('esphome');
      expect(JSON.stringify(step)).not.toContain('/private/build/path');
    } finally {
      await failed.dispose();
    }
  });

  it('omits initialData on reconfigure and falls back to reauth when reconfigure throws UnknownStep', async () => {
    const mockRuntime = new HaFlowRuntime();
    const initSpy = vi
      .spyOn(mockRuntime, 'initFlow')
      .mockRejectedValueOnce(
        new HaFlowWorkerError("Handler AppleTVConfigFlow doesn't support step reconfigure", {
          code: 'UnknownStep',
        }),
      )
      .mockResolvedValueOnce({
        flowResult: {
          type: 'form',
          flow_id: 'flow_apple_tv_reauth',
          handler: 'apple_tv',
          step_id: 'restore_device',
          data_schema: [],
        },
        localized: {
          title: 'Apple TV',
          integrationTitle: 'Apple TV',
          flowTitle: 'Bedroom Apple TV (Apple TV)',
          stepTitle: 'Device reconfiguration',
          description: 'Reconfigure this device to restore its functionality.',
          submitLabel: null,
          fieldLabels: {},
          dataDescriptions: {},
          errors: {},
          abortReason: null,
          menuOptions: {},
          menuOptionDescriptions: {},
          selectorTranslations: {},
          supportedBy: null,
        },
      });
    const catalog = new DynamicCatalogService({
      cachePath: join(tempRoot, 'missing-reconf.json.gz'),
    });
    try {
      const step = await new HaConfigFlowBridge(mockRuntime, catalog).startFlow({
        domain: 'apple_tv',
        source: 'reconfigure',
        entryId: 'entry_apple_tv',
        initialData: { name: 'Bedroom Apple TV' },
      });
      expect(initSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          domain: 'apple_tv',
          source: 'reconfigure',
          entryId: 'entry_apple_tv',
          data: undefined,
        }),
      );
      expect(initSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          domain: 'apple_tv',
          source: 'reauth',
          entryId: 'entry_apple_tv',
          data: { name: 'Bedroom Apple TV' },
        }),
      );
      expect(step).toMatchObject({
        type: 'form',
        handler: 'apple_tv',
        stepId: 'restore_device',
        title: 'Device reconfiguration',
      });
    } finally {
      await mockRuntime.dispose();
    }
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

  it('uses native ESPHome manual and discovery forms through the same engine', async () => {
    const catalog = new DynamicCatalogService({ cachePath: join(tempRoot, 'catalog.json.gz') });
    runtime = new HaFlowRuntime({
      configDir: join(tempRoot, 'config'),
      depsDir: join(tempRoot, 'deps'),
      startupTimeoutMs: 60_000,
    });
    const bridge = new HaConfigFlowBridge(runtime, catalog);
    const engine = new IntegrationFlowEngine(undefined, undefined, bridge);
    const auth = { homeId: 'home_1', userId: 'user_1' };
    const manual = await engine.startFlow({ domain: 'esphome', ...auth });
    expect(manual).toMatchObject({ type: 'form', stepId: 'user' });
    expect(manual.dataSchema?.map((field) => field.name)).toEqual(['host', 'port']);
    await engine.cancelFlowAsync(manual.flowId, auth);

    const request = {
      domain: 'esphome',
      protocol: 'zeroconf',
      discoveryKey: 'mac:020000000001',
      info: {
        ipAddress: '192.0.2.4',
        port: 6053,
        type: '_esphomelib._tcp.local.',
        hostname: 'fixture.local.',
        name: 'fixture._esphomelib._tcp.local.',
        properties: { mac: '020000000001' },
      },
    };
    const discovery = await bridge.triggerDiscovery(request);
    expect(discovery.step).toMatchObject({ type: 'form', stepId: 'discovery_confirm' });
    expect((await bridge.triggerDiscovery(request)).outcome).toBe('already_in_progress');
    const resumed = await engine.startFlow({
      domain: 'esphome',
      source: 'discovery',
      candidateId: request.discoveryKey,
      ...auth,
    });
    expect(resumed.flowId).toBe(discovery.step?.flowId);
    await expect(
      engine.startFlow({
        domain: 'esphome',
        source: 'discovery',
        candidateId: 'mac:020000000002',
        ...auth,
      }),
    ).rejects.toThrow('discovery_flow_unavailable');
  }, 120_000);

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

  it('handles HaFlowWorkerError UnknownFlow with empty message across getFlow, abortFlow, and submitStep', async () => {
    const catalog = new DynamicCatalogService({
      cachePath: join(tempRoot, 'missing-cache.json.gz'),
      translationsCachePath: join(tempRoot, 'missing-tr.json.gz'),
    });
    const fakeRuntime = {
      getFlow: async () => {
        throw new HaFlowWorkerError('', { code: 'UnknownFlow' });
      },
      configureFlow: async () => {
        throw new HaFlowWorkerError('', { code: 'UnknownFlow' });
      },
      abortFlow: async () => {
        throw new HaFlowWorkerError('', { code: 'UnknownFlow' });
      },
    } as unknown as HaFlowRuntime;
    const bridge = new HaConfigFlowBridge(fakeRuntime, catalog);

    expect(await bridge.getFlow('stale_flow')).toBeUndefined();
    await expect(bridge.abortFlow('stale_flow')).resolves.toBeUndefined();
    await expect(
      bridge.submitStep({
        flowId: 'stale_flow',
        homeId: 'h',
        userId: 'u',
        values: { pin: '1927' },
      }),
    ).rejects.toThrow('flow_not_found');
  });

  it('maps template, color_temp, restricted/open country & language selectors and coerces numeric vol.In options', async () => {
    const rawSchema = [
      { name: 'prompt', required: true, selector: { template: {} } },
      { name: 'kelvin', optional: true, selector: { color_temp: { min: 2000, max: 6500 } } },
      {
        name: 'country_limited',
        required: true,
        selector: { country: { countries: ['US', 'UA'] } },
      },
      { name: 'country_any', optional: true, selector: { country: {} } },
      { name: 'lang_limited', optional: true, selector: { language: { languages: ['en', 'uk'] } } },
      { name: 'lang_any', optional: true, selector: { language: {} } },
      {
        name: 'api_version',
        type: 'select',
        required: true,
        options: [
          [1, 'v1'],
          [6, 'v6'],
        ],
      },
      { name: 'port', type: 'integer', optional: true },
    ];
    const fields = convertHaSchemaToFlowFields(rawSchema, undefined, 'demo');
    expect(fields?.find((f) => f.name === 'prompt')?.type).toBe('text');
    expect(fields?.find((f) => f.name === 'kelvin')).toMatchObject({
      type: 'number',
      min: 2000,
      max: 6500,
    });
    expect(fields?.find((f) => f.name === 'country_limited')).toMatchObject({
      type: 'select',
      choices: ['US', 'UA'],
    });
    expect(fields?.find((f) => f.name === 'country_any')?.type).toBe('string');
    expect(fields?.find((f) => f.name === 'lang_limited')).toMatchObject({
      type: 'select',
      choices: ['en', 'uk'],
    });
    expect(fields?.find((f) => f.name === 'lang_any')?.type).toBe('string');

    let capturedInput: Record<string, unknown> | undefined;
    const catalog = new DynamicCatalogService({
      cachePath: join(tempRoot, 'missing-cache.json.gz'),
      translationsCachePath: join(tempRoot, 'missing-tr.json.gz'),
    });
    const fakeRuntime = {
      initFlow: async () => ({
        flowResult: {
          type: 'form',
          flow_id: 'f_coerce',
          handler: 'philips_js',
          step_id: 'user',
          data_schema: rawSchema,
        },
      }),
      configureFlow: async (req: { userInput?: Record<string, unknown> }) => {
        capturedInput = req.userInput;
        return {
          flowResult: { type: 'abort', flow_id: 'f_coerce', handler: 'philips_js', reason: 'done' },
        };
      },
    } as unknown as HaFlowRuntime;
    const bridge = new HaConfigFlowBridge(fakeRuntime, catalog);
    await bridge.startFlow({ domain: 'philips_js', homeId: 'h', userId: 'u' });
    await bridge.submitStep({
      flowId: 'f_coerce',
      homeId: 'h',
      userId: 'u',
      values: {
        prompt: '{{ states("sensor.temp") }}',
        country_limited: 'UA',
        api_version: '6',
        port: '1925',
        kelvin: '',
      },
    });
    expect(capturedInput).toEqual({
      prompt: '{{ states("sensor.temp") }}',
      country_limited: 'UA',
      api_version: 6,
      port: 1925,
    });
  });
});
