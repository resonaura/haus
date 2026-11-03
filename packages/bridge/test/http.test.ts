/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CameraBridgeProvider } from '../src/provider.js';
import { CameraBridgeHttp } from '../src/http.js';
import { entityKeys } from '../src/protocol.js';

it('authenticates real HTTP inventory/handover and executes duplicate commands exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-provider-http-'));
  const provider = await new CameraBridgeProvider({
    directory,
    provider: 'tuya',
    name: 'Tuya',
  }).initialize();
  const revision = provider.updateInventory({
    version: 2,
    provider: 'tuya',
    bridgeId: provider.id,
    cameras: [
      {
        id: 'one',
        name: 'One',
        manufacturer: 'Tuya',
        model: 'Camera',
        available: true,
        identifiers: ['one'],
        stream: { url: 'rtsp://192.168.1.2:8554/one', transport: 'p2p' },
        snapshotPath: '/api/cameras/one/snapshot/last-live',
        entities: [
          {
            id: 'light',
            name: 'Spotlight',
            domain: 'light',
            writable: true,
            brightness: true,
            available: true,
            state: { on: false, brightness: 25 },
            updatedAt: 1,
          },
        ],
      },
    ],
  });
  const commands: unknown[] = [];
  const api = new CameraBridgeHttp({
    provider,
    command: async (...command) => {
      commands.push(command);
      await new Promise((resolve) => setTimeout(resolve, 15));
    },
  });
  const server = createServer((req, res) => {
    void api.handle(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port,
    origin = `http://127.0.0.1:${port}`;
  const post = (path: string, value: unknown, token = '') =>
    fetch(origin + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Haus-Client': '1',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(value),
    });
  try {
    const info = await fetch(origin + '/api/haus/v2/info').then((response) => response.json());
    expect(Object.keys(info).sort()).toEqual([
      'bridgeId',
      'name',
      'pairing',
      'provider',
      'version',
    ]);
    expect((await fetch(origin + '/api/haus/v2/inventory')).status).toBe(401);
    const { code } = provider.openPairing();
    const enrolled = await post('/api/haus/v2/enroll', { code, controllerId: randomUUID() }).then(
      (response) => response.json(),
    );
    const headers = { Authorization: `Bearer ${enrolled.token}` };
    const inventory = await fetch(origin + '/api/haus/v2/inventory', { headers }).then((response) =>
      response.json(),
    );
    expect(inventory.cameras).toHaveLength(1);
    const ready = await post(
      '/api/haus/v2/ready',
      { revision, entities: entityKeys(inventory) },
      enrolled.token,
    );
    expect(ready.status).toBe(200);
    expect(provider.shouldPublishMqtt()).toBe(false);
    const request = {
      requestId: randomUUID(),
      command: { action: 'set', value: { on: true, brightness: 35 } },
    };
    const path = '/api/haus/v2/cameras/one/entities/light/command';
    const responses = await Promise.all([
      post(path, request, enrolled.token),
      post(path, request, enrolled.token),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(commands).toHaveLength(1);
    expect(
      (
        await post(
          path,
          { ...request, command: { action: 'set', value: { on: false } } },
          enrolled.token,
        )
      ).status,
    ).toBe(400);
    expect(commands).toHaveLength(1);
    expect(
      (await fetch(origin + '/api/haus/v2/inventory?url=http://arbitrary', { headers })).status,
    ).toBe(404);
    await provider.revoke(enrolled.clientId);
    expect(provider.shouldPublishMqtt()).toBe(true);
    expect((await fetch(origin + '/api/haus/v2/inventory', { headers })).status).toBe(401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
