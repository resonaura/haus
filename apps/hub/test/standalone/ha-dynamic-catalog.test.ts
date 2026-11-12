/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { matchesDiscoveryRule } from '@haus/core';

describe('Dynamic HA Catalog & Universal Config Flows (P18.7 & P18.8)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('exposes dynamic catalog over HTTP, eliminates unsupported_flow for all catalog integrations, and matches BLE rules dynamically', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-dynamic-catalog-'));

    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);

    try {
      // 1. Authenticate admin bearer session
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-client', clientName: 'Admin Desktop', role: 'admin' },
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      expect(pairRes.status).toBe(201);
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const authHeaders = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      };

      // 2. Query dynamic catalog integrations endpoint
      const catalogRes = await fetch(`${base}/api/catalog/integrations`, {
        headers: authHeaders,
      });
      expect(catalogRes.status).toBe(200);
      const catalogData = (await catalogRes.json()) as {
        version: string;
        total: number;
        domains: string[];
        integrations: Array<{ domain: string; name: string }>;
      };

      expect(catalogData.total).toBeGreaterThanOrEqual(1303);
      expect(catalogData.domains).toContain('hue');
      expect(catalogData.domains).toContain('xiaomi_ble');
      expect(catalogData.domains).toContain('matter');
      expect(catalogData.domains).toContain('bthome');
      expect(catalogData.domains).toContain('govee_ble');

      // 3. Query catalog version endpoint
      const versionRes = await fetch(`${base}/api/catalog/version`, {
        headers: authHeaders,
      });
      expect(versionRes.status).toBe(200);
      const versionData = (await versionRes.json()) as {
        currentVersion: string;
        latestVersion: string;
      };
      expect(versionData.currentVersion).toBeDefined();

      // 4. Start config flow for catalog domain (e.g. xiaomi_ble) without unsupported_flow abort
      const flowRes = await fetch(`${base}/api/commissioning/flows`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          domain: 'xiaomi_ble',
          source: 'user',
          manualAddress: { host: 'F8:24:41:C5:7D:98' },
        }),
      });
      expect(flowRes.status).toBe(201);
      const flowStep = (await flowRes.json()) as {
        type: string;
        flowId: string;
        handler: string;
        title: string;
        dataSchema?: Array<{ name: string; type: string }>;
      };

      // Invariant: MUST NOT abort with unsupported_flow!
      expect(flowStep.type).toBe('form');
      expect(flowStep.handler).toBe('xiaomi_ble');
      expect(flowStep.title).toContain('Xiaomi');
      expect(flowStep.dataSchema?.some((f) => f.name === 'address')).toBe(true);
      expect(flowStep.dataSchema?.some((f) => f.name === 'bindkey')).toBe(true);

      // Submit flow with bindkey
      const submitRes = await fetch(
        `${base}/api/commissioning/flows/${encodeURIComponent(flowStep.flowId)}/step`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            values: {
              address: 'F8:24:41:C5:7D:98',
              bindkey: 'eb8dea5be36d8f96d86bbc4a',
            },
          }),
        },
      );
      expect(submitRes.status).toBe(200);
      const submitStep = (await submitRes.json()) as {
        type: string;
        result?: { entryId?: string; title?: string };
      };
      expect(submitStep.type).toBe('create_entry');
      expect(submitStep.result?.entryId).toBeDefined();

      // 5. Test arbitrary catalog domain (e.g. overkiz) opens form dynamically
      const overkizFlowRes = await fetch(`${base}/api/commissioning/flows`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          domain: 'overkiz',
          source: 'user',
        }),
      });
      expect(overkizFlowRes.status).toBe(201);
      const overkizStep = (await overkizFlowRes.json()) as {
        type: string;
        handler: string;
        dataSchema?: unknown[];
      };
      expect(overkizStep.type).toBe('form');
      expect(overkizStep.handler).toBe('overkiz');

      // 6. Prove dynamic discovery rule evaluation for BLE advertisements from catalog manifests
      const matcherRules = commService.catalog.getCatalog().getDiscoveryMatcherRules();
      const xiaomiRule = matcherRules.find((r) => r.domain === 'xiaomi_ble');
      expect(xiaomiRule).toBeDefined();
      expect(xiaomiRule?.bluetooth).toBeDefined();

      // Test matching Bluetooth advertisement with service_data_uuid for Xiaomi
      const isXiaomiMatch = matchesDiscoveryRule(
        xiaomiRule!,
        {
          protocol: 'bluetooth',
          details: {
            service_data_uuid: '0000fe95-0000-1000-8000-00805f9b34fb',
          },
        },
      );
      expect(isXiaomiMatch).toBe(true);

      // 7. Refresh catalog via POST /api/catalog/refresh
      const refreshRes = await fetch(`${base}/api/catalog/refresh`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(refreshRes.status).toBe(200);
      const refreshData = (await refreshRes.json()) as {
        version: string;
        total: number;
        sha256: string;
      };
      expect(refreshData.total).toBeGreaterThanOrEqual(1303);
      expect(refreshData.sha256).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
