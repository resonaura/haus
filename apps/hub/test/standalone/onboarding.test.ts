/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { StandaloneHaClient } from '../../src/ha/client.js';

interface PairingChallengeResponse {
  sessionId: string;
  challengeCode?: string;
  hub: { hubId: string; homeId: string; name: string; onboarded?: boolean };
}

interface PairingConfirmResponse {
  grant: {
    grantId: string;
    hubId: string;
    homeId: string;
    clientId: string;
    clientRole: string;
    clientName: string;
  };
}

interface PairingCompleteResponse {
  session: { sessionId: string; state: string; clientRole: string };
  credentials: { sessionId: string; sessionToken: string; refreshToken: string; hubUrl: string };
}

describe('First-Hub/Home Onboarding without Home Assistant (P19.1)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('completes clean first-hub onboarding, establishes admin session, and persists home state across cold restarts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-first-onboarding-'));

    // Invariant: zero pre-existing HA environment variables or prototype credentials
    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;
    delete process.env.HAUS_STANDALONE;
    delete process.env.HAUS_APPLIANCE;
    delete process.env.HAUS_MODE;

    // --- Boot 1: Clean standalone Hub boot on empty directory ---
    const app1 = await createNestApp({ dataDirectory: dir });
    await app1.listen(0, '127.0.0.1');
    const port1 = (app1.getHttpServer().address() as AddressInfo).port;
    const base1 = `http://127.0.0.1:${port1}`;

    let sessionId = '';
    let sessionToken = '';
    let refreshToken = '';

    try {
      // 1. Verify Standalone Invariant: Zero HA connection and zero prototype credentials
      const haClient = new StandaloneHaClient();
      expect(haClient.connected).toBe(false);
      expect(await haClient.registry()).toEqual({ states: [], entities: [], devices: [], areas: [] });

      const healthRes = await fetch(`${base1}/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toMatchObject({ status: 'ok', mode: 'standalone', ha: false });

      // 2. Hub starts with onboarded: false (no admin sessions exist yet)
      const identityRes = await fetch(`${base1}/api/auth/identity`);
      expect(identityRes.status).toBe(200);
      const identity = (await identityRes.json()) as { hub: { hubId: string; homeId: string; name: string; onboarded: boolean } };
      expect(identity.hub.hubId).toBeDefined();
      expect(identity.hub.homeId).toBeDefined();
      expect(identity.hub.name).toBe('Haus Hub');
      expect(identity.hub.onboarded).toBe(false);

      // 3. Protected domain endpoints reject unauthenticated calls with 401
      const protectedEndpoints = ['/api/devices', '/api/scenes', '/api/automations', '/api/preferences'];
      for (const endpoint of protectedEndpoints) {
        expect((await fetch(`${base1}${endpoint}`)).status).toBe(401);
        expect((await fetch(`${base1}${endpoint}`, { headers: { authorization: 'Bearer invalid' } })).status).toBe(401);
      }

      // 4. Anonymous client initiates pairing challenge (no prototype credentials supplied)
      // First bind is zero-friction: code is auto-approved and returned for instant setup
      const challengeRes = await fetch(`${base1}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challengeBody = (await challengeRes.json()) as PairingChallengeResponse & {
        firstOnboarding?: boolean;
        challengeCode?: string;
      };
      expect(challengeBody.sessionId).toBeDefined();
      expect(challengeBody.firstOnboarding).toBe(true);
      expect(challengeBody.challengeCode).toBeDefined();
      expect(challengeBody.challengeCode).toMatch(/^[A-F0-9]{8}$/);
      const challengeCode = challengeBody.challengeCode!;

      // 5. Client confirms challenge using the first-claim auto-code
      // Note: First onboarding client is automatically granted role 'admin'
      const confirmRes = await fetch(`${base1}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challengeBody.sessionId,
          challengeCode,
          client: {
            clientId: 'desktop-first-client',
            clientName: 'Initial Admin Desktop',
            role: 'member', // First onboarding upgrades to admin automatically
          },
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmBody = (await confirmRes.json()) as PairingConfirmResponse;
      expect(confirmBody.grant.clientRole).toBe('admin');

      // 6. Exchange grant for session credentials
      const pairRes = await fetch(`${base1}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmBody.grant }),
      });
      expect([200, 201]).toContain(pairRes.status);
      const pairBody = (await pairRes.json()) as PairingCompleteResponse;
      sessionId = pairBody.credentials.sessionId;
      sessionToken = pairBody.credentials.sessionToken;
      refreshToken = pairBody.credentials.refreshToken;
      expect(pairBody.session.clientRole).toBe('admin');

      const authHeaders = {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,
      };

      // 7. Identity now reports onboarded: true
      const postPairIdentity = await (await fetch(`${base1}/api/auth/identity`)).json();
      expect(postPairIdentity.hub.onboarded).toBe(true);

      // 7b. Subsequent pairing: anonymous request receives no code; admin device gets pairing request modal data
      const subChallengeRes = await fetch(`${base1}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(subChallengeRes.status).toBe(201);
      const subChallengeBody = (await subChallengeRes.json()) as PairingChallengeResponse & {
        firstOnboarding?: boolean;
      };
      expect(subChallengeBody.firstOnboarding).toBe(false);
      expect(subChallengeBody.challengeCode).toBeUndefined();

      const pairingReqsRes = await fetch(`${base1}/api/auth/pairing-requests`, {
        headers: authHeaders,
      });
      expect(pairingReqsRes.status).toBe(200);
      const pairingReqs = (await pairingReqsRes.json()) as {
        requests: Array<{ sessionId: string; challengeCode: string }>;
      };
      expect(pairingReqs.requests).toHaveLength(1);
      expect(pairingReqs.requests[0].sessionId).toBe(subChallengeBody.sessionId);
      expect(pairingReqs.requests[0].challengeCode).toMatch(/^[A-F0-9]{8}$/);

      // Second client confirms using code displayed on the existing admin device
      const subConfirmRes = await fetch(`${base1}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: subChallengeBody.sessionId,
          challengeCode: pairingReqs.requests[0].challengeCode,
          client: {
            clientId: 'desktop-second-client',
            clientName: 'Second Client',
            role: 'member',
          },
        }),
      });
      expect(subConfirmRes.status).toBe(201);

      // Once confirmed, pending pairing request is cleared
      const clearedReqs = (await (await fetch(`${base1}/api/auth/pairing-requests`, { headers: authHeaders })).json()) as { requests: unknown[] };
      expect(clearedReqs.requests).toHaveLength(0);

      // 8. Newly onboarded admin customizes household name and preferences
      const prefRes = await fetch(`${base1}/api/preferences`, { headers: authHeaders });
      expect(prefRes.status).toBe(200);
      const initialPref = (await prefRes.json()) as { revision: string };

      const patchPrefRes = await fetch(`${base1}/api/preferences`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          baseRevision: initialPref.revision,
          patch: {
            homeName: 'The Solarium',
            favorites: ['light-kitchen-ceiling'],
          },
        }),
      });
      expect(patchPrefRes.status).toBe(200);
      const patched = (await patchPrefRes.json()) as { value: { homeName: string } };
      expect(patched.value.homeName).toBe('The Solarium');

      // 9. Admin registers first room device
      const createDevRes = await fetch(`${base1}/api/devices`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 'dev-kitchen-light',
          name: 'Kitchen Pendant',
          category: 'lighting',
          roomId: 'kitchen',
          endpoints: [
            {
              id: 'light:kitchen:pendant',
              name: 'Pendant Light',
              capabilities: ['on_off', 'brightness'],
              readings: {},
            },
          ],
        }),
      });
      expect(createDevRes.status).toBe(201);
    } finally {
      await app1.get(CatalogLifetime).close();
      await app1.close();
    }

    // 10. Verify SQLite token hashing: raw bearer and refresh tokens are NEVER plaintext
    const rawDb = new DatabaseSync(join(dir, 'haus.sqlite'), { readOnly: true });
    try {
      const row = rawDb
        .prepare('SELECT token_hash, refresh_token_hash FROM client_sessions WHERE session_id = ?')
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
      // 11. Hub preserves onboarded state after reboot
      const rebootIdentity = await (await fetch(`${base2}/api/auth/identity`)).json();
      expect(rebootIdentity.hub.onboarded).toBe(true);

      // 12. Paired session resumes cleanly without re-pairing
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

      // 13. Persisted home name and device catalog are intact
      const authHeaders = { authorization: `Bearer ${sessionToken}` };
      const resumedPref = await (await fetch(`${base2}/api/preferences`, { headers: authHeaders })).json();
      expect(resumedPref.value.homeName).toBe('The Solarium');

      const resumedDevices = await (await fetch(`${base2}/api/devices`, { headers: authHeaders })).json();
      expect(resumedDevices.devices).toHaveLength(1);
      expect(resumedDevices.devices[0].id).toBe('dev-kitchen-light');

      // 14. Session refresh token rotation succeeds
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
