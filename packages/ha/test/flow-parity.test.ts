/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchAllDiscoveryRules, type DiscoveryMatcherRule } from '@haus/core';
import { HaCatalogTranslations, HaIntegrationCatalog } from '../src/catalog/index.js';
import { evaluateFlowStep, type FlowStep, type FormField } from '../src/flow/index.js';

const CATALOG_PATH = existsSync(resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz'))
  ? resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz')
  : resolve('data/ha-catalog-2024.12.5.json.gz');

const TRANSLATIONS_PATH = existsSync(resolve('packages/ha/data/ha-translations-2024.12.5.json.gz'))
  ? resolve('packages/ha/data/ha-translations-2024.12.5.json.gz')
  : resolve('data/ha-translations-2024.12.5.json.gz');

const COMPLEX_SCHEMA: readonly FormField[] = [
  { name: 'host', type: 'string', required: true },
  { name: 'ca_cert', selector: { file: { accept: '.pem,.crt' } } },
  { name: 'coordinates', selector: { location: { radius: true } } },
  { name: 'timeout', selector: { duration: { enable_day: false } } },
  { name: 'rgb', selector: { color_rgb: {} } },
  { name: 'temp', selector: { color_temp: { unit: 'kelvin', min: 2000, max: 6500 } } },
  { name: 'attr', selector: { attribute: { entity_id: 'light.kitchen' } } },
  { name: 'badge_icon', selector: { icon: { placeholder: 'mdi:home' } } },
  { name: 'schedule_at', selector: { datetime: {} } },
  { name: 'qr', selector: { qr_code: { data: 'MT:12345' } } },
  { name: 'const_flag', selector: { constant: { value: true } } },
  { name: 'mode', selector: { select: { options: ['auto', 'manual'], custom_value: true } } },
  {
    name: 'advanced_section',
    type: 'expandable',
    schema: [
      { name: 'verify_ssl', selector: { boolean: {} } },
      { name: 'notes', selector: { text: { multiline: true } } },
    ],
  },
];

const ALL_STEP_TYPES = [
  'form',
  'menu',
  'external',
  'progress',
  'progress_done',
  'external_done',
  'create_entry',
  'abort',
] as const;

describe('Universal Catalog Flow & 7-Protocol Discovery Parity', () => {
  const catalog = HaIntegrationCatalog.fromFile(CATALOG_PATH, true);
  const translations = HaCatalogTranslations.fromFile(TRANSLATIONS_PATH);

  it('supports every configFlow and supported_by integration in standalone-hub mode across all selectors and step types', () => {
    expect(catalog.getTotalCount()).toBe(1303);

    const configFlowManifests = catalog.query({ configFlow: true });
    expect(configFlowManifests.length).toBe(699);

    const supportedByDomains = Object.keys(translations.getAllSupportedBy());
    expect(supportedByDomains.length).toBeGreaterThan(0);

    const candidateDomains = new Set<string>([
      ...configFlowManifests.map((m) => m.domain),
      ...supportedByDomains,
    ]);

    for (const manifest of catalog.getAllManifests()) {
      if (manifest.supported_by) {
        candidateDomains.add(manifest.domain);
      }
      const title = manifest.name || translations.getIntegrationTitle(manifest.domain);
      expect(typeof title === 'string' && title.trim().length > 0).toBe(true);
    }

    for (const domain of candidateDomains) {
      const formStep: FlowStep = {
        type: 'form',
        flow_id: `flow-${domain}`,
        handler: domain,
        step_id: 'user',
        data_schema: COMPLEX_SCHEMA,
      };
      const formEval = evaluateFlowStep(formStep, { mode: 'standalone-hub' });
      expect(formEval.supported).toBe(true);
      expect(formEval.unsupportedRequirements).toHaveLength(0);
      expect(formEval.fallbackUrl).toBeUndefined();

      for (const stepType of ALL_STEP_TYPES) {
        const step: FlowStep = {
          type: stepType,
          flow_id: `flow-${domain}-${stepType}`,
          handler: domain,
          step_id: stepType,
          ...(stepType === 'external' ? { url: 'https://example.test/oauth' } : {}),
          ...(stepType === 'menu' ? { menu_options: ['one', 'two'] } : {}),
        };
        const stepEval = evaluateFlowStep(step, { mode: 'standalone-hub' });
        expect(stepEval.supported).toBe(true);
        expect(stepEval.fallbackUrl).toBeUndefined();
      }
    }

    for (const [virtualDomain, parentDomain] of Object.entries(translations.getAllSupportedBy())) {
      const parentManifest = catalog.getManifest(parentDomain);
      expect(parentManifest).toBeDefined();
      expect(translations.resolveSupportedBy(virtualDomain)).toBe(parentDomain);
      expect(translations.hasFlowHandler(virtualDomain)).toBe(Boolean(parentManifest?.config_flow));
      const title =
        catalog.getManifest(virtualDomain)?.name ?? translations.getIntegrationTitle(virtualDomain);
      expect(typeof title === 'string' && title.trim().length > 0).toBe(true);
    }

    const ippConfig = translations.getFlattenedCategory('config', ['ipp']);
    expect(Object.keys(ippConfig).some((k) => k.startsWith('component.ipp.config.'))).toBe(true);
  });

  it('validates catalog discovery matchers and resolves probes across all 7 protocols', () => {
    const manifestRules = catalog.getDiscoveryMatcherRules();
    const hkModels = translations.getAllHomeKitModels();

    const byProtocol = {
      zeroconf: catalog.query({ hasDiscoveryMatcher: 'zeroconf' }),
      ssdp: catalog.query({ hasDiscoveryMatcher: 'ssdp' }),
      dhcp: catalog.query({ hasDiscoveryMatcher: 'dhcp' }),
      bluetooth: catalog.query({ hasDiscoveryMatcher: 'bluetooth' }),
      usb: catalog.query({ hasDiscoveryMatcher: 'usb' }),
      mqtt: catalog.query({ hasDiscoveryMatcher: 'mqtt' }),
      homekit: Object.entries(hkModels),
    };

    expect(byProtocol.zeroconf.length).toBe(79);
    expect(byProtocol.ssdp.length).toBe(38);
    expect(byProtocol.dhcp.length).toBe(72);
    expect(byProtocol.bluetooth.length).toBe(42);
    expect(byProtocol.usb.length).toBe(7);
    expect(byProtocol.mqtt.length).toBe(5);
    expect(byProtocol.homekit.length).toBe(68);

    const enrichedRules: DiscoveryMatcherRule[] = manifestRules.map((rule) => {
      const domainModels = Object.entries(hkModels)
        .filter(([, meta]) => meta.domain === rule.domain)
        .map(([model, meta]) => ({ model, alwaysDiscover: meta.alwaysDiscover }));
      if (domainModels.length === 0) return rule;
      return {
        ...rule,
        homekit: {
          models: Array.from(
            new Set([...(rule.homekit?.models ?? []), ...domainModels.map((entry) => entry.model)]),
          ),
          alwaysDiscover: domainModels.every((entry) => entry.alwaysDiscover),
        },
      };
    });

    const zeroconfMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'zeroconf',
      host: '192.168.1.10',
      name: 'Philips hue - ABCDEF',
      details: { serviceType: '_hue._tcp.local.' },
    }).map((m) => m.rule.domain);
    expect(zeroconfMatches).toContain('hue');

    const ssdpMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'ssdp',
      host: '192.168.1.20',
      details: {
        st: 'roku:ecp',
        manufacturer: 'Roku',
        deviceType: 'urn:roku-com:device:player:1-0',
      },
    }).map((m) => m.rule.domain);
    expect(ssdpMatches).toContain('roku');

    const dhcpSample = byProtocol.dhcp.find((m) =>
      m.dhcp?.some((d) => typeof d.hostname === 'string' && !d.hostname.includes('*')),
    );
    expect(dhcpSample).toBeDefined();
    const dhcpMatcher = dhcpSample?.dhcp?.find(
      (d) => typeof d.hostname === 'string' && !d.hostname.includes('*'),
    );
    const macPrefix =
      typeof dhcpMatcher?.macaddress === 'string'
        ? dhcpMatcher.macaddress
            .replace(/[^a-fA-F0-9]/g, '')
            .padEnd(12, '1')
            .slice(0, 12)
        : 'AABBCC112233';
    const macFormatted = macPrefix.match(/.{2}/g)?.join(':') ?? 'AA:BB:CC:11:22:33';
    const dhcpMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'dhcp',
      mac: macFormatted,
      host: String(dhcpMatcher?.hostname ?? ''),
      details: { hostname: String(dhcpMatcher?.hostname ?? '') },
    }).map((m) => m.rule.domain);
    expect(dhcpMatches).toContain(dhcpSample?.domain);

    const bleSample = byProtocol.bluetooth.find((m) =>
      m.bluetooth?.some(
        (b) =>
          typeof b.local_name === 'string' &&
          !String(b.local_name).includes('*') &&
          b.manufacturer_id === undefined &&
          !b.service_uuid &&
          !b.service_data_uuid,
      ),
    );
    expect(bleSample).toBeDefined();
    const bleMatcher = bleSample?.bluetooth?.find(
      (b) =>
        typeof b.local_name === 'string' &&
        !String(b.local_name).includes('*') &&
        b.manufacturer_id === undefined &&
        !b.service_uuid &&
        !b.service_data_uuid,
    );
    const bleMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'bluetooth',
      name: String(bleMatcher?.local_name ?? ''),
      details: { local_name: String(bleMatcher?.local_name ?? '') },
    }).map((m) => m.rule.domain);
    expect(bleMatches).toContain(bleSample?.domain);

    const bthomeMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'bluetooth',
      name: 'ATC_1234',
      details: {
        connectable: false,
        service_data_uuid: '0000fcd2-0000-1000-8000-00805f9b34fb',
      },
    }).map((m) => m.rule.domain);
    expect(bthomeMatches).toContain('bthome');

    const usbMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'usb',
      usb: { vid: '10CF', pid: '0B1B', manufacturer: 'Velleman' },
      details: { vid: '10CF', pid: '0B1B' },
    }).map((m) => m.rule.domain);
    expect(usbMatches).toContain('velbus');

    const mqttMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'mqtt',
      mqttTopic: 'dsmr/reading/electricity_delivered_1',
    }).map((m) => m.rule.domain);
    expect(mqttMatches).toContain('dsmr_reader');

    const homekitMatches = matchAllDiscoveryRules(enrichedRules, {
      protocol: 'homekit',
      name: 'Generic Sensor._hap._tcp.local.',
      details: { serviceType: '_hap._tcp.local.', model: 'CustomSensor999', sf: '1' },
    }).map((m) => m.rule.domain);
    expect(homekitMatches).toContain('homekit_controller');
  });
});
