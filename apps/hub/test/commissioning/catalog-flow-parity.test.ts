/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { matchAllDiscoveryRules } from '@haus/core';
import { HomeKitControllerService } from '../../src/homekit/service.js';
import { MqttService } from '../../src/mqtt/service.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { HaFlowBridgeService } from '../../src/commissioning/ha-flow/bridge.service.js';
import { HaFlowDiscoverySyncService } from '../../src/commissioning/ha-flow/discovery-sync.service.js';
import { HaFlowController } from '../../src/commissioning/ha-flow/ha-flow.controller.js';

describe('Hub Universal Catalog Flow & 7-Protocol Discovery Parity', () => {
  const disposers: Array<() => Promise<void> | void> = [];
  let prevHaFlowDir: string | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      await dispose?.();
    }
    if (prevHaFlowDir === undefined) {
      delete process.env.HAUS_HA_FLOW_DIR;
    } else {
      process.env.HAUS_HA_FLOW_DIR = prevHaFlowDir;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function createHarness(sqlitePath: string, haFlowDir: string) {
    prevHaFlowDir = process.env.HAUS_HA_FLOW_DIR;
    process.env.HAUS_HA_FLOW_DIR = haFlowDir;

    const ds = await openCatalog(sqlitePath);
    const tx = new Transactions(ds);
    const entries = new HubIntegrationEntryService(undefined, tx, undefined);
    await entries.onModuleInit();

    const homekit = new HomeKitControllerService();
    const commissioning = new CommissioningService(homekit, undefined, undefined, entries);
    const bridgeService = new HaFlowBridgeService(commissioning, entries, undefined, tx);
    const mqttService = new MqttService();
    const discoverySync = new HaFlowDiscoverySyncService(commissioning, bridgeService, mqttService);
    discoverySync.onModuleInit();

    const flowController = new HaFlowController(bridgeService);

    disposers.push(async () => {
      await bridgeService.onModuleDestroy();
      await discoverySync.onModuleDestroy();
      entries.onModuleDestroy();
      await ds.destroy();
    });

    return {
      commissioning,
      entries,
      bridgeService,
      discoverySync,
      mqttService,
      flowController,
    };
  }

  it(
    'routes all catalog config_flow and supported_by domains without static shadowing and matches all 7 discovery protocols',
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'haus-hub-parity-catalog-'));
      const h = await createHarness(join(tempDir, 'haus.sqlite'), join(tempDir, 'ha-flow'));

      const catalog = h.commissioning.catalog.getCatalog();
      const translations = h.commissioning.catalog.getTranslations();
      const availableDomains = new Set(h.commissioning.flows.getAvailableDomains());

      for (const domain of catalog.getAllDomains()) {
        expect(availableDomains.has(domain)).toBe(true);
      }
      expect(catalog.getTotalCount()).toBe(1303);

      const bridge = await h.bridgeService.ensureStarted();
      expect(bridge).toBeDefined();

      const configFlowManifests = catalog.query({ configFlow: true });
      expect(configFlowManifests.length).toBe(699);
      for (const manifest of configFlowManifests) {
        expect(bridge?.supportsDomain(manifest.domain)).toBe(true);
      }

      for (const [virtualDomain, parentDomain] of Object.entries(translations.getAllSupportedBy())) {
        const parentManifest = catalog.getManifest(parentDomain);
        if (parentManifest?.config_flow) {
          expect(bridge?.supportsDomain(virtualDomain)).toBe(true);
        }
      }

      const rules = h.commissioning.getMatcherRules();
      const homekitRules = rules.filter((r) => r.domain === 'homekit');
      expect(homekitRules).toHaveLength(1);
      expect(homekitRules[0]?.zeroconf).toEqual(['_homekit._tcp.local.']);
      expect(rules.some((r) => r.domain === 'homekit_controller')).toBe(true);

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'zeroconf',
          host: '192.168.10.2',
          name: 'Philips hue - 001122',
          details: { serviceType: '_hue._tcp.local.' },
        }).map((m) => m.rule.domain),
      ).toContain('hue');

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'ssdp',
          host: '192.168.10.3',
          details: {
            st: 'roku:ecp',
            manufacturer: 'Roku',
            deviceType: 'urn:roku-com:device:player:1-0',
          },
        }).map((m) => m.rule.domain),
      ).toContain('roku');

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'dhcp',
          mac: 'D8:61:62:AA:BB:CC',
          host: 'connect',
          details: { hostname: 'connect' },
        }).map((m) => m.rule.domain),
      ).toContain('august');

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'bluetooth',
          name: 'BTHome',
          details: {
            connectable: false,
            service_data_uuid: '0000fcd2-0000-1000-8000-00805f9b34fb',
          },
        }).map((m) => m.rule.domain),
      ).toContain('bthome');

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'usb',
          usb: { vid: '10CF', pid: '0B1B', manufacturer: 'Velleman' },
          details: { vid: '10CF', pid: '0B1B' },
        }).map((m) => m.rule.domain),
      ).toContain('velbus');

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'mqtt',
          mqttTopic: 'dsmr/reading/electricity_delivered_1',
        }).map((m) => m.rule.domain),
      ).toContain('dsmr_reader');

      expect(
        matchAllDiscoveryRules(rules, {
          protocol: 'homekit',
          name: 'Generic Plug._hap._tcp.local.',
          details: { serviceType: '_hap._tcp.local.', model: 'CustomGenericPlug', sf: '1' },
        }).map((m) => m.rule.domain),
      ).toContain('homekit_controller');
    },
    60_000,
  );

  it(
    'executes live HA 2024.12.5 flows end-to-end across form, menu, mqtt discovery, homekit_controller, oauth credentials, and tuya QR',
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'haus-hub-parity-live-'));
      const h = await createHarness(join(tempDir, 'haus.sqlite'), join(tempDir, 'ha-flow'));
      await h.bridgeService.ensureStarted();

      const auth = { homeId: 'home-1', userId: 'user-1' };

      // 1. sun -> complete -> persisted SQLite entry
      const sunStart = await h.commissioning.startFlow({ domain: 'sun', ...auth });
      expect(sunStart.handler).toBe('sun');
      expect(sunStart.type).toBe('form');
      const sunDone = await h.commissioning.submitFlowStep({
        flowId: sunStart.flowId,
        values: {},
        ...auth,
      });
      expect(sunDone.type).toBe('create_entry');
      expect(sunDone.result?.entryId).toBeTruthy();

      // 2. local_calendar -> inspect schema/fieldLabels -> submit calendar_name -> create_entry
      const calStart = await h.commissioning.startFlow({ domain: 'local_calendar', ...auth });
      expect(calStart.handler).toBe('local_calendar');
      expect(calStart.type).toBe('form');
      expect(calStart.dataSchema?.some((f) => f.name === 'calendar_name')).toBe(true);
      const calDone = await h.commissioning.submitFlowStep({
        flowId: calStart.flowId,
        values: { calendar_name: 'Haus Schedule' },
        ...auth,
      });
      expect(calDone.type).toBe('create_entry');

      // 3. onvif -> native HA config flow + live translations
      const onvifStart = await h.commissioning.startFlow({ domain: 'onvif', ...auth });
      expect(onvifStart.handler).toBe('onvif');
      expect(onvifStart.unsupportedRequirements).toBeUndefined();
      const onvifTranslations = await h.flowController.getTranslations('config', 'onvif');
      expect(
        Object.keys(onvifTranslations.resources).some((k) => k.startsWith('component.onvif.')),
      ).toBe(true);
      await h.commissioning.cancelFlowAsync(onvifStart.flowId, auth);

      // 4. dsmr_reader via real MqttService broker -> HaFlowDiscoverySyncService -> listProgressFlows -> step
      h.mqttService.broker.emit('message', {
        topic: 'dsmr/reading/electricity_delivered_1',
        payload: '123.45',
        retained: false,
      });
      await h.discoverySync.flush();
      const progress = await h.flowController.listProgressFlows();
      const dsmrFlow = progress.flows.find((f) => f.handler === 'dsmr_reader');
      expect(dsmrFlow).toBeDefined();
      if (dsmrFlow) {
        const resumed = await h.commissioning.refreshFlow(dsmrFlow.flowId, auth);
        expect(resumed?.handler).toBe('dsmr_reader');
        const nextDsmr = await h.commissioning.submitFlowStep({
          flowId: dsmrFlow.flowId,
          values: {},
          ...auth,
        });
        expect(['form', 'create_entry']).toContain(nextDsmr.type);
      }

      // 5. homekit_controller -> routed natively through HA (never legacy HAP pin bypass)
      const hkStart = await h.commissioning.startFlow({
        domain: 'homekit_controller',
        ...auth,
      });
      expect(hkStart.handler).toBe('homekit_controller');
      expect(hkStart.flowId.startsWith('hk-')).toBe(false);
      expect(hkStart.unsupportedRequirements).toBeUndefined();
      const hkTranslations = await h.flowController.getTranslations('config', 'homekit_controller');
      expect(
        Object.keys(hkTranslations.resources).some((k) =>
          k.startsWith('component.homekit_controller.'),
        ),
      ).toBe(true);
      if (hkStart.type !== 'abort' && hkStart.type !== 'create_entry') {
        await h.commissioning.cancelFlowAsync(hkStart.flowId, auth);
      }

      // 6. spotify -> missing_credentials abort -> addApplicationCredential -> restart -> live OAuth external step
      const spotifyMissing = await h.commissioning.startFlow({ domain: 'spotify', ...auth });
      expect(spotifyMissing.handler).toBe('spotify');
      expect(spotifyMissing.type).toBe('abort');
      expect(spotifyMissing.abortReason).toBe('missing_credentials');

      await h.flowController.addApplicationCredential({
        domain: 'spotify',
        clientId: 'haus-spotify-client',
        clientSecret: 'haus-spotify-secret',
        name: 'Haus Spotify',
      });
      const spotifyOAuth = await h.commissioning.startFlow({ domain: 'spotify', ...auth });
      expect(spotifyOAuth.handler).toBe('spotify');
      expect(spotifyOAuth.type).toBe('external');
      expect(spotifyOAuth.url).toContain('accounts.spotify.com');
      await h.commissioning.cancelFlowAsync(spotifyOAuth.flowId, auth);

      // 7. tuya -> native Hub QR flow remains intact
      const tuyaStart = await h.commissioning.startFlow({ domain: 'tuya', ...auth });
      expect(tuyaStart.handler).toBe('tuya');
      expect(tuyaStart.type).toBe('form');
      expect(tuyaStart.dataSchema?.some((f) => f.name === 'user_code')).toBe(true);
      await h.commissioning.cancelFlowAsync(tuyaStart.flowId, auth);

      const saved = await h.entries.listEntries();
      expect(saved.some((e) => e.domain === 'sun')).toBe(true);
      expect(saved.some((e) => e.domain === 'local_calendar')).toBe(true);
    },
    120_000,
  );
});
