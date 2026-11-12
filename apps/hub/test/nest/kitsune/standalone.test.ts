/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNestApp } from '../../../src/nest.js';

describe('Standalone Kitsune Compatibility Engine & Home Registry Sync (P16.6.3)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const token = 'standalone-kitsune-token';
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  beforeAll(async () => {
    app = await createNestApp({ apiToken: token });
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 8797;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('serves vendor catalog, onboards with secret redaction, syncs created devices into Home, and enforces session leases', async () => {
    const catRes = await fetch(`${baseUrl}/api/kitsune/catalog`, { headers });
    expect(catRes.status).toBe(200);
    const catBody = await catRes.json();
    expect(catBody.vendors.some((v: { id: string }) => v.id === 'onvif')).toBe(true);

    const onboardRes = await fetch(`${baseUrl}/api/kitsune/onvif/onboard`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fields: {
          ip: '192.168.10.50',
          username: 'admin',
          password: 'super-secret-onvif-password',
        },
      }),
    });
    expect(onboardRes.status).toBe(201);
    const onboardBody = await onboardRes.json();
    expect(onboardBody.created.enabled).toBe(true);

    const createRes = await fetch(`${baseUrl}/api/kitsune/onvif/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        settings: {
          nativeId: 'driveway-cam',
          name: 'Driveway Camera',
          roomId: 'room-garage',
          interfaces: ['VideoCamera', 'MotionSensor', 'PanTiltZoom'],
          state: { online: true, motionDetected: true },
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.created.deviceId).toBe('kitsune:onvif:driveway-cam');

    const compatRes = await fetch(`${baseUrl}/api/kitsune/compatibility`, { headers });
    expect(compatRes.status).toBe(200);
    const compatBody = await compatRes.json();
    expect(compatBody.matrix).toHaveLength(4);
    expect(JSON.stringify(compatBody.diagnostics)).not.toContain('super-secret-onvif-password');
    expect(
      compatBody.unsupportedCapabilities.some(
        (u: { capability: string }) => u.capability === 'PanTiltZoom',
      ),
    ).toBe(true);

    // Verify device was registered into StandaloneHomeService and supports atomic room move
    const moveRes = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent('kitsune:onvif:driveway-cam')}/move-room`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetRoomId: 'room-patio' }),
      },
    );
    expect(moveRes.status).toBe(200);
    const moveBody = await moveRes.json();
    expect(moveBody.toRoomId).toBe('room-patio');

    // Session lease conflict enforcement
    const acquire1 = await fetch(`${baseUrl}/api/kitsune/sessions/acquire`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        runtime: 'homebridge',
        pluginId: 'homebridge-hue',
        ownerId: 'worker-a',
      }),
    });
    expect(acquire1.status).toBe(201);

    const acquireConflict = await fetch(`${baseUrl}/api/kitsune/sessions/acquire`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        runtime: 'homebridge',
        pluginId: 'homebridge-hue',
        ownerId: 'worker-b',
      }),
    });
    expect(acquireConflict.status).toBe(409);

    const restartRes = await fetch(`${baseUrl}/api/kitsune/sessions/restart`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        runtime: 'homebridge',
        pluginId: 'homebridge-hue',
        ownerId: 'worker-a',
      }),
    });
    expect(restartRes.status).toBe(201);
    expect((await restartRes.json()).session.epoch).toBe(2);
  });
});
