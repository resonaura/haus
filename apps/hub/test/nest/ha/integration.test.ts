/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createNestApp } from '../../../src/nest.js';

describe('HA Mode NativeEntities, NativeMigration, and ActivityMqtt in Nest (P14.5.5.4)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let root: string;
  const apiToken = 'ha-appliance-test-admin-token';

  beforeAll(async () => {
    root = join(tmpdir(), `haus-ha-appliance-${randomBytes(6).toString('hex')}`);
    app = await createNestApp({
      dataDirectory: root,
      appliance: 'ha-green',
      apiToken,
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('boots in ha-appliance mode and reports HA enabled in health check', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('ha-appliance');
    expect(body.ha).toBe(true);
  });

  it('performs HA integration setup and client enrollment with setup codes', async () => {
    // 1. Read-only setup (nativeEntities: false)
    const readSetupRes = await fetch(`${baseUrl}/api/ha-integration`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'setup', nativeEntities: false }),
    });
    expect(readSetupRes.status).toBe(200);
    const readSetup = (await readSetupRes.json()) as { setupCode: string; nativeEntities: boolean };
    expect(typeof readSetup.setupCode).toBe('string');
    expect(readSetup.nativeEntities).toBe(false);

    // Enroll read-only client
    const readEnrollRes = await fetch(`${baseUrl}/ha/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: readSetup.setupCode }),
    });
    expect(readEnrollRes.status).toBe(200);
    const readClient = (await readEnrollRes.json()) as { token: string; clientId: string };
    expect(typeof readClient.token).toBe('string');

    // 2. Native entities setup (nativeEntities: true)
    const nativeSetupRes = await fetch(`${baseUrl}/api/ha-integration`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'setup', nativeEntities: true }),
    });
    expect(nativeSetupRes.status).toBe(200);
    const nativeSetup = (await nativeSetupRes.json()) as {
      setupCode: string;
      nativeEntities: boolean;
    };
    expect(nativeSetup.nativeEntities).toBe(true);

    // Enroll native client
    const nativeEnrollRes = await fetch(`${baseUrl}/ha/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: nativeSetup.setupCode }),
    });
    expect(nativeEnrollRes.status).toBe(200);
    const nativeClient = (await nativeEnrollRes.json()) as { token: string; clientId: string };
    expect(typeof nativeClient.token).toBe('string');

    // 3. Verify access control: read-only client gets 403 on native devices
    const readForbiddenRes = await fetch(`${baseUrl}/ha/native/devices`, {
      headers: { authorization: `Bearer ${readClient.token}` },
    });
    expect(readForbiddenRes.status).toBe(403);
    const forbiddenBody = await readForbiddenRes.json();
    expect(forbiddenBody.error).toBe('native_access_required');

    // 4. Native client gets 200 on native devices
    const nativeAllowedRes = await fetch(`${baseUrl}/ha/native/devices`, {
      headers: { authorization: `Bearer ${nativeClient.token}` },
    });
    expect(nativeAllowedRes.status).toBe(200);
    const nativeDevices = (await nativeAllowedRes.json()) as { devices: unknown[] };
    expect(Array.isArray(nativeDevices.devices)).toBe(true);

    // 5. Basic auth compatibility: snapshot endpoint accepts Basic haus:<token>
    const basicAuth = 'Basic ' + Buffer.from(`haus:${readClient.token}`).toString('base64');
    const snapshotRes = await fetch(`${baseUrl}/ha/cameras/camera.test/snapshot`, {
      headers: { authorization: basicAuth },
    });
    // Camera not found returns 404, proving authentication passed!
    expect([200, 404]).toContain(snapshotRes.status);

    // Basic auth on /ha/cameras must be rejected with 401
    const camerasBasicRes = await fetch(`${baseUrl}/ha/cameras`, {
      headers: { authorization: basicAuth },
    });
    expect(camerasBasicRes.status).toBe(401);

    // Bearer auth on /ha/cameras succeeds with 200
    const camerasBearerRes = await fetch(`${baseUrl}/ha/cameras`, {
      headers: { authorization: `Bearer ${readClient.token}` },
    });
    expect(camerasBearerRes.status).toBe(200);
    const camerasList = (await camerasBearerRes.json()) as { profile: number; cameras: unknown[] };
    expect(camerasList.profile).toBe(1);

    // 6. Native readiness acknowledge
    const readyRes = await fetch(`${baseUrl}/ha/native/ready`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${nativeClient.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        cameras: [],
        features: { disabledReadiness: true },
      }),
    });
    expect(readyRes.status).toBe(200);

    // 7. Handover status query at /api/providers/handover
    const handoverListRes = await fetch(`${baseUrl}/api/providers/handover`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(handoverListRes.status).toBe(200);
    const handoverList = (await handoverListRes.json()) as { providers: unknown[] };
    expect(Array.isArray(handoverList.providers)).toBe(true);
  });
});
