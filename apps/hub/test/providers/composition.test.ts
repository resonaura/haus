/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { createNestApp } from '../../src/nest.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';

const token = 'native-provider-composition-token';
let root = '';
let app: INestApplication | undefined;

afterEach(async () => {
  try {
    await app?.close();
  } finally {
    app = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
    vi.unstubAllEnvs();
  }
});

it('wires native provider routes into the executable standalone Hub composition', async () => {
  vi.stubEnv('HAUS_MQTT_PORT', '0');
  vi.stubEnv('HAUS_MQTT_HOST', '127.0.0.1');
  root = await mkdtemp(join(tmpdir(), 'haus-provider-composition-'));
  app = await createNestApp({ dataDirectory: root, apiToken: token });
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw Error('fixture_listener_unavailable');
  const headers = { Authorization: `Bearer ${token}` };
  const base = `http://127.0.0.1:${address.port}`;
  // Compatibility composition includes several auth services. Seed the real guards' stores
  // so the assertion tests the guest role rather than an unrelated unknown-token failure.
  for (const auth of app.get<HubAuthService>(HUB_AUTH_SERVICE, { each: true })) {
    auth.registerToken('app-fixture-guest', { clientRole: 'guest' });
    expect(await auth.authenticate('app-fixture-guest')).toMatchObject({ clientRole: 'guest' });
  }
  const anonymous = await fetch(`${base}/api/apps/missing/accessories`);
  expect(anonymous.status).toBe(401);
  for (const [path, body] of [
    ['apps/missing/accessories/sync', {}],
    ['apps/missing/execute', { action: 'restart' }],
    ['apps/missing/operate', { operation: 'configure', options: {} }],
    ['apps/install', { manifest: { id: 'must-not-install' } }],
  ] as const) {
    const denied = await fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer app-fixture-guest', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(denied.status).toBe(403);
  }

  const listed = await fetch(`http://127.0.0.1:${address.port}/api/providers`, { headers });
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual({ providers: [] });

  const handover = await fetch(`http://127.0.0.1:${address.port}/api/providers/handover`, {
    headers,
  });
  expect(handover.status).toBe(501);
  expect(await handover.json()).toMatchObject({ error: 'provider_handover_unavailable' });

  const migration = await fetch(
    `http://127.0.0.1:${address.port}/api/providers/fixture-bridge/migration`,
    { headers },
  );
  expect(migration.status).toBe(501);
  expect(await migration.json()).toMatchObject({ error: 'provider_migration_unavailable' });
});
