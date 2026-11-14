/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LanRelayRunner } from '../../../../scripts/lan-relay.js';

describe('Host LAN Discovery Relay', () => {
  it('enforces Bearer token auth on /scan, serves /health, and integrates with Hub endpoints', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'haus-relay-runner-'));
    const tokenPath = join(tempDir, 'token');
    writeFileSync(tokenPath, 'relay-unit-test-secret\n', 'utf8');

    const mockHub = createServer((req, res) => {
      if (req.url === '/api/commissioning/discoveries/service-types') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ serviceTypes: ['_esphomelib._tcp.local.'] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: 0, matched: 0, candidates: [] }));
    });
    await new Promise<void>((resolve) => mockHub.listen(0, '127.0.0.1', () => resolve()));
    const hubAddr = mockHub.address();
    const hubPort = typeof hubAddr === 'object' && hubAddr ? hubAddr.port : 0;

    const prevEnv = {
      HAUS_HUB_URL: process.env.HAUS_HUB_URL,
      HAUS_RELAY_PORT: process.env.HAUS_RELAY_PORT,
      HAUS_RELAY_HOSTS: process.env.HAUS_RELAY_HOSTS,
      HAUS_RELAY_TOKEN_FILE: process.env.HAUS_RELAY_TOKEN_FILE,
    };
    process.env.HAUS_HUB_URL = `http://127.0.0.1:${hubPort}`;
    process.env.HAUS_RELAY_PORT = '0';
    process.env.HAUS_RELAY_HOSTS = '127.0.0.1';
    process.env.HAUS_RELAY_TOKEN_FILE = tokenPath;

    const runner = new LanRelayRunner();
    try {
      await runner.start();
      const bound = runner.getBoundAddresses();
      expect(bound).toHaveLength(1);
      const baseUrl = `http://${bound[0].host}:${bound[0].port}`;

      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { status: string };
      expect(healthBody.status).toBe('ok');

      const noAuth = await fetch(`${baseUrl}/scan`, { method: 'POST', body: '{}' });
      expect(noAuth.status).toBe(401);

      const badAuth = await fetch(`${baseUrl}/scan`, {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token' },
        body: '{}',
      });
      expect(badAuth.status).toBe(401);

      const okRes = await fetch(`${baseUrl}/scan`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer relay-unit-test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ timeoutMs: 300 }),
      });
      expect(okRes.status).toBe(200);
      const scanBody = (await okRes.json()) as {
        scannedAt: string;
        advertisements: unknown[];
      };
      expect(typeof scanBody.scannedAt).toBe('string');
      expect(Array.isArray(scanBody.advertisements)).toBe(true);
    } finally {
      await runner.stop();
      await new Promise<void>((resolve) => mockHub.close(() => resolve()));
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
