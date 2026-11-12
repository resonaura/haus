/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import type { VendorCandidate } from '@haus/core';

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  tempDirs = [];
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-vendor-test-'));
  tempDirs.push(dir);
  return dir;
}

describe('Documented Vendor Provisioning API (P20.11)', () => {
  it('classifies and provisions vendor devices over authenticated Hub REST API', async () => {
    const dir = await createTempDir();
    const app = await createNestApp({ dataDirectory: dir, port: 0 });
    await app.listen(0);

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);

    try {
      // 1. Authenticate admin user
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-client', clientName: 'Admin Phone', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const headers = {
        authorization: `Bearer ${token}`,
        'x-haus-home-id': confirmed.grant.homeId,
        'content-type': 'application/json',
      };

      // 2. Unauthenticated calls are rejected with 401
      const unauthRes = await fetch(`${base}/api/commissioning/vendor/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: '192.168.1.50' }),
      });
      assert.equal(unauthRes.status, 401);

      // 3. Classify Shelly Gen2 RPC device
      const classifyShellyRes = await fetch(`${base}/api/commissioning/vendor/classify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          host: '192.168.33.1',
          name: 'ShellyPlus1PM-AABBCCDDEEFF',
          serviceType: '_shelly._tcp.local',
          txt: { gen: '2', model: 'SNSW-001P16EU' },
        }),
      });
      assert.equal(classifyShellyRes.status, 200);
      const shellyCandidate = (await classifyShellyRes.json()) as VendorCandidate;
      assert.equal(shellyCandidate.vendor, 'shelly');
      assert.equal(shellyCandidate.protocol, 'shelly-rpc');
      assert.equal(shellyCandidate.generation, 2);

      // 4. Classify ESPHome captive portal device
      const classifyEsphomeRes = await fetch(`${base}/api/commissioning/vendor/classify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          host: '192.168.4.1',
          name: 'esphome-smart-light',
          serviceType: '_esphomelib._tcp.local',
          txt: { project_name: 'esphome.light' },
        }),
      });
      assert.equal(classifyEsphomeRes.status, 200);
      const esphomeCandidate = (await classifyEsphomeRes.json()) as VendorCandidate;
      assert.equal(esphomeCandidate.vendor, 'esphome');
      assert.equal(esphomeCandidate.protocol, 'esphome-web');

      // 5. Classify Tasmota device
      const classifyTasmotaRes = await fetch(`${base}/api/commissioning/vendor/classify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          host: '192.168.4.1',
          name: 'tasmota-power-strip',
          serviceType: '_http._tcp.local',
        }),
      });
      assert.equal(classifyTasmotaRes.status, 200);
      const tasmotaCandidate = (await classifyTasmotaRes.json()) as VendorCandidate;
      assert.equal(tasmotaCandidate.vendor, 'tasmota');
      assert.equal(tasmotaCandidate.protocol, 'tasmota-web');

      // 6. Classify Aqara with Matter referral
      const classifyAqaraMatterRes = await fetch(`${base}/api/commissioning/vendor/classify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          host: '192.168.1.150',
          name: 'Aqara-Hub-M2',
          txt: { md: '3840' },
        }),
      });
      assert.equal(classifyAqaraMatterRes.status, 200);
      const aqaraMatterCandidate = (await classifyAqaraMatterRes.json()) as VendorCandidate;
      assert.equal(aqaraMatterCandidate.vendor, 'aqara');
      assert.equal(aqaraMatterCandidate.protocol, 'aqara-matter-referral');

      // 7. Classify Aqara Proprietary (truthfully refuses fake local protocol)
      const classifyAqaraPropRes = await fetch(`${base}/api/commissioning/vendor/classify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          host: '192.168.1.151',
          name: 'Aqara-Proprietary-Lock',
          serviceType: '_aqara._tcp.local',
        }),
      });
      assert.equal(classifyAqaraPropRes.status, 200);
      const aqaraPropCandidate = (await classifyAqaraPropRes.json()) as VendorCandidate;
      assert.equal(aqaraPropCandidate.vendor, 'aqara');
      assert.equal(aqaraPropCandidate.protocol, 'aqara-proprietary');

      // 8. Provision Aqara Matter device -> returns referral
      const provAqaraMatterRes = await fetch(`${base}/api/commissioning/vendor/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          candidate: aqaraMatterCandidate,
          ssid: 'HausWiFi',
          password: 'SecretPassword',
        }),
      });
      assert.equal(provAqaraMatterRes.status, 200);
      const aqaraMatterResult = (await provAqaraMatterRes.json()) as {
        status: string;
        referralProtocol: string;
      };
      assert.equal(aqaraMatterResult.status, 'referral_required');
      assert.equal(aqaraMatterResult.referralProtocol, 'matter');

      // 9. Provision Aqara Proprietary device -> returns unsupported_proprietary with truthful guidance
      const provAqaraPropRes = await fetch(`${base}/api/commissioning/vendor/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          candidate: aqaraPropCandidate,
          ssid: 'HausWiFi',
          password: 'SecretPassword',
        }),
      });
      assert.equal(provAqaraPropRes.status, 200);
      const aqaraPropResult = (await provAqaraPropRes.json()) as {
        status: string;
        error: string;
      };
      assert.equal(aqaraPropResult.status, 'unsupported_proprietary');
      assert.ok(aqaraPropResult.error.includes('Aqara proprietary provisioning requires vendor cloud app'));

      // 10. Provision validation error (missing SSID)
      const invalidProvRes = await fetch(`${base}/api/commissioning/vendor/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          candidate: shellyCandidate,
        }),
      });
      assert.equal(invalidProvRes.status, 400);
    } finally {
      await app.close();
    }
  });
});
