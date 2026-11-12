/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerApps, type DockerPort } from '../src/docker.js';
import { DockerSocket } from '../src/socket.js';
import type { AppOperation } from '../src/types.js';

describe('DockerApps Driver Contract & Operations', () => {
  const ownedId = 'a'.repeat(64);
  const foreignId = 'b'.repeat(64);

  function createMockPort(customContainers?: unknown[]) {
    const containers = customContainers ?? [
      {
        Id: ownedId,
        Names: ['/zigbee2mqtt'],
        Image: 'koenkk/zigbee2mqtt:1.35.1',
        State: 'running',
        Labels: {
          'io.haus.app': 'zigbee2mqtt',
          'org.opencontainers.image.version': '1.35.1',
        },
      },
      {
        Id: foreignId,
        Names: ['/unrelated-db'],
        Image: 'postgres:16',
        State: 'running',
        Labels: {},
      },
    ];

    const request = vi.fn(async (method: string, path: string) => {
      if (method === 'GET' && path === '/version') {
        return { ApiVersion: '1.45', MinAPIVersion: '1.24' };
      }
      if (method === 'GET' && path === '/v1.45/containers/json?all=1') {
        return containers;
      }
      if (method === 'POST' && path.startsWith('/v1.45/containers/')) {
        return undefined;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    return { request: request as never as DockerPort['request'], mockFn: request };
  }

  it('declares explicit capabilities with lifecycle always true', () => {
    const port = createMockPort();
    const driver = new DockerApps('docker-local', port);

    expect(driver.id).toBe('docker-local');
    expect(driver.capabilities).toEqual({
      lifecycle: true,
      install: false,
      remove: false,
      update: false,
      configure: false,
      logs: false,
      info: true,
    });
  });

  it('lists containers, mapping Haus managed apps vs foreign containers', async () => {
    const port = createMockPort();
    const driver = new DockerApps('docker-local', port);

    const apps = await driver.list();
    expect(apps).toHaveLength(2);

    const managed = apps.find((a) => a.externalId === ownedId)!;
    expect(managed.name).toBe('zigbee2mqtt');
    expect(managed.image).toBe('koenkk/zigbee2mqtt:1.35.1');
    expect(managed.version).toBe('1.35.1');
    expect(managed.state).toBe('running');
    expect(managed.managed).toBe(true);
    expect(managed.actions).toEqual(['start', 'stop', 'restart']);

    const foreign = apps.find((a) => a.externalId === foreignId)!;
    expect(foreign.name).toBe('unrelated-db');
    expect(foreign.managed).toBe(false);
    expect(foreign.actions).toEqual([]);
  });

  it('maps container states correctly', async () => {
    const rows = [
      { Id: '1'.repeat(64), State: 'running', Labels: { 'io.haus.app': 'app1' } },
      { Id: '2'.repeat(64), State: 'restarting', Labels: { 'io.haus.app': 'app2' } },
      { Id: '3'.repeat(64), State: 'exited', Labels: { 'io.haus.app': 'app3' } },
      { Id: '4'.repeat(64), State: 'created', Labels: { 'io.haus.app': 'app4' } },
      { Id: '5'.repeat(64), State: 'dead', Labels: { 'io.haus.app': 'app5' } },
      { Id: '6'.repeat(64), State: 'paused', Labels: { 'io.haus.app': 'app6' } },
    ];
    const port = createMockPort(rows);
    const driver = new DockerApps('docker-local', port);

    const apps = await driver.list();
    expect(apps.find((a) => a.externalId === '1'.repeat(64))?.state).toBe('running');
    expect(apps.find((a) => a.externalId === '2'.repeat(64))?.state).toBe('starting');
    expect(apps.find((a) => a.externalId === '3'.repeat(64))?.state).toBe('stopped');
    expect(apps.find((a) => a.externalId === '4'.repeat(64))?.state).toBe('stopped');
    expect(apps.find((a) => a.externalId === '5'.repeat(64))?.state).toBe('stopped');
    expect(apps.find((a) => a.externalId === '6'.repeat(64))?.state).toBe('unknown');
  });

  it('executes start/stop/restart on managed containers and fences unmanaged', async () => {
    const port = createMockPort();
    const driver = new DockerApps('docker-local', port);

    await driver.execute(ownedId, 'stop');
    expect(port.mockFn).toHaveBeenCalledWith(
      'POST',
      `/v1.45/containers/${ownedId}/stop`,
      undefined,
    );

    await driver.execute(ownedId, 'start');
    expect(port.mockFn).toHaveBeenCalledWith(
      'POST',
      `/v1.45/containers/${ownedId}/start`,
      undefined,
    );

    await driver.execute(ownedId, 'restart');
    expect(port.mockFn).toHaveBeenCalledWith(
      'POST',
      `/v1.45/containers/${ownedId}/restart`,
      undefined,
    );

    // Foreign container execution must be strictly rejected
    await expect(driver.execute(foreignId, 'stop')).rejects.toThrow('unmanaged_app');

    // Invalid format / command injection rejected
    await expect(driver.execute('invalid-id', 'start')).rejects.toThrow('invalid_app_action');
    await expect(driver.execute('../escape', 'start')).rejects.toThrow('invalid_app_action');
  });

  it('inspects a known managed app and returns detailed AppInfo', async () => {
    const port = createMockPort();
    const driver = new DockerApps('docker-local', port);

    const result = await driver.inspect(ownedId);
    expect(result.status).toBe('ok');
    expect(result.data).toEqual({
      externalId: ownedId,
      name: 'zigbee2mqtt',
      version: '1.35.1',
      image: 'koenkk/zigbee2mqtt:1.35.1',
      state: 'running',
      managed: true,
    });
  });

  it('returns error when inspecting unknown or invalid app ID', async () => {
    const port = createMockPort();
    const driver = new DockerApps('docker-local', port);

    const invalid = await driver.inspect('invalid-short-id');
    expect(invalid.status).toBe('error');
    expect(invalid.reason).toBe('invalid_app_id');

    const unknown = await driver.inspect('c'.repeat(64));
    expect(unknown.status).toBe('error');
    expect(unknown.reason).toBe('unknown_app');
  });

  it('returns explicit unsupported for non-implemented extended operations', async () => {
    const port = createMockPort();
    const driver = new DockerApps('docker-local', port);

    const unsupportedOps: AppOperation[] = ['install', 'remove', 'update', 'configure', 'logs'];
    for (const op of unsupportedOps) {
      const result = await driver.operate(op, ownedId);
      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe(`docker_driver_does_not_support_${op}`);
    }
  });

  it('rejects unsupported Docker API versions', async () => {
    const port: DockerPort = {
      request: vi.fn(async () => ({ ApiVersion: '1.20', MinAPIVersion: '1.15' })),
    };
    const driver = new DockerApps('docker-old', port, { minimum: 41, maximum: 56 });
    await expect(driver.list()).rejects.toThrow('unsupported_docker_api');
  });
});

describe('DockerSocket Transport & Security Invariants', () => {
  let server: Server | undefined;
  let socketPath: string;

  beforeEach(() => {
    socketPath = join(
      tmpdir(),
      `test-docker-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
    );
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // Ignore cleanup
    }
  });

  it('rejects invalid socket paths during instantiation', () => {
    expect(() => new DockerSocket('relative/path.sock')).toThrow('invalid_docker_socket');
    expect(() => new DockerSocket('/path\0with/null.sock')).toThrow('invalid_docker_socket');
    expect(() => new DockerSocket('/' + 'a'.repeat(1025))).toThrow('invalid_docker_socket');
  });

  it('strictly enforces the operation allowlist before dispatching requests', async () => {
    const socket = new DockerSocket('/var/run/docker.sock');

    // Forbidden GET operations
    await expect(socket.request('GET', '/containers/json')).rejects.toThrow(
      'docker_operation_not_allowed',
    );
    await expect(socket.request('GET', '/v1.45/images/json')).rejects.toThrow(
      'docker_operation_not_allowed',
    );
    await expect(socket.getHostPlatform()).rejects.toThrow('docker_unavailable');
    await expect(socket.request('GET', '/v1.45/exec/123/json')).rejects.toThrow(
      'docker_operation_not_allowed',
    );

    // Forbidden POST operations (forbidden mounts, arbitrary exec/image endpoints)
    await expect(
      socket.request('POST', '/v1.45/containers/create', {
        HostConfig: { Binds: ['/var/run/docker.sock:/docker.sock'] },
      }),
    ).rejects.toThrow('docker_operation_not_allowed');
    await expect(socket.request('POST', '/v1.45/exec/create')).rejects.toThrow(
      'docker_operation_not_allowed',
    );
    await expect(
      socket.request('POST', `/v1.45/containers/${'a'.repeat(64)}/kill`),
    ).rejects.toThrow('docker_operation_not_allowed');
    await expect(
      socket.request('POST', `/v1.45/containers/${'a'.repeat(64)}/pause`),
    ).rejects.toThrow('docker_operation_not_allowed');
    await expect(socket.request('POST', '/v1.45/images/create')).rejects.toThrow(
      'docker_operation_not_allowed',
    );

    // Forbidden DELETE operations (cannot delete images, volumes, etc.)
    await expect(socket.request('DELETE' as never, '/v1.45/images/test-image')).rejects.toThrow(
      'docker_operation_not_allowed',
    );
    await expect(socket.request('DELETE' as never, '/v1.45/volumes/test-volume')).rejects.toThrow(
      'docker_operation_not_allowed',
    );
  });

  it('communicates over Unix domain socket with bounded response limits', async () => {
    server = createServer((req, res) => {
      if (req.url === '/version' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ApiVersion: '1.45' }));
        return;
      }
      if (req.url === '/v1.45/containers/json?all=1' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server!.listen(socketPath, () => resolve()));

    const socket = new DockerSocket(socketPath);
    const version = await socket.request<{ ApiVersion: string }>('GET', '/version');
    expect(version.ApiVersion).toBe('1.45');

    const containers = await socket.request<unknown[]>('GET', '/v1.45/containers/json?all=1');
    expect(containers).toEqual([]);
  });

  it('inspects, pulls, and builds through explicit Docker image methods with progress', async () => {
    const requests: string[] = [];
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (req.method === 'GET' && req.url === '/v1.45/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ OSType: 'linux', Architecture: 'aarch64', Variant: 'v8' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1.45/images/ghcr.io/haus/fixture:1.0/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'arm64' }),
        );
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/v1.45/images/create?')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(`${JSON.stringify({ progressDetail: { current: 2, total: 4 } })}\n`);
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/v1.45/build?')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(`${JSON.stringify({ progressDetail: { current: 4, total: 4 } })}\n`);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(socketPath, () => resolve()));

    const socket = new DockerSocket(socketPath);
    const platform = await socket.getHostPlatform();
    const image = await socket.inspectImage('ghcr.io/haus/fixture:1.0');
    const pullProgress: Array<{ current?: number; total?: number }> = [];
    const buildProgress: Array<{ current?: number; total?: number }> = [];
    await socket.pullImage('ghcr.io/haus/fixture:1.0', 'linux/arm64', (value) =>
      pullProgress.push(value),
    );
    await socket.buildImage(
      {
        repository: 'https://github.com/haus/fixture',
        commit: 'b'.repeat(40),
        context: 'apps/camera',
        dockerfile: 'Dockerfile',
      },
      'haus-local/fixture-app:bbbbbbbbbbbb',
      (value) => buildProgress.push(value),
    );

    expect(platform).toEqual({ os: 'linux', architecture: 'aarch64', variant: 'v8' });
    expect(image?.architecture).toBe('arm64');
    expect(pullProgress).toEqual([{ current: 2, total: 4 }]);
    expect(buildProgress).toEqual([{ current: 4, total: 4 }]);
    expect(requests).toHaveLength(4);
    expect(requests[2]).toContain('platform=linux%2Farm64');
    expect(requests[3]).toContain('remote=https%3A%2F%2Fgithub.com%2Fhaus%2Ffixture.git');
  });

  it('handles server HTTP errors cleanly', async () => {
    server = createServer((_req, res) => {
      res.writeHead(500);
      res.end('internal server error');
    });

    await new Promise<void>((resolve) => server!.listen(socketPath, () => resolve()));

    const socket = new DockerSocket(socketPath);
    await expect(socket.request('GET', '/version')).rejects.toThrow('docker_request_failed');
  });

  it('rejects invalid JSON responses from Docker socket', async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not-a-json-payload');
    });

    await new Promise<void>((resolve) => server!.listen(socketPath, () => resolve()));

    const socket = new DockerSocket(socketPath);
    await expect(socket.request('GET', '/version')).rejects.toThrow('invalid_docker_response');
  });

  it('handles unavailable Docker socket cleanly', async () => {
    const socket = new DockerSocket(socketPath); // Server not listening
    await expect(socket.request('GET', '/version')).rejects.toThrow('docker_unavailable');
  });
});
