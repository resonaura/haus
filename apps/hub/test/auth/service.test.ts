/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HubAuthService } from '../../src/auth/service.js';
import { handleAuthRoute } from '../../src/auth/routes.js';
import type { PairingGrant } from '@haus/core/pairing';

type AuthApiResponse = {
  status?: string;
  error?: string;
  session?: { state: string; sessionId: string; hubId: string; token?: string };
  credentials?: { sessionToken: string; refreshToken: string; sessionId: string; hubUrl?: string };
};

describe('Hub Auth Service and HTTP Routes', () => {
  const hubId = 'hub-test-node-1';
  const homeId = 'home-maple-99';
  const hubUrl = 'http://127.0.0.1:8443';

  function createTestService(nowVal = 1_000_000) {
    let nowTime = nowVal;
    let tokenIdx = 1;
    const service = new HubAuthService({
      hubId,
      homeId,
      hubUrl,
      sessionTtlMs: 500_000,
      now: () => nowTime,
      tokenGenerator: () => `tok-${tokenIdx++}`,
    });

    return {
      service,
      setNow: (val: number) => {
        nowTime = val;
      },
    };
  }

  const validGrant: PairingGrant = {
    grantId: 'grant-xyz',
    hubId,
    homeId,
    clientId: 'client-desktop-1',
    clientRole: 'admin',
    clientName: 'Main Desktop',
    issuedAt: 1_000_000,
    expiresAt: 2_000_000,
    revoked: false,
  };

  async function withServer(service: HubAuthService, fn: (baseUrl: string) => Promise<void>) {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const handled = await handleAuthRoute(req, res, url.pathname, { service });
      if (!handled) {
        res.writeHead(404).end('not_found');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      await fn(baseUrl);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('pairs with a valid grant and returns credentials and safe view', async () => {
    const { service } = createTestService();

    await withServer(service, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: validGrant }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as AuthApiResponse;
      expect(data.session).toBeDefined();
      expect(data.session?.state).toBe('active');
      expect(data.session?.sessionId).toBe('tok-1');
      expect(data.session?.hubId).toBe(hubId);
      expect(data.session?.token).toBeUndefined(); // Safe view!

      expect(data.credentials).toBeDefined();
      expect(data.credentials?.sessionToken).toBe('tok-2');
      expect(data.credentials?.refreshToken).toBe('tok-3');
      expect(data.credentials?.hubUrl).toBe(hubUrl);
    });
  });

  it('rejects pairing for wrong home or revoked grant', async () => {
    const { service } = createTestService();

    await withServer(service, async (baseUrl) => {
      // Wrong home
      const wrongHome = { ...validGrant, homeId: 'wrong-home' };
      const res1 = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: wrongHome }),
      });
      expect(res1.status).toBe(403);

      // Revoked grant
      const revoked = { ...validGrant, revoked: true };
      const res2 = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: revoked }),
      });
      expect(res2.status).toBe(401);
    });
  });

  it('resumes active session and rejects expired or revoked session', async () => {
    const { service, setNow } = createTestService(1_000_000);
    const { credentials } = await service.pair(validGrant);

    await withServer(service, async (baseUrl) => {
      // 1. Successful resume
      const resActive = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credentials.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(resActive.status).toBe(200);
      const activeData = (await resActive.json()) as AuthApiResponse;
      expect(activeData.status).toBe('active');
      expect(activeData.session?.sessionId).toBe(credentials.sessionId);

      // 2. Wrong token resume
      const resWrongToken = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer wrong-token',
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(resWrongToken.status).toBe(401);

      // 3. Expired session resume
      setNow(1_600_000); // Exceeded 1_500_000 expiry
      const resExpired = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credentials.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(resExpired.status).toBe(401);
      const expiredData = (await resExpired.json()) as AuthApiResponse;
      expect(expiredData.error).toBe('session_expired');

      // 4. Revoked session resume
      setNow(1_200_000);
      await service.logout(credentials.sessionId);
      const resRevoked = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credentials.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(resRevoked.status).toBe(401);
      const revokedData = (await resRevoked.json()) as AuthApiResponse;
      expect(revokedData.error).toBe('session_revoked');
    });
  });

  it('rotates tokens on refresh and invalidates old credentials', async () => {
    const { service, setNow } = createTestService(1_000_000);
    const { credentials } = await service.pair(validGrant);

    await withServer(service, async (baseUrl) => {
      setNow(1_400_000);
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: credentials.sessionId,
          refreshToken: credentials.refreshToken,
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as AuthApiResponse;
      expect(data.status).toBe('renewed');
      expect(data.credentials?.sessionToken).not.toBe(credentials.sessionToken);
      expect(data.credentials?.refreshToken).not.toBe(credentials.refreshToken);

      // Old sessionToken can no longer be used
      const oldResume = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credentials.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(oldResume.status).toBe(401);

      // New sessionToken works
      const newResume = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${data.credentials?.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(newResume.status).toBe(200);
    });
  });

  it('logs out and revokes the session', async () => {
    const { service } = createTestService();
    const { credentials } = await service.pair(validGrant);

    await withServer(service, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.sessionToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as AuthApiResponse;
      expect(data.status).toBe('logged_out');

      // Subsequent session check returns revoked
      const resCheck = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credentials.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: credentials.sessionId }),
      });
      expect(resCheck.status).toBe(401);
    });
  });
});
