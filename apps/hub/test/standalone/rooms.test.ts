/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNestApp } from '../../src/nest.js';

const ADMIN_TOKEN = 'rooms-test-admin-token';

async function bootApp(dataDirectory: string): Promise<{ app: INestApplication; baseUrl: string }> {
  process.env.HAUS_API_TOKEN = ADMIN_TOKEN;
  const app = await createNestApp({ dataDirectory });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function pairAdminSession(baseUrl: string): Promise<string> {
  const identity = await (await fetch(`${baseUrl}/api/auth/identity`)).json();
  const challenge = await (
    await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({}),
    })
  ).json();
  const confirm = await (
    await fetch(`${baseUrl}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: challenge.sessionId,
        client: { clientId: 'desktop-rooms-test', clientName: 'Desktop Test', role: 'admin' },
        challengeCode: challenge.challengeCode,
        expectedHomeId: identity.hub.homeId,
      }),
    })
  ).json();
  const pair = await (
    await fetch(`${baseUrl}/api/auth/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant: confirm.grant }),
    })
  ).json();
  return pair.credentials.sessionToken as string;
}

describe('Standalone Hub Rooms CRUD, Device Assignment & SQLite Persistence', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'haus-hub-rooms-'));
  let app: INestApplication | undefined;
  let baseUrl = '';
  let token = '';

  beforeAll(async () => {
    const started = await bootApp(dataDir);
    app = started.app;
    baseUrl = started.baseUrl;
    token = await pairAdminSession(baseUrl);
  });

  afterAll(async () => {
    if (app) await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates Cyrillic & Latin rooms, prevents duplicate names, updates icon & name, and persists across restart', async () => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const createRu = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Спальня', icon: 'bed' }),
    });
    expect(createRu.status).toBe(201);
    const ruBody = await createRu.json();
    expect(ruBody.room).toMatchObject({ id: 'spalnya', name: 'Спальня', icon: 'bed' });

    const duplicateRes = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '  спальня  ' }),
    });
    expect(duplicateRes.status).toBe(409);
    expect(await duplicateRes.json()).toMatchObject({ error: 'room_name_exists' });

    const createKitchen = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Kitchen', icon: 'utensils' }),
    });
    expect(createKitchen.status).toBe(201);
    const kitchen = (await createKitchen.json()).room;
    expect(kitchen.id).toBe('kitchen');

    const updateRes = await fetch(`${baseUrl}/api/rooms/spalnya`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Гостиная', icon: null }),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).room).toEqual({ id: 'spalnya', name: 'Гостиная' });

    const listBeforeRestart = await (await fetch(`${baseUrl}/api/rooms`, { headers })).json();
    expect(listBeforeRestart.rooms).toEqual([
      { id: 'kitchen', name: 'Kitchen', icon: 'utensils' },
      { id: 'spalnya', name: 'Гостиная' },
    ]);

    // Restart Hub against the same SQLite directory to verify cold persistence of empty rooms.
    await app!.close();
    const restarted = await bootApp(dataDir);
    app = restarted.app;
    baseUrl = restarted.baseUrl;

    const listAfterRestart = await (await fetch(`${baseUrl}/api/rooms`, { headers })).json();
    expect(listAfterRestart.rooms).toEqual([
      { id: 'kitchen', name: 'Kitchen', icon: 'utensils' },
      { id: 'spalnya', name: 'Гостиная' },
    ]);
  });

  it('assigns, renames, unassigns devices, strips deleted room from scenes & keeps alias commands working', async () => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const deviceRes = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: 'dev-bedroom-lamp',
        name: 'Table Lamp',
        category: 'lighting',
        roomId: 'unassigned',
        available: true,
        endpoints: [
          {
            id: 'light.unassigned_table_lamp',
            deviceId: 'dev-bedroom-lamp',
            name: 'Table Lamp',
            capabilities: [
              { id: 'on_off', type: 'binary', readable: true, writable: true, eventDriven: true },
            ],
            readings: [{ capabilityId: 'on_off', value: false, updatedAt: Date.now() }],
          },
        ],
        services: [{ protocol: 'zigbee', externalId: 'zb-lamp-1' }],
      }),
    });
    expect(deviceRes.status).toBe(201);

    const assignRes = await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Reading Lamp', roomId: 'kitchen' }),
    });
    expect(assignRes.status).toBe(200);
    const assigned = (await assignRes.json()).device;
    expect(assigned.id).toBe('dev-bedroom-lamp');
    expect(assigned.name).toBe('Reading Lamp');
    expect(assigned.roomId).toBe('kitchen');

    const badRoomRes = await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ roomId: 'does-not-exist' }),
    });
    expect(badRoomRes.status).toBe(404);
    expect(await badRoomRes.json()).toMatchObject({ error: 'target_room_not_found' });

    const sceneRes = await fetch(`${baseUrl}/api/scenes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: 'scene-kitchen-cooking',
        name: 'Cooking',
        roomId: 'kitchen',
        members: [
          {
            endpointId: 'light.unassigned_table_lamp',
            capability: 'on_off',
            command: 'turn_on',
          },
        ],
      }),
    });
    expect(sceneRes.status).toBe(201);

    // Deleting room moves devices back to unassigned & clears scene roomId.
    const deleteRes = await fetch(`${baseUrl}/api/rooms/kitchen`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({
      deleted: true,
      roomId: 'kitchen',
      movedDeviceIds: ['dev-bedroom-lamp'],
      updatedSceneIds: ['scene-kitchen-cooking'],
    });

    const deviceAfterDelete = await (
      await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp`, { headers })
    ).json();
    expect(deviceAfterDelete.device.roomId).toBe('unassigned');

    const scenesBody = await (await fetch(`${baseUrl}/api/scenes`, { headers })).json();
    const cookingScene = scenesBody.scenes.find((s: { id: string }) => s.id === 'scene-kitchen-cooking');
    expect(cookingScene.roomId).toBeUndefined();

    // Alias command still targets the endpoint cleanly even after move, rename, and room delete.
    const cmdRes = await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        endpointId: 'light.unassigned_table_lamp',
        capability: 'on_off',
        command: 'turn_on',
      }),
    });
    expect(cmdRes.status).toBe(200);

    // Explicitly move to spalnya then unassign via move-room endpoint ('unassigned').
    const moveRes = await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp/move-room`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetRoomId: 'spalnya' }),
    });
    expect(moveRes.status).toBe(200);
    const unassignRes = await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp/move-room`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetRoomId: 'unassigned' }),
    });
    expect(unassignRes.status).toBe(200);

    const finalDevice = await (
      await fetch(`${baseUrl}/api/devices/dev-bedroom-lamp`, { headers })
    ).json();
    expect(finalDevice.device.roomId).toBe('unassigned');
  });
});
