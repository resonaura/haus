/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { computeVerhoeff } from '../../src/commissioning/code-parser.js';
import {
  advanceDemoConfigFlow,
  buildDemoOnboardingState,
  buildFlowStartPayload,
  computeCommissioningHint,
  detectSetupCodeFormat,
  filterIntegrationChoices,
  formatDiscoverySource,
  isCompletedFlowStep,
  normalizeFlowMenuOptions,
  schemaDefaultsForFlow,
  startDemoConfigFlow,
  validateFlowFormValues,
} from '../../src/transport/onboarding.js';

describe('transport/onboarding helpers', () => {
  it('detects Matter, HomeKit, Improv, vendor codes, and proprietary limitations', () => {
    const base10 = '3497011233';
    const validMatter = `${base10}${computeVerhoeff(base10)}`;
    const badCheckDigit = `${base10}${(computeVerhoeff(base10) + 1) % 10}`;

    expect(detectSetupCodeFormat('MT:Y.K9042C00KA0648G00')).toMatchObject({
      valid: true,
      kind: 'matter-qr',
      protocol: 'matter',
    });
    expect(detectSetupCodeFormat(validMatter)).toMatchObject({
      valid: true,
      kind: 'matter-manual',
      protocol: 'matter',
    });
    expect(detectSetupCodeFormat(badCheckDigit)).toMatchObject({
      valid: false,
      kind: 'invalid',
      protocol: 'matter',
    });

    expect(detectSetupCodeFormat('482-91-635')).toMatchObject({
      valid: true,
      kind: 'homekit-pin',
      protocol: 'homekit',
    });
    expect(detectSetupCodeFormat('123-45-678')).toMatchObject({
      valid: false,
      kind: 'invalid',
      label: 'Weak HomeKit PIN',
    });
    expect(detectSetupCodeFormat('improv:ble:Lamp')).toMatchObject({
      valid: true,
      kind: 'improv',
      protocol: 'improv',
    });
    expect(detectSetupCodeFormat('shelly:plus1pm-192.168.1.20')).toMatchObject({
      valid: true,
      kind: 'vendor',
      protocol: 'vendor',
    });
    expect(detectSetupCodeFormat('aqara:proprietary-hub')).toMatchObject({
      valid: false,
      kind: 'unsupported_proprietary',
      badgeTone: 'warning',
    });
    expect(computeCommissioningHint('deadline exceeded')).toContain('pairing window');
  });

  it('extracts defaults, validates forms, and builds ConfigFlow payloads', () => {
    const schema = [
      { name: 'host', type: 'string', required: true, default: '192.168.1.42' },
      { name: 'port', type: 'integer', required: true, value_min: 1, value_max: 65535 },
      { name: 'tls', type: 'boolean', required: true },
      {
        name: 'auth',
        schema: [{ name: 'token', type: 'password', required: true }],
      },
    ];
    expect(schemaDefaultsForFlow(schema)).toEqual({
      host: '192.168.1.42',
      tls: false,
      auth: {},
    });

    expect(validateFlowFormValues(schema, { host: '', port: 70000, tls: false, auth: {} })).toEqual({
      host: 'required',
      port: 'above_max',
      'auth.token': 'required',
    });

    expect(
      normalizeFlowMenuOptions({
        type: 'menu',
        flow_id: 'f1',
        handler: 'tuya',
        menu_options: ['cloud', 'local'],
        menu_descriptions: { local: 'LAN only' },
      }),
    ).toEqual([
      { key: 'cloud', label: 'Cloud' },
      { key: 'local', label: 'Local', description: 'LAN only' },
    ]);

    expect(buildFlowStartPayload({ entryId: 'e1', reauth: true }, 'hue')).toEqual({
      handler: 'hue',
      entry_id: 'e1',
      reauth: true,
      source: 'reauth',
      reauth_entry_id: 'e1',
    });
    expect(formatDiscoverySource('zeroconf')).toBe('mDNS');
  });

  it('supports demo onboarding discovery, filtering, and multi-step flows', () => {
    const demo = buildDemoOnboardingState();
    expect(demo.discovered.map((item) => item.flowId)).toEqual([
      'demo-flow-hue',
      'demo-flow-matter',
      'demo-flow-homekit',
    ]);
    expect(filterIntegrationChoices(demo.catalog, 'philips')[0]?.domain).toBe('hue');

    const step1 = startDemoConfigFlow('tuya');
    expect(step1.type).toBe('menu');
    const step2 = advanceDemoConfigFlow(step1, { next_step_id: 'local' });
    expect(step2.type).toBe('form');
    const done = advanceDemoConfigFlow(step2, { host: '192.168.1.78', local_key: 'abc' });
    expect(isCompletedFlowStep(done)).toBe(true);
    expect(done.type).toBe('create_entry');
  });
});
