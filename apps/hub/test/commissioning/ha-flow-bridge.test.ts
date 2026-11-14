/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchAllDiscoveryRules, type IntegrationFlowStep } from '@haus/core';
import type { HomeKitControllerService } from '../../src/homekit/service.js';
import type { MqttService } from '../../src/mqtt/service.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import { CommissioningController } from '../../src/commissioning/controller.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { HaFlowBridgeService } from '../../src/commissioning/ha-flow/bridge.service.js';
import { HaFlowDiscoverySyncService } from '../../src/commissioning/ha-flow/discovery-sync.service.js';
import {
  HaFlowController,
  HaOAuthCallbackController,
} from '../../src/commissioning/ha-flow/ha-flow.controller.js';

const mockHomekit = {
  discoverAccessories: async () => [],
} as unknown as HomeKitControllerService;

function mockReq(homeId = 'home-1', clientId = 'user-1'): Request & {
  session?: { homeId?: string; clientId?: string };
} {
  return {
    headers: {},
    session: { homeId, clientId },
  } as unknown as Request & { session?: { homeId?: string; clientId?: string } };
}

class MockMqttBroker extends EventEmitter {}

describe('Hub HA Flow Bridge, Discovery Sync, Secrets Persistence, and OAuth/Files', () => {
  const disposers: Array<() => Promise<void> | void> = [];
  let prevHaFlowDir: string | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    while (disposers.length > 0) {
      const fn = disposers.pop();
      await fn?.();
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

    const commissioning = new CommissioningService(mockHomekit, undefined, undefined, entries);
    const bridgeService = new HaFlowBridgeService(commissioning, entries, undefined, tx);
    const mqttBroker = new MockMqttBroker();
    const mqttService = { broker: mqttBroker } as unknown as MqttService;
    const discoverySync = new HaFlowDiscoverySyncService(
      commissioning,
      bridgeService,
      mqttService,
    );
    discoverySync.onModuleInit();

    const controller = new CommissioningController(commissioning);
    const flowController = new HaFlowController(bridgeService);
    const oauthController = new HaOAuthCallbackController(bridgeService);

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
      mqttBroker,
      controller,
      flowController,
      oauthController,
    };
  }

  it(
    'routes vendor catalog domains through real HA flows without shadowing and preserves Tuya QR + secret persistence',
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'haus-ha-bridge-test-'));
      const sqlitePath = join(tempDir, 'haus.sqlite');
      const haFlowDir = join(tempDir, 'ha-flow');

      const h1 = await createHarness(sqlitePath, haFlowDir);
      const req = mockReq();

      // 1. onvif MUST use real HA config flow (NOT AppCatalog/vendorCatalog stub)
      const onvifStep = await h1.controller.startFlow(req, { domain: 'onvif' });
      expect(onvifStep.handler).toBe('onvif');
      expect(onvifStep.unsupportedRequirements).toBeUndefined();
      // AppCatalog/vendorCatalog onvif form asks for host/username/password on step 1;
      // real HA onvif starts with search/auto confirmation (`auto` boolean or empty form).
      expect(onvifStep.dataSchema?.some((f) => f.name === 'host')).toBe(false);
      await h1.controller.cancelFlow(req, onvifStep.flowId);

      // 2. tuya MUST preserve Hub's native HA-style QR setup flow
      const tuyaStep = await h1.controller.startFlow(req, { domain: 'tuya' });
      expect(tuyaStep.handler).toBe('tuya');
      expect(tuyaStep.stepId).toBe('user');
      expect(tuyaStep.dataSchema?.some((f) => f.name === 'user_code')).toBe(true);
      await h1.controller.cancelFlow(req, tuyaStep.flowId);

      // 3. sun completes cleanly via real HA runtime, persists to SQLite, and exposes HA translations
      const sunStart = await h1.controller.startFlow(req, { domain: 'sun' });
      expect(sunStart.handler).toBe('sun');
      expect(sunStart.type).toBe('form');
      const sunDone = await h1.controller.submitFlowStep(req, sunStart.flowId, {
        values: {},
      });
      expect(sunDone.type).toBe('create_entry');
      expect(sunDone.result?.entryId).toBeTruthy();

      const translations = await h1.flowController.getTranslations('config', 'onvif,sun');
      expect(translations.category).toBe('config');
      expect(Object.keys(translations.resources).some((k) => k.startsWith('component.onvif.'))).toBe(
        true,
      );

      // 4. Restart harness on same SQLite + HA dir and verify entry + secrets store remain valid
      const disposer1 = disposers.pop();
      await disposer1?.();

      const h2 = await createHarness(sqlitePath, haFlowDir);
      const savedEntries = await h2.entries.listEntries();
      expect(savedEntries.some((e) => e.domain === 'sun')).toBe(true);
      const flows2 = await h2.flowController.listProgressFlows();
      expect(Array.isArray(flows2.flows)).toBe(true);
    },
    60_000,
  );

  it(
    'dispatches MQTT into real HA discovery flow and routes all protocols + alwaysDiscover filters accurately',
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'haus-ha-sync-test-'));
      const sqlitePath = join(tempDir, 'haus.sqlite');
      const haFlowDir = join(tempDir, 'ha-flow');

      const h = await createHarness(sqlitePath, haFlowDir);
      await h.bridgeService.ensureStarted();

      // 1. Zero-requirement dsmr_reader MQTT auto-discovery through broker listener -> real HA flow
      h.mqttBroker.emit('message', {
        topic: 'dsmr/reading/electricity_delivered_1',
        payload: '123.45',
        retained: false,
      });
      await h.discoverySync.flush();

      const afterMqtt = h.commissioning.listDiscoveries({ protocol: 'mqtt' });
      expect(afterMqtt.length).toBe(1);
      expect(afterMqtt[0]?.domain).toBe('dsmr_reader');

      const progressAfterMqtt = await h.flowController.listProgressFlows();
      expect(progressAfterMqtt.flows.some((f) => f.handler === 'dsmr_reader')).toBe(true);

      // Verify exact protocol dispatch & alwaysDiscover:false suppression without downloading PyPI wheels
      const triggerSpy = vi
        .spyOn(h.bridgeService, 'triggerDiscovery')
        .mockResolvedValue({ outcome: 'form' });

      // 2. Unpaired HAP with HomeKit alwaysDiscover:false vendor model (NL42 -> nanoleaf)
      // MUST suppress generic homekit_controller and trigger vendor discovery instead.
      const suppressedInput = {
        protocol: 'zeroconf' as const,
        mac: '11:22:33:44:55:66',
        host: '192.168.1.120',
        port: 80,
        name: 'Nanoleaf Shapes._hap._tcp.local.',
        details: {
          serviceType: '_hap._tcp.local.',
          id: '11:22:33:44:55:66',
          md: 'NL42',
          model: 'NL42',
          sf: '1',
          'c#': '2',
          pv: '1.1',
          's#': '1',
          ff: '0',
          ci: '5',
        },
      };
      const matchedSuppressedDomains = matchAllDiscoveryRules(
        h.commissioning.getMatcherRules(),
        suppressedInput,
      ).map((m) => m.rule.domain);
      expect(matchedSuppressedDomains).toContain('nanoleaf');
      expect(matchedSuppressedDomains).not.toContain('homekit_controller');
      const suppressedCandidate = h.commissioning.ingestDiscovery(suppressedInput);
      expect(suppressedCandidate.domain).toBe('nanoleaf');

      // 3. Unpaired generic HAP accessory dispatches to homekit_controller with protocol='zeroconf'
      const genericHap = h.commissioning.ingestDiscovery({
        protocol: 'homekit',
        mac: '77:88:99:AA:BB:CC',
        host: '192.168.1.121',
        port: 51827,
        name: 'Generic Plug._hap._tcp.local.',
        details: {
          serviceType: '_hap._tcp.local.',
          id: '77:88:99:AA:BB:CC',
          md: 'CustomGenericPlug999',
          model: 'CustomGenericPlug999',
          sf: '1',
          'c#': '1',
          pv: '1.1',
          's#': '1',
          ff: '0',
          ci: '7',
        },
      });
      expect(genericHap.domain).toBe('homekit_controller');

      // 4. USB and SSDP also dispatch through HaFlowDiscoverySyncService with exact protocol payloads
      h.commissioning.ingestDiscovery({
        protocol: 'usb',
        usb: { vid: '10CF', pid: '0B1B', serialNumber: 'VMB-1', manufacturer: 'Velleman' },
        details: { vid: '10CF', pid: '0B1B', device: '/dev/ttyACM1' },
      });
      h.commissioning.ingestDiscovery({
        protocol: 'ssdp',
        host: '192.168.1.55',
        port: 8060,
        uuid: 'uuid:roku:ecp:YR001',
        details: {
          st: 'roku:ecp',
          manufacturer: 'Roku',
          deviceType: 'urn:roku-com:device:player:1-0',
          location: 'http://192.168.1.55:8060/',
        },
      });

      await h.discoverySync.flush();

      const dispatched = triggerSpy.mock.calls.map((c) => ({
        domain: c[0].domain,
        protocol: c[0].protocol,
      }));
      expect(dispatched).toContainEqual({ domain: 'nanoleaf', protocol: 'homekit' });
      expect(
        dispatched.some((d) => d.domain === 'homekit_controller' && d.protocol === 'zeroconf'),
      ).toBe(true);
      expect(dispatched.some((d) => d.domain === 'homekit_controller' && d.protocol === 'homekit')).toBe(
        false,
      );
      expect(dispatched).toContainEqual({ domain: 'velbus', protocol: 'usb' });
      expect(dispatched).toContainEqual({ domain: 'roku', protocol: 'ssdp' });
    },
    60_000,
  );

  it(
    'manages encrypted OAuth application credentials, file uploads, and browser OAuth callback completion',
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), 'haus-ha-oauth-test-'));
      const sqlitePath = join(tempDir, 'haus.sqlite');
      const haFlowDir = join(tempDir, 'ha-flow');

      const h = await createHarness(sqlitePath, haFlowDir);

      // Application credentials CRUD with secret redaction
      const created = await h.flowController.addApplicationCredential({
        domain: 'spotify',
        clientId: 'client-id-123',
        clientSecret: 'super-secret-xyz',
        name: 'Haus Spotify',
      });
      expect(created.domain).toBe('spotify');
      expect(created.hasSecret).toBe(true);
      expect((created as unknown as Record<string, unknown>).clientSecret).toBeUndefined();

      const listed = await h.flowController.listApplicationCredentials();
      expect(listed.credentials).toHaveLength(1);
      expect(listed.credentials[0]?.clientId).toBe('client-id-123');

      // File upload (JSON base64)
      await h.bridgeService.ensureStarted();
      const uploaded = await h.flowController.uploadFile(
        { headers: {} } as Request,
        {
          filename: 'client.pem',
          contentBase64: Buffer.from('-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n').toString(
            'base64',
          ),
        },
      );
      expect(uploaded.fileId).toBeTruthy();
      expect(uploaded.file_id).toBe(uploaded.fileId);

      // Browser OAuth redirect completion & HTML sanitization
      const fakeDoneStep: IntegrationFlowStep = {
        flowId: 'oauth-flow-1',
        handler: 'spotify',
        type: 'create_entry',
        stepId: 'creation',
        result: { entryId: 'e-oauth-1', title: 'Spotify' },
      };
      const completeSpy = vi
        .spyOn(h.bridgeService, 'completeExternalFlow')
        .mockResolvedValue(fakeDoneStep);

      let statusCode = 0;
      let htmlBody = '';
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        type() {
          return this;
        },
        send(body: string) {
          htmlBody = body;
          return this;
        },
      } as unknown as Response;

      await h.oauthController.handleBrowserOAuthRedirect('state-jwt', 'auth-code-1', undefined, mockRes);
      expect(completeSpy).toHaveBeenCalledWith({
        state: 'state-jwt',
        code: 'auth-code-1',
        error: undefined,
      });
      expect(statusCode).toBe(200);
      expect(htmlBody).toContain('Authorization completed');
      expect(htmlBody).toContain('haus-oauth-complete');

      // Deleting application credential works cleanly
      const deleted = await h.flowController.deleteApplicationCredential('spotify');
      expect(deleted).toEqual({ deleted: true, domain: 'spotify' });
      expect((await h.flowController.listApplicationCredentials()).credentials).toHaveLength(0);
    },
    30_000,
  );
});
