/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { computeVerhoeff } from '../../src/commissioning/code-parser.js';
import {
  advanceDemoConfigFlow,
  buildBrandIntegrationCatalog,
  buildDemoOnboardingState,
  buildFlowStartPayload,
  computeCommissioningHint,
  countBrandCatalogEcosystems,
  createFlowLocalization,
  detectSetupCodeFormat,
  extractFlowErrorMessage,
  filterBrandIntegrationCatalog,
  filterIntegrationChoices,
  flowEyebrowLabel,
  formatDiscoverySource,
  isCompletedFlowStep,
  normalizeFlowMenuOptions,
  normalizeLocalizedMenuOptions,
  parseOAuthCallbackInput,
  resolveStepDocumentationUrl,
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

    expect(validateFlowFormValues(schema, { host: '', port: 70000, tls: false, auth: {} })).toEqual(
      {
        host: 'required',
        port: 'above_max',
        'auth.token': 'required',
      },
    );

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

    const repairStep = startDemoConfigFlow('zha', 'Zigbee Home', {
      repair: { domain: 'zha', issue_id: 'zigbee_channel_overlap' },
    });
    expect(repairStep.type).toBe('form');
    expect(repairStep.data_schema?.[0]?.name).toBe('channel');
    const repairDone = advanceDemoConfigFlow(repairStep, { channel: '25', backup_first: true });
    expect(isCompletedFlowStep(repairDone)).toBe(true);

    const reauthStep = startDemoConfigFlow('hue', 'Philips Hue', {
      reauth: true,
      entryId: 'hue-1',
    });
    expect(reauthStep.step_id).toBe('reauth_confirm');
    const reauthDone = advanceDemoConfigFlow(reauthStep, { username: 'a', password: 'b' });
    expect(reauthDone.type).toBe('abort');
    expect(reauthDone.reason).toBe('reauth_successful');
    expect(isCompletedFlowStep(reauthDone)).toBe(true);
  });

  it('localizes HA config/repair/options steps, groups vendor ecosystems, and parses OAuth callbacks', () => {
    const loc = createFlowLocalization({
      domain: 'zha',
      integrationTitle: 'Zigbee Home',
      repair: { domain: 'zha', issue_id: 'zigbee_channel_overlap' },
      step: {
        type: 'form',
        flow_id: 'f-repair',
        handler: 'zha',
        step_id: 'confirm',
        description_placeholders: { channel: '25' },
        data_schema: [{ name: 'target_channel', type: 'select', options: ['15', '25'] }],
      },
      translations: {
        'component.zha.issues.zigbee_channel_overlap.fix_flow.step.confirm.title':
          'Migrate mesh to channel {channel}',
        'component.zha.issues.zigbee_channel_overlap.fix_flow.step.confirm.description':
          'Switching to channel {channel} avoids Wi-Fi interference.',
        'component.zha.issues.zigbee_channel_overlap.fix_flow.step.confirm.data.target_channel':
          'Zigbee channel',
        'component.zha.issues.zigbee_channel_overlap.fix_flow.error.invalid_auth':
          'Invalid coordinator credentials',
        'component.zha.selector.target_channel.options.25': 'Channel 25 (Clean)',
      },
    });
    expect(loc.title).toBe('Migrate mesh to channel 25');
    expect(loc.description).toBe('Switching to channel 25 avoids Wi-Fi interference.');
    expect(loc.fieldLabel('target_channel')).toBe('Zigbee channel');
    expect(loc.errorText('invalid_auth')).toBe('Invalid coordinator credentials');
    expect(loc.selectorOptions('target_channel')).toEqual({ '25': 'Channel 25 (Clean)' });
    expect(flowEyebrowLabel({ repair: { domain: 'zha', issue_id: 'x' } })).toBe(
      'REPAIR INTEGRATION',
    );
    expect(resolveStepDocumentationUrl(null, 'hue')).toBe(
      'https://www.home-assistant.io/integrations/hue',
    );

    const menuOpts = normalizeLocalizedMenuOptions(
      {
        type: 'menu',
        flow_id: 'm1',
        handler: 'tuya',
        step_id: 'user',
        menu_options: ['cloud', 'local'],
      },
      createFlowLocalization({
        domain: 'tuya',
        step: { type: 'menu', flow_id: 'm1', handler: 'tuya', step_id: 'user' },
        translations: {
          'component.tuya.config.step.user.menu_options.cloud': 'Tuya Cloud Sign-in',
          'component.tuya.config.step.user.menu_option_descriptions.cloud': 'Scan QR in Smart Life',
        },
      }),
    );
    expect(menuOpts[0]).toEqual({
      key: 'cloud',
      label: 'Tuya Cloud Sign-in',
      description: 'Scan QR in Smart Life',
    });

    const demo = buildDemoOnboardingState();
    const names = Object.fromEntries(demo.catalog.map((c) => [c.domain, c.title]));
    const brands = buildBrandIntegrationCatalog(
      demo.catalog.map((c) => c.domain),
      names,
      demo.ecosystemApps,
    );
    const counts = countBrandCatalogEcosystems(brands);
    expect(counts.all).toBeGreaterThan(0);
    expect(counts.homebridge).toBeGreaterThan(0);
    expect(counts.scrypted).toBeGreaterThan(0);
    expect(counts.hacs).toBeGreaterThan(0);
    const govee = filterBrandIntegrationCatalog(brands, 'govee')[0];
    expect(govee?.isCombinedHausGovee).toBe(true);
    expect(govee?.driverCount ?? 0).toBeGreaterThanOrEqual(3);

    expect(
      parseOAuthCallbackInput('https://my.home-assistant.io/redirect/oauth?code=abc123&state=s9'),
    ).toEqual({ code: 'abc123', state: 's9' });
    expect(parseOAuthCallbackInput('raw-auth-code')).toEqual({ code: 'raw-auth-code' });
    expect(extractFlowErrorMessage('integration_entity_conflict')).toContain(
      'entity ID is already',
    );
  });
});
