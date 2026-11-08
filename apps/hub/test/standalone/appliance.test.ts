/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createNestApp } from '../../src/nest.js';

describe('Explicit HA Appliance Mode Compatibility (ha-green)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const apiToken = 'appliance-admin-token';

  beforeAll(async () => {
    app = await createNestApp({ appliance: 'ha-green', apiToken });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('composes HA integration overlay when appliance is explicitly ha-green', async () => {
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({
      status: 'ok',
      mode: 'ha-appliance',
      ha: true,
    });

    const statusRes = await fetch(`${baseUrl}/api/status`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(statusRes.status).toBe(200);
    expect(((await statusRes.json()) as { mode: string }).mode).toBe('ha-appliance');

    const setupRes = await fetch(`${baseUrl}/api/ha-integration`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://ha-appliance.local:8123',
        token: 'ha-long-lived-token',
      }),
    });
    expect(setupRes.status).toBe(200);

    const enrollRes = await fetch(`${baseUrl}/ha/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'ha-green-core', options: {} }),
    });
    expect(enrollRes.status).toBe(200);
    const enrolled = (await enrollRes.json()) as { token: string };
    expect(typeof enrolled.token).toBe('string');

    const camerasRes = await fetch(`${baseUrl}/ha/cameras`, {
      headers: { authorization: `Bearer ${enrolled.token}` },
    });
    expect(camerasRes.status).toBe(200);
    const camerasBody = (await camerasRes.json()) as { profile: number; cameras: unknown[] };
    expect(camerasBody.profile).toBe(1);
    expect(Array.isArray(camerasBody.cameras)).toBe(true);
  });
});
