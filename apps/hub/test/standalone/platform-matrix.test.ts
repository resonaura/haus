/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformRadioCapabilities } from '@haus/core';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';

describe('Platform Capability and Permission Matrix Integration (P20.9)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('evaluates host capabilities, measures WSL2 isolation, verifies least-privilege container rules, and distinguishes Expo Go from native builds', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-plat-matrix-'));

    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);

    try {
      // 1. Unauthenticated request must be rejected (401)
      const unauthRes = await fetch(`${base}/api/commissioning/platform-matrix/current`);
      expect(unauthRes.status).toBe(401);

      // 2. Authenticate admin pairing session
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
          client: { clientId: 'admin-client', clientName: 'Admin Desktop', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const authHeaders = {
        authorization: `Bearer ${paired.credentials.sessionToken}`,
        'content-type': 'application/json',
      };

      // 3. GET current host capabilities
      const currentRes = await fetch(`${base}/api/commissioning/platform-matrix/current`, {
        headers: authHeaders,
      });
      expect(currentRes.status).toBe(200);
      const currentCaps = (await currentRes.json()) as PlatformRadioCapabilities;
      expect(['macos', 'windows', 'linux']).toContain(currentCaps.os);
      expect(currentCaps.capabilities).toBeDefined();
      expect(typeof currentCaps.manualFallbackRequired).toBe('boolean');

      // 4. POST evaluate macOS desktop client
      const macEvalRes = await fetch(`${base}/api/commissioning/platform-matrix/evaluate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          os: 'macos',
          grantedPermissions: { bluetooth: true, location: true },
        }),
      });
      expect(macEvalRes.status).toBe(200);
      const macCaps = (await macEvalRes.json()) as PlatformRadioCapabilities;
      expect(macCaps.transportMode).toBe('corebluetooth');
      expect(macCaps.capabilities.ble_scan).toBe(true);
      expect(macCaps.capabilities.thread_credentials).toBe(true);
      expect(macCaps.capabilities.wifi_info).toBe(true);

      // 5. POST evaluate Windows WSL2 measured isolation
      const wslEvalRes = await fetch(`${base}/api/commissioning/platform-matrix/evaluate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          os: 'windows',
          isWsl: true,
          hasUsbipdBridge: false,
        }),
      });
      expect(wslEvalRes.status).toBe(200);
      const wslCaps = (await wslEvalRes.json()) as PlatformRadioCapabilities;
      expect(wslCaps.transportMode).toBe('remote_radio_rpc');
      expect(wslCaps.capabilities.ble_scan).toBe(false);
      expect(wslCaps.manualFallbackRequired).toBe(true);
      expect(wslCaps.limitations.some((l) => l.includes('WSL2'))).toBe(true);

      // 6. POST evaluate Linux container least-privilege
      const containerDbusRes = await fetch(`${base}/api/commissioning/platform-matrix/evaluate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          os: 'linux',
          isContainer: true,
          hasDbusSocket: true,
        }),
      });
      const containerCaps = (await containerDbusRes.json()) as PlatformRadioCapabilities;
      expect(containerCaps.transportMode).toBe('native_dbus');
      expect(containerCaps.capabilities.ble_scan).toBe(true);

      // 7. POST evaluate Expo Go client boundary
      const expoGoRes = await fetch(`${base}/api/commissioning/platform-matrix/evaluate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          os: 'ios',
          isExpoGo: true,
        }),
      });
      const expoGoCaps = (await expoGoRes.json()) as PlatformRadioCapabilities;
      expect(expoGoCaps.isExpoGo).toBe(true);
      expect(expoGoCaps.transportMode).toBe('unsupported');
      expect(expoGoCaps.manualFallbackRequired).toBe(true);
      expect(expoGoCaps.recommendedAction).toContain('custom native build');

      // 8. POST evaluate Android 12+ (API 31) vs Android 10 (API 29)
      const android12Res = await fetch(`${base}/api/commissioning/platform-matrix/evaluate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          os: 'android',
          androidApiLevel: 33,
          grantedPermissions: { bluetooth: true },
        }),
      });
      const android12Caps = (await android12Res.json()) as PlatformRadioCapabilities;
      expect(android12Caps.capabilities.ble_scan).toBe(true);
      expect(android12Caps.manualFallbackRequired).toBe(false);

      const android10Res = await fetch(`${base}/api/commissioning/platform-matrix/evaluate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          os: 'android',
          androidApiLevel: 29,
          grantedPermissions: { bluetooth: true, location: false },
        }),
      });
      const android10Caps = (await android10Res.json()) as PlatformRadioCapabilities;
      expect(android10Caps.capabilities.ble_scan).toBe(false);
      expect(android10Caps.permissions.location.status).toBe('prompt_required');
      expect(android10Caps.manualFallbackRequired).toBe(true);
    } finally {
      await app.close();
    }
  });
});
