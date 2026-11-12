/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppManifest } from '@haus/apps';
import { createNestApp } from '../../src/nest.js';
import { AppSupervisor } from '../../src/home/supervisor.js';

const roots: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

beforeEach(() => {
  vi.stubEnv('HAUS_MATTER_URL', 'ws://127.0.0.1:1/ws');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('standalone App Supervisor service bridge', () => {
  it('mounts the restricted Supervisor API on the Hub listener', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-supervisor-hub-'));
    roots.push(root);
    const app = await createNestApp({ dataDirectory: root });
    try {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string') throw Error('test_listener_not_bound');

      const response = await fetch(`http://127.0.0.1:${address.port}/api/supervisor/services/mqtt`);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ result: 'error' });
    } finally {
      await app.close();
    }
  });

  it('restores a stable per-App token and exposes only authenticated MQTT details', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-supervisor-'));
    roots.push(root);
    const app: AppManifest = {
      id: 'aqara-camera',
      name: 'Aqara Camera',
      version: '1.0.0',
      image: 'aqara-camera:latest',
      architectures: ['amd64'],
      network: { mode: 'host' },
      services: ['mqtt:want'],
    };
    const options = {
      dataDirectory: root,
      port: 8790,
      env: { HAUS_MQTT_PORT: '1883', HAUS_MQTT_USER: 'haus-mqtt', HAUS_MQTT_PASS: 'secret' },
    };
    const supervisor = new AppSupervisor();
    await supervisor.configure(options);
    const runtime = await supervisor.register(app);
    const token = runtime.SUPERVISOR_TOKEN;
    expect(runtime.SUPERVISOR_API).toBe('http://127.0.0.1:8790/api/supervisor');
    expect(token).toMatch(/^[a-f0-9]{64}$/);

    const server = createServer((req, res) => {
      void supervisor.handleRequest(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('test_listener_not_bound');
    const url = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${url}/api/supervisor/services/mqtt`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const responseBody = await response.text();
    expect(response.status, responseBody).toBe(200);
    expect(JSON.parse(responseBody)).toMatchObject({
      result: 'ok',
      data: {
        host: '127.0.0.1',
        port: 1883,
        username: 'haus-mqtt',
        password: 'secret',
      },
    });

    const denied = await fetch(`${url}/api/supervisor/services/mqtt`);
    expect(denied.status).toBe(401);
    const unavailable = await fetch(`${url}/api/supervisor/addons/self/options`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unavailable.status).toBe(404);

    await supervisor.close();
    const restored = new AppSupervisor();
    await restored.configure(options);
    const restoredRuntime = await restored.register(app);
    expect(restoredRuntime.SUPERVISOR_TOKEN).toBe(token);
    await restored.close();
  });

  it('uses the Docker host gateway for bridge Apps and rejects unreachable networks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-supervisor-'));
    roots.push(root);
    const supervisor = new AppSupervisor();
    await supervisor.configure({ dataDirectory: root, port: 8790, env: {} });
    const app: AppManifest = {
      id: 'bridge-camera',
      name: 'Bridge Camera',
      version: '1.0.0',
      image: 'bridge-camera:latest',
      architectures: ['amd64'],
      services: ['mqtt:need'],
    };
    expect((await supervisor.register(app)).SUPERVISOR_API).toBe(
      'http://host.docker.internal:8790/api/supervisor',
    );
    await expect(supervisor.register({ ...app, network: { mode: 'none' } })).rejects.toThrow(
      'app_mqtt_unreachable_from_network',
    );
    await supervisor.close();
  });

  it('resolves ephemeral Hub ports only after the HTTP listener binds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-supervisor-'));
    roots.push(root);
    let listeningPort: number | undefined;
    const supervisor = new AppSupervisor();
    await supervisor.configure({
      dataDirectory: root,
      port: 0,
      listeningPort: () => listeningPort,
      env: {},
    });
    const app: AppManifest = {
      id: 'dynamic-port-camera',
      name: 'Dynamic Port Camera',
      version: '1.0.0',
      image: 'dynamic-port-camera:latest',
      architectures: ['amd64'],
      network: { mode: 'host' },
      services: ['mqtt:want'],
    };

    expect(await supervisor.register(app)).toEqual({});
    listeningPort = 38761;
    expect((await supervisor.register(app)).SUPERVISOR_API).toBe(
      'http://127.0.0.1:38761/api/supervisor',
    );
    await supervisor.close();
  });

  it('returns Bashio-safe empty credential fields when the broker has no auth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-app-supervisor-'));
    roots.push(root);
    const supervisor = new AppSupervisor();
    await supervisor.configure({
      dataDirectory: root,
      port: 8790,
      env: { HAUS_MQTT_PORT: '1883' },
    });
    const app: AppManifest = {
      id: 'camera-without-mqtt-auth',
      name: 'Camera without MQTT auth',
      version: '1.0.0',
      image: 'camera:latest',
      architectures: ['amd64'],
      network: { mode: 'host' },
      services: ['mqtt:want'],
    };
    const runtime = await supervisor.register(app);
    const server = createServer((req, res) => {
      void supervisor.handleRequest(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('test_listener_not_bound');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/supervisor/services/mqtt`, {
      headers: { authorization: `Bearer ${runtime.SUPERVISOR_TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: 'ok',
      data: { host: '127.0.0.1', port: 1883, username: '', password: '' },
    });
    await supervisor.close();
  });
});
