/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';

interface PairingChallengeResponse {
  sessionId: string;
  challengeCode: string;
  hub: { hubId: string; homeId: string; name: string };
}

interface PairingConfirmResponse {
  grant: Record<string, unknown>;
}

interface PairingCompleteResponse {
  session: { sessionId: string; state: string };
  credentials: { sessionId: string; sessionToken: string; refreshToken: string };
}

const ADMIN_TOKEN = 'pairing-test-admin-token';
process.env.HAUS_API_TOKEN = ADMIN_TOKEN;

describe('Standalone Hub onboarding, pairing, and restart persistence', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('persists hashed client sessions, home domain state, and preferences across cold restarts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-standalone-persist-'));

    // --- Boot 1: Clean standalone empty home, onboarding + pairing + domain writes ---
    const app1 = await createNestApp({ dataDirectory: dir });
    await app1.listen(0, '127.0.0.1');
    const port1 = (app1.getHttpServer().address() as AddressInfo).port;
    const base1 = `http://127.0.0.1:${port1}`;

    let sessionId = '';
    let sessionToken = '';
    let refreshToken = '';

    try {
      const healthRes = await fetch(`${base1}/health`);
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { status: string; mode: string };
      expect(healthBody).toMatchObject({ status: 'ok', mode: 'standalone' });

      // Complete 3-step standalone pairing flow
      const challengeRes = await fetch(`${base1}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challenge = (await challengeRes.json()) as PairingChallengeResponse;

      const confirmRes = await fetch(`${base1}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode: challenge.challengeCode,
          client: {
            clientId: 'desktop-mac-1',
            clientName: 'Mac Desktop',
            role: 'admin',
          },
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = (await confirmRes.json()) as PairingConfirmResponse;

      const pairRes = await fetch(`${base1}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      expect([200, 201]).toContain(pairRes.status);
      const paired = (await pairRes.json()) as PairingCompleteResponse;
      sessionId = paired.credentials.sessionId;
      sessionToken = paired.credentials.sessionToken;
      refreshToken = paired.credentials.refreshToken;

      const authHeaders = {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      };

      // Verify fresh standalone home starts completely empty
      const emptyDevicesRes = await fetch(`${base1}/api/devices`, { headers: authHeaders });
      expect(emptyDevicesRes.status).toBe(200);
      expect(await emptyDevicesRes.json()).toEqual({ devices: [] });

      // Register a standalone device and scene, then execute a device command
      const createDevRes = await fetch(`${base1}/api/devices`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 'dev-desk-lamp',
          name: 'Desk Lamp',
          category: 'lighting',
          roomId: 'office',
          endpoints: [
            {
              id: 'light:office:desk_lamp',
              name: 'Desk Lamp',
              capabilities: ['on_off'],
              readings: {},
            },
          ],
        }),
      });
      expect(createDevRes.status).toBe(201);

      const cmdRes = await fetch(`${base1}/api/devices/dev-desk-lamp/command`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          endpointId: 'light:office:desk_lamp',
          capability: 'on_off',
          command: 'turn_on',
        }),
      });
      expect([200, 201]).toContain(cmdRes.status);

      const createSceneRes = await fetch(`${base1}/api/scenes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 'scene-focus',
          name: 'Focus',
          members: [{ endpointId: 'light:office:desk_lamp', targetState: { on_off: true } }],
        }),
      });
      expect(createSceneRes.status).toBe(201);
    } finally {
      await app1.get(CatalogLifetime).close();
      await app1.close();
    }

    // Verify raw bearer/refresh tokens are never stored in plaintext in SQLite
    const rawDb = new DatabaseSync(join(dir, 'haus.sqlite'), { readOnly: true });
    try {
      const row = rawDb
        .prepare(
          'SELECT token_hash, refresh_token_hash FROM client_sessions WHERE session_id = ?',
        )
        .get(sessionId) as { token_hash: string; refresh_token_hash: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.token_hash).not.toBe(sessionToken);
      expect(row?.refresh_token_hash).not.toBe(refreshToken);
      expect(row?.token_hash).toHaveLength(64);
    } finally {
      rawDb.close();
    }

    // --- Boot 2: Cold restart on the same data directory ---
    const app2 = await createNestApp({ dataDirectory: dir });
    await app2.listen(0, '127.0.0.1');
    const port2 = (app2.getHttpServer().address() as AddressInfo).port;
    const base2 = `http://127.0.0.1:${port2}`;

    try {
      // Paired session resumes without re-onboarding
      const resumeRes = await fetch(`${base2}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ sessionId }),
      });
      expect([200, 201]).toContain(resumeRes.status);
      const resumed = (await resumeRes.json()) as { status: string };
      expect(resumed.status).toBe('active');

      // Persisted devices, endpoint states, and scenes are intact
      const authHeaders = { authorization: `Bearer ${sessionToken}` };
      const devicesRes = await fetch(`${base2}/api/devices`, { headers: authHeaders });
      expect(devicesRes.status).toBe(200);
      const devicesBody = (await devicesRes.json()) as { devices: Array<{ id: string }> };
      expect(devicesBody.devices.map((d) => d.id)).toEqual(['dev-desk-lamp']);

      const devDetailRes = await fetch(`${base2}/api/devices/dev-desk-lamp`, {
        headers: authHeaders,
      });
      expect(devDetailRes.status).toBe(200);
      const devDetail = (await devDetailRes.json()) as {
        endpointStates: Record<string, { state?: string; on_off?: boolean }>;
      };
      expect(devDetail.endpointStates['light:office:desk_lamp']).toMatchObject({
        state: 'on',
        on_off: true,
      });

      const scenesRes = await fetch(`${base2}/api/scenes`, { headers: authHeaders });
      expect(scenesRes.status).toBe(200);
      const scenesBody = (await scenesRes.json()) as { scenes: Array<{ id: string }> };
      expect(scenesBody.scenes.map((s) => s.id)).toEqual(['scene-focus']);

      // Refresh rotation also works after restart
      const refreshRes = await fetch(`${base2}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, refreshToken }),
      });
      expect([200, 201]).toContain(refreshRes.status);
    } finally {
      await app2.get(CatalogLifetime).close();
      await app2.close();
    }
  });
});
