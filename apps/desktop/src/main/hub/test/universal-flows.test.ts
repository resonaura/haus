/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { HubCommissioningClient } from '../commissioning.js';
import { HubIntegrationFlowManager } from '../flows.js';
import { handleHubIntegrationRpc } from '../management/hub-requests.js';
import { normalizeCoreStepToHaStep } from '../management/normalize.js';

describe('universal Hub HA commissioning flows & RPC routing', () => {
  it('fetches frontend/get_translations from Hub for single and array domains', async () => {
    const calls: string[] = [];
    const ctx = {
      api: async (path: string) => {
        calls.push(path);
        if (path.includes('xiaomi_miot')) {
          return {
            category: 'config',
            resources: {
              'component.xiaomi_miot.config.step.user.title': 'Xiaomi Miot Auto',
              'component.xiaomi_miot.config.error.invalid_auth': 'Invalid Xiaomi token',
            },
          };
        }
        return {
          category: 'issues',
          resources: {
            'component.hue.issues.deprecated_firmware.title': 'Update Hue Bridge',
            'component.sonos.issues.network_issue.title': 'Sonos unreachable',
          },
        };
      },
      devices: [],
      flows: new HubIntegrationFlowManager(
        async () => ({}),
        async () => {},
      ),
      refreshDevices: async () => {},
      setCachedEntries: () => {},
    };

    const single = await handleHubIntegrationRpc(ctx, {
      type: 'frontend/get_translations',
      category: 'config',
      integration: 'xiaomi_miot',
    });
    expect(single.handled).toBe(true);
    if (single.handled) {
      const resources = (single.result as { resources: Record<string, string> }).resources;
      expect(resources['component.xiaomi_miot.config.step.user.title']).toBe('Xiaomi Miot Auto');
      expect(resources['component.xiaomi_miot.config.error.invalid_auth']).toBe(
        'Invalid Xiaomi token',
      );
    }

    const multi = await handleHubIntegrationRpc(ctx, {
      type: 'frontend/get_translations',
      category: 'issues',
      integration: ['hue', 'sonos'],
    });
    expect(calls[1]).toBe(
      '/api/commissioning/translations?category=issues&integrations=hue%2Csonos',
    );
    expect(multi.handled).toBe(true);
    if (multi.handled) {
      const resources = (multi.result as { resources: Record<string, string> }).resources;
      expect(resources['component.hue.issues.deprecated_firmware.title']).toBe('Update Hue Bridge');
      expect(resources['component.sonos.issues.network_issue.title']).toBe('Sonos unreachable');
    }
  });

  it('resolves ULID entry_id -> domain for options flows, forwards reauth & advanced options, and routes homekit_controller natively', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const manager = new HubIntegrationFlowManager(
      async (path, init) => {
        requests.push({ path, body: init?.body });
        if (path === '/api/discovery/homekit?timeoutMs=1500') {
          return { discovered: [], pairings: [] };
        }
        if (path === '/api/commissioning/discoveries') {
          return [
            {
              id: 'hk:aa:bb:cc:11:22:33',
              domain: 'homekit_controller',
              protocol: 'zeroconf',
              secondaryProtocols: [],
              name: 'Nanoleaf Essentials',
              authenticated: false,
              durableIdentities: [{ kind: 'mac', value: 'mac:aabbcc112233' }],
              addresses: ['192.168.5.77'],
              port: 80,
              status: 'discovered',
              details: {},
              discoveredAt: 1,
              updatedAt: 1,
            },
          ];
        }
        if (path === '/api/commissioning/flows' && init?.method === 'POST') {
          const body = (init.body ?? {}) as Record<string, unknown>;
          return {
            flowId: `ha_${String(body.domain)}_${String(body.source)}`,
            handler: body.domain,
            type: 'form',
            stepId: 'user',
            dataSchema: [{ name: 'code', type: 'string', required: true }],
          };
        }
        return {};
      },
      async () => {},
      async () => [],
      () => [{ entry_id: '01JZYXULIDENTRY0000000001', domain: 'sonos' }],
    );

    // 1. Options flow using ULID entry_id resolves real domain 'sonos'
    const optStep = (await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/options/flow',
      data: { handler: '01JZYXULIDENTRY0000000001' },
    })) as Record<string, unknown>;
    expect(optStep.handler).toBe('sonos');
    expect(requests.at(-1)).toMatchObject({
      path: '/api/commissioning/flows',
      body: { domain: 'sonos', source: 'options', entryId: '01JZYXULIDENTRY0000000001' },
    });

    // 2. Reauth flow forwards source='reauth' and reauthEntryId
    await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/flow',
      data: { handler: 'tuya', entry_id: 'e_tuya_1', reauth: true, show_advanced_options: true },
    });
    expect(requests.at(-1)).toMatchObject({
      path: '/api/commissioning/flows',
      body: {
        domain: 'tuya',
        source: 'reauth',
        entryId: 'e_tuya_1',
        reauthEntryId: 'e_tuya_1',
        showAdvancedOptions: true,
      },
    });

    // 3. Manual add of homekit_controller routes through Hub native commissioning (no bypass)
    const hkManual = (await manager.handleManagement({
      method: 'POST',
      path: 'config/config_entries/flow',
      data: { handler: 'homekit_controller' },
    })) as Record<string, unknown>;
    expect(hkManual.handler).toBe('homekit_controller');
    expect(requests.at(-1)).toMatchObject({
      path: '/api/commissioning/flows',
      body: { domain: 'homekit_controller', source: 'user' },
    });

    // 4. Discovered homekit_controller candidate routes natively via candidateId
    const progress = await manager.listFlowProgress();
    expect(progress).toHaveLength(1);
    await manager.handleManagement({
      method: 'GET',
      path: `config/config_entries/flow/${String(progress[0]?.flow_id)}`,
    });
    expect(requests.at(-1)).toMatchObject({
      path: '/api/commissioning/flows',
      body: {
        domain: 'homekit_controller',
        source: 'discovery',
        candidateId: 'hk:aa:bb:cc:11:22:33',
      },
    });
  });

  it('merges live HA progress flows ahead of candidates without duplicate cards', async () => {
    const manager = new HubIntegrationFlowManager(
      async (path) => {
        if (path === '/api/discovery/homekit?timeoutMs=1500') {
          return { discovered: [], pairings: [] };
        }
        if (path === '/api/commissioning/discoveries') {
          return [
            {
              id: 'hue:bsb002:192.168.5.88',
              domain: 'hue',
              protocol: 'zeroconf',
              secondaryProtocols: [],
              name: 'Philips Hue',
              authenticated: false,
              durableIdentities: [],
              addresses: ['192.168.5.88'],
              port: 443,
              status: 'discovered',
              details: {},
              discoveredAt: 1,
              updatedAt: 1,
            },
          ];
        }
        if (path === '/api/commissioning/flows/progress') {
          return {
            flows: [
              {
                flowId: 'ha_live_hue_1',
                handler: 'hue',
                stepId: 'link',
                title: 'Philips Hue (192.168.5.88)',
                context: { source: 'zeroconf', unique_id: 'hue-001788' },
              },
            ],
          };
        }
        if (path === '/api/commissioning/flows/ha_live_hue_1') {
          return {
            flowId: 'ha_live_hue_1',
            handler: 'hue',
            type: 'form',
            stepId: 'link',
            title: 'Press the link button',
            submitLabel: 'Link Bridge',
          };
        }
        return {};
      },
      async () => {},
      async () => [],
    );

    const progress = await manager.listFlowProgress();
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      flow_id: 'ha_live_hue_1',
      handler: 'hue',
      step_id: 'link',
    });

    const resumed = (await manager.handleManagement({
      method: 'GET',
      path: 'config/config_entries/flow/ha_live_hue_1',
    })) as Record<string, unknown>;
    expect(resumed).toMatchObject({
      flow_id: 'ha_live_hue_1',
      step_id: 'link',
      submit_label: 'Link Bridge',
    });
  });

  it('normalizes expandable sections, rich selectors, labels, and abort reason', () => {
    const step = normalizeCoreStepToHaStep(
      {
        flowId: 'f_norm',
        handler: 'zha',
        type: 'form',
        stepId: 'configure',
        submitLabel: 'Upload & Save',
        supportedBy: 'mqtt',
        translationDomain: 'mqtt',
        fieldLabels: { cert: 'Client Certificate', 'advanced.baudrate': 'Baud Rate' },
        dataDescriptions: { cert: 'PEM file' },
        selectorTranslations: { protocol: { znp: 'TI ZNP' } },
        dataSchema: [
          {
            name: 'cert',
            type: 'file',
            selector: { file: { accept: '.pem,.crt' } },
            required: true,
          },
          {
            name: 'advanced',
            type: 'expandable',
            expanded: true,
            schema: [{ name: 'baudrate', type: 'integer', defaultValue: 115200 }],
          },
        ],
      },
      'fallback',
    );
    expect(step.submit_label).toBe('Upload & Save');
    expect(step.supported_by).toBe('mqtt');
    expect(step.translation_domain).toBe('mqtt');
    expect(step.field_labels).toEqual({
      cert: 'Client Certificate',
      'advanced.baudrate': 'Baud Rate',
    });
    expect(step.selector_translations).toEqual({ protocol: { znp: 'TI ZNP' } });
    const schema = step.data_schema as Array<Record<string, unknown>>;
    expect(schema[0]).toMatchObject({ name: 'cert', selector: { file: { accept: '.pem,.crt' } } });
    expect(schema[1]).toMatchObject({
      name: 'advanced',
      type: 'expandable',
      expanded: true,
    });
    expect(Array.isArray(schema[1].schema)).toBe(true);

    const aborted = normalizeCoreStepToHaStep(
      { flowId: 'f_ab', handler: 'hue', type: 'abort', abortReason: 'already_configured' },
      'fallback',
    );
    expect(aborted.reason).toBe('already_configured');
  });

  it('routes commissioning/files, oauth/callback, and application-credentials in HubCommissioningClient', async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const client = new HubCommissioningClient(async (path, init) => {
      calls.push({ path, method: init?.method });
      return { ok: true };
    });

    await client.request({
      method: 'POST',
      path: 'commissioning/files',
      data: { filename: 'ca.pem', contentBase64: 'AAAA' },
    });
    await client.request({
      method: 'POST',
      path: 'commissioning/oauth/callback',
      data: { flowId: 'f1', code: 'abc' },
    });
    await client.request({ method: 'GET', path: 'commissioning/application-credentials' });
    await client.request({
      method: 'POST',
      path: 'commissioning/application-credentials',
      data: { domain: 'spotify', clientId: 'cid', clientSecret: 'sec' },
    });
    await client.request({
      method: 'DELETE',
      path: 'commissioning/application-credentials/spotify',
    });

    expect(calls).toEqual([
      { path: '/api/commissioning/files', method: 'POST' },
      { path: '/api/commissioning/oauth/callback', method: 'POST' },
      { path: '/api/commissioning/application-credentials', method: undefined },
      { path: '/api/commissioning/application-credentials', method: 'POST' },
      { path: '/api/commissioning/application-credentials/spotify', method: 'DELETE' },
    ]);
  });
});
