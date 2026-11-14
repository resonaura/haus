/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { IntegrationFlowEngine } from '@haus/core';
import { buildView } from '../entities.js';
import { buildHubConfigEntries, configEntryIdForDevice } from '../flow-entries.js';
import { HubIntegrationFlowManager } from '../flows.js';
import { handleHubIntegrationRpc } from '../management/hub-requests.js';
import { hubFlowTranslations, normalizeCoreStepToHaStep } from '../management/normalize.js';
import { computeHaIntegrationMetadata, computeHaUpdates } from '@haus/ha/native/updates';
import type { HubDevice } from '../types.js';

describe('Hub flow normalization and HA parity', () => {
  it('translates multi-step Core xiaomi_miot and tuya flows cleanly to HA snake_case', async () => {
    const engine = new IntegrationFlowEngine();
    const first = await engine.startFlow({
      domain: 'xiaomi_miot',
      homeId: 'home-1',
      userId: 'user-1',
    });

    const haFirst = normalizeCoreStepToHaStep(first);
    expect(haFirst.type).toBe('menu');
    expect(haFirst.flow_id).toBe(first.flowId);
    expect(haFirst.handler).toBe('xiaomi_miot');
    expect(haFirst.step_id).toBe('user');
    expect(haFirst.menu_options).toBeTruthy();

    const cloudForm = await engine.submitStep({
      flowId: first.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      nextStepId: 'cloud',
      values: { next_step_id: 'cloud' },
    });
    const haCloud = normalizeCoreStepToHaStep(cloudForm);
    expect(haCloud.type).toBe('form');
    expect(haCloud.step_id).toBe('cloud');
    const schema = haCloud.data_schema as Array<Record<string, unknown>>;
    expect(schema.some((f) => f.name === 'username')).toBe(true);
    const pwdField = schema.find((f) => f.name === 'password');
    expect((pwdField?.selector as { text?: { type?: string } })?.text?.type).toBe('password');

    const tuyaFirst = await engine.startFlow({
      domain: 'tuya',
      homeId: 'home-1',
      userId: 'user-1',
    });
    const haTuya = normalizeCoreStepToHaStep(tuyaFirst);
    expect(haTuya.flow_id).toBe(tuyaFirst.flowId);
    expect(haTuya.documentation_url).toBe('https://www.home-assistant.io/integrations/tuya/');
  });

  it('routes tuya flow start & multi-step submit through HubIntegrationFlowManager without losing flowId or falling back to unsupported_flow', async () => {
    const engine = new IntegrationFlowEngine();
    const api = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === '/api/commissioning/flows' && init?.method === 'POST') {
        const body = init.body as { domain: string; source?: string };
        return engine.startFlow({
          domain: body.domain,
          source: (body.source as 'user') ?? 'user',
          homeId: 'home-1',
          userId: 'user-1',
        });
      }
      const stepMatch = /^\/api\/commissioning\/flows\/([^/]+)\/step$/.exec(path);
      if (stepMatch && init?.method === 'POST') {
        const body = init.body as {
          values?: Record<string, unknown>;
          nextStepId?: string;
          stepId?: string;
        };
        return engine.submitStep({
          flowId: decodeURIComponent(stepMatch[1]),
          homeId: 'home-1',
          userId: 'user-1',
          nextStepId: body.nextStepId,
          stepId: body.stepId,
          values: body.values ?? {},
        });
      }
      if (
        path.startsWith('/api/discovery/homekit') ||
        path.startsWith('/api/commissioning/discoveries')
      ) {
        return { discovered: [], pairings: [] };
      }
      return {};
    });

    const refreshDevices = vi.fn(async () => {});
    const manager = new HubIntegrationFlowManager(api, refreshDevices);

    const step1 = (await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/flow',
      data: { handler: 'tuya' },
    })) as Record<string, unknown>;
    expect(step1.type).toBe('form');
    expect(step1.step_id).toBe('user');
    expect(step1.handler).toBe('tuya');
    expect(typeof step1.flow_id).toBe('string');
    const step1Schema = step1.data_schema as Array<Record<string, unknown>>;
    expect(step1Schema.map((f) => f.name)).toEqual(['user_code']);

    const step2 = (await manager.handleManagement({
      method: 'POST',
      path: `config/config_entries/flow/${String(step1.flow_id)}`,
      data: { user_code: 'u123456789' },
    })) as Record<string, unknown>;
    expect(step2.type).toBe('form');
    expect(step2.step_id).toBe('scan');
    const scanSchema = step2.data_schema as Array<Record<string, unknown>>;
    const scanQr = scanSchema.find((f) => f.name === 'QR');
    expect(scanQr?.type).toBe('qr_code');
    expect(
      (scanQr?.selector as { qr_code?: { data?: string; error_correction_level?: string } })
        ?.qr_code?.data,
    ).toMatch(/^tuyaSmart--qrLogin\?token=/);
    expect(
      (scanQr?.selector as { qr_code?: { error_correction_level?: string } })?.qr_code
        ?.error_correction_level,
    ).toBe('Q');

    const step3 = (await manager.handleManagement({
      method: 'POST',
      path: `config/config_entries/flow/${String(step1.flow_id)}`,
      data: {},
    })) as Record<string, unknown>;
    expect(step3.type).toBe('create_entry');
    expect(step3.handler).toBe('tuya');
    expect((step3.result as { title?: string })?.title).toBe('Tuya (u123456789)');

    const tuyaConfigTrans = hubFlowTranslations('config', 'tuya') as {
      component: {
        tuya: {
          config: {
            step: {
              user: { description: string; data: { user_code: string } };
              scan: { data: { QR: string } };
            };
            error: { required: string };
          };
        };
      };
    };
    expect(tuyaConfigTrans.component.tuya.config.step.user.description).toContain(
      '**Settings > Account and Security**',
    );
    expect(tuyaConfigTrans.component.tuya.config.step.user.data.user_code).toBe('User code');
    expect(tuyaConfigTrans.component.tuya.config.step.scan.data.QR).toBe('QR code');
    expect(tuyaConfigTrans.component.tuya.config.error.required).toBe('Required');

    const qrStep = normalizeCoreStepToHaStep({
      type: 'form',
      flowId: 'qr-flow',
      handler: 'tuya',
      stepId: 'scan',
      dataSchema: [
        { name: 'qr', type: 'qr_code', label: 'Scan QR', defaultValue: 'tuya://pair?token=xyz' },
      ],
    });
    const qrField = (qrStep.data_schema as Array<Record<string, unknown>>).find(
      (f) => f.name === 'qr',
    );
    expect(qrField?.type).toBe('qr_code');
    expect((qrField?.selector as { qr_code?: { data?: string } })?.qr_code?.data).toBe(
      'tuya://pair?token=xyz',
    );
  });

  it('links devices and entities across all Hub integration domains and builds unified config entries', () => {
    const persisted = [
      {
        entry_id: 'tuya_acc_1',
        domain: 'tuya',
        title: 'Tuya Main',
        state: 'loaded',
        disabled_by: null,
      },
      {
        entry_id: 'hb_govee',
        domain: 'homebridge-govee',
        title: 'Homebridge Govee',
        state: 'loaded',
        disabled_by: null,
      },
      {
        entry_id: 'xiaomi_acc_1',
        domain: 'xiaomi_miot',
        title: 'Xiaomi: 8210526797',
        state: 'setup_error',
        reason: 'Xiaomi authentication failed for this account',
        disabled_by: null,
      },
    ];

    const devices: HubDevice[] = [
      {
        id: 'tuya:plug_1',
        sourceInstanceId: 'tuya_acc_1',
        name: 'Office Plug',
        category: 'power',
        availability: 'online',
        protocol: 'tuya',
        endpoints: [
          {
            id: 'ep1',
            name: 'Endpoint 1',
            capabilities: [{ id: 'on_off', kind: 'binary', operations: ['set'] }],
          },
        ],
      },
      {
        id: 'hb:govee_strip',
        sourceInstanceId: 'homebridge:homebridge-govee',
        name: 'LED Strip',
        category: 'lighting',
        availability: 'online',
        protocol: 'homebridge',
        endpoints: [
          {
            id: 'ep1',
            name: 'Endpoint 1',
            capabilities: [{ id: 'on_off', kind: 'binary', operations: ['set'] }],
          },
        ],
      },
    ];

    expect(configEntryIdForDevice(devices[0], persisted)).toBe('tuya_acc_1');
    expect(configEntryIdForDevice(devices[1], persisted)).toBe('hb_govee');

    const view = buildView(devices, {}, undefined, persisted);
    expect((view.devices[0] as { config_entries?: string[] }).config_entries).toEqual([
      'tuya_acc_1',
    ]);
    expect((view.entities[1] as { config_entry_id?: string }).config_entry_id).toBe('hb_govee');

    const entries = buildHubConfigEntries(devices, [], undefined, { entries: persisted });
    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.entry_id === 'xiaomi_acc_1')?.state).toBe('setup_error');
  });

  it('handles repairs, unified updates, and HA update derivation consistently', async () => {
    const rpcRes = await handleHubIntegrationRpc(
      {
        api: async (path) => {
          if (path === '/api/repairs') {
            return {
              issues: [
                {
                  domain: 'xiaomi_miot',
                  issue_id: 'reauth_xiaomi_1',
                  severity: 'error',
                  title: 'Authentication expired for Xiaomi: 8210526797',
                  is_fixable: true,
                  is_persistent: true,
                  ignored: false,
                  created: '2026-11-01T00:00:00Z',
                },
              ],
            };
          }
          if (path === '/api/updates') {
            return {
              checkedAt: '2026-11-13T00:00:00Z',
              total: 1,
              availableCount: 1,
              items: [
                {
                  id: 'hacs:xiaomi_miot',
                  domain: 'xiaomi_miot',
                  title: 'Xiaomi Miot Auto',
                  category: 'hacs',
                  installedVersion: '1.1.4',
                  latestVersion: '1.1.5',
                  updateAvailable: true,
                  canInstall: true,
                  checkedAt: '2026-11-13T00:00:00Z',
                },
              ],
            };
          }
          return {};
        },
        devices: [],
        flows: new HubIntegrationFlowManager(
          async () => ({}),
          async () => {},
        ),
        refreshDevices: async () => {},
        setCachedEntries: () => {},
      },
      { type: 'repairs/list_issues' },
    );
    expect(rpcRes.handled).toBe(true);
    if (rpcRes.handled) {
      const issues = (rpcRes.result as { issues: Array<{ domain: string }> }).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].domain).toBe('xiaomi_miot');
    }

    const haUpdates = await computeHaUpdates(async (msg) => {
      if (msg.type === 'get_states') {
        return [
          {
            entity_id: 'update.home_assistant_core_update',
            state: 'on',
            attributes: {
              title: 'Home Assistant Core',
              installed_version: '2026.10.2',
              latest_version: '2026.11.1',
            },
          },
        ] as never;
      }
      if (msg.type === 'hacs/repositories/list') {
        return [
          {
            id: 42,
            name: 'Xiaomi Miot Auto',
            domain: 'xiaomi_miot',
            full_name: 'al-one/hass-xiaomi-miot',
            category: 'integration',
            installed: true,
            installed_version: '1.1.4',
            available_version: '1.1.5',
            pending_upgrade: true,
          },
        ] as never;
      }
      return null as never;
    });
    expect(haUpdates.availableCount).toBe(2);
    expect(haUpdates.items.map((i) => i.id)).toContain('hacs:42');

    const meta = await computeHaIntegrationMetadata(async (msg) => {
      if (msg.type === 'config_entries/get') {
        return [
          { entry_id: 'e1', domain: 'xiaomi_miot', title: 'Xiaomi', state: 'setup_error' },
        ] as never;
      }
      if (msg.type === 'manifest/list') {
        return [
          {
            domain: 'xiaomi_miot',
            name: 'Xiaomi Miot',
            version: '1.1.5',
            iot_class: 'cloud_polling',
            is_built_in: false,
          },
        ] as never;
      }
      if (msg.type === 'config/device_registry/list') {
        return [
          { id: 'd1', config_entries: ['e1'] },
          { id: 'd2', config_entries: ['e1'] },
        ] as never;
      }
      if (msg.type === 'config/entity_registry/list') {
        return [{ entity_id: 'switch.p1', config_entry_id: 'e1', device_id: 'd1' }] as never;
      }
      return [] as never;
    });
    expect(meta[0]).toMatchObject({
      domain: 'xiaomi_miot',
      deviceCount: 2,
      entityCount: 1,
      brokenCount: 1,
      runtimeType: 'custom_integration',
    });

    const translations = hubFlowTranslations('title') as {
      component: Record<string, { title: string }>;
    };
    expect(translations.component.tuya.title).toBe('Tuya');
    expect(translations.component.xiaomi_miot).toBeUndefined();
  });

  it('exposes Hub-synced Tuya cameras to TuyaCameraFollowup and includes reauth translations', () => {
    const tuyaTrans = hubFlowTranslations('config', 'tuya') as {
      component: {
        tuya: { config: { step: Record<string, unknown>; error: Record<string, string> } };
      };
    };
    expect(tuyaTrans.component.tuya.config.step.reauth_confirm).toBeTruthy();
    expect(tuyaTrans.component.tuya.config.step.reauth_user_code).toBeTruthy();
    expect(tuyaTrans.component.tuya.config.error.login_error).toBe('Login error ({code}): {msg}');

    const entry = {
      entry_id: 'entry_tuya_1',
      domain: 'tuya',
      title: 'alice@smartlife',
      state: 'loaded',
      disabled_by: null,
    };
    const camDevice: HubDevice = {
      id: 'tuya:cam_1',
      sourceInstanceId: 'entry_tuya_1',
      name: 'Kitchen Cam',
      category: 'cameras',
      availability: 'online',
      protocol: 'local_ip',
      endpoints: [
        {
          id: 'ep_tuya_cam_1_camera',
          name: 'Kitchen Cam',
          capabilities: [{ id: 'video', kind: 'camera', operations: ['stream'] }],
        },
      ],
    };

    const view = buildView([camDevice], {}, undefined, [entry]);
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({
      id: 'tuya:cam_1',
      name: 'Kitchen Cam',
      config_entries: ['entry_tuya_1'],
    });
    expect(view.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_id: expect.stringMatching(/^camera\./),
          config_entry_id: 'entry_tuya_1',
          device_id: 'tuya:cam_1',
          original_name: 'Kitchen Cam',
        }),
      ]),
    );
  });
});
