/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { DockerAppLifecycle } from '../src/lifecycle.js';
import type { AppManifest } from '../src/manifest.js';
import type { DockerPort } from '../src/docker.js';

describe('DockerAppLifecycle — Regular-Docker Lifecycle Engine', () => {
  const containerId1 = '1'.repeat(64);
  const containerId2 = '2'.repeat(64);
  const containerId3 = '3'.repeat(64);

  const fixtureManifest: AppManifest = {
    id: 'fixture-app',
    name: 'Fixture App',
    version: '1.0.0',
    image: 'haus/fixture:1.0.0',
    architectures: ['amd64', 'arm64'],
    ports: [{ containerPort: 8080, hostPort: 8080 }],
    mounts: [{ target: 'data', containerPath: '/app/data' }],
    network: { mode: 'bridge' },
    resources: { memoryLimitMb: 256, cpuLimit: 0.5 },
    lifecycle: { restartPolicy: 'unless-stopped', stopTimeoutSeconds: 10 },
  };

  function createMockDockerPort() {
    const sequence = [containerId1, containerId2, containerId3];
    let index = 0;
    const containers = new Map<
      string,
      {
        id: string;
        name: string;
        image: string;
        state: string;
        running: boolean;
        health: string;
        labels: Record<string, string>;
      }
    >();

    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      if (method === 'POST' && path.includes('/containers/create')) {
        const id = sequence[index++] ?? '9'.repeat(64);
        const rawBody = body as { Image?: string; Labels?: Record<string, string> } | undefined;
        containers.set(id, {
          id,
          name: `haus-app-fixture-${id.slice(0, 6)}`,
          image: rawBody?.Image ?? 'haus/fixture:1.0.0',
          state: 'created',
          running: false,
          health: 'starting',
          labels: rawBody?.Labels ?? {},
        });
        return { Id: id };
      }

      if (method === 'POST' && path.endsWith('/start')) {
        const idMatch = path.match(/\/containers\/([a-f0-9]{64})\/start/);
        const c = idMatch ? containers.get(idMatch[1]) : undefined;
        if (c) {
          c.state = 'running';
          c.running = true;
          c.health = 'healthy';
        }
        return undefined;
      }

      if (method === 'POST' && path.endsWith('/stop')) {
        const idMatch = path.match(/\/containers\/([a-f0-9]{64})\/stop/);
        const c = idMatch ? containers.get(idMatch[1]) : undefined;
        if (c) {
          c.state = 'exited';
          c.running = false;
        }
        return undefined;
      }

      if (method === 'DELETE' && path.includes('/containers/')) {
        const idMatch = path.match(/\/containers\/([a-f0-9]{64})/);
        if (idMatch) containers.delete(idMatch[1]);
        return undefined;
      }

      if (method === 'GET' && path.endsWith('/json')) {
        const idMatch = path.match(/\/containers\/([a-f0-9]{64})\/json/);
        const c = idMatch ? containers.get(idMatch[1]) : undefined;
        if (!c) throw new Error('not_found');
        return {
          Id: c.id,
          Name: `/${c.name}`,
          Config: { Image: c.image, Labels: c.labels },
          State: { Status: c.state, Running: c.running, ExitCode: 0, Health: { Status: c.health } },
          RestartCount: 0,
          NetworkSettings: { Ports: { '8080/tcp': [{ HostPort: '8080' }] } },
        };
      }

      if (method === 'GET' && path.includes('/containers/json?all=1')) {
        return Array.from(containers.values()).map((c) => ({
          Id: c.id,
          Names: [`/${c.name}`],
          State: c.state,
          Labels: c.labels,
        }));
      }

      throw new Error(`Unexpected call: ${method} ${path}`);
    });

    return { port: { request } as DockerPort, containers, mockFn: request };
  }

  it('completes the full lifecycle: install -> configure -> start -> observe -> stop -> remove', async () => {
    const { port, mockFn } = createMockDockerPort();
    const lifecycle = new DockerAppLifecycle(port, { dataRoot: '/var/lib/haus/apps' });

    // 1. Install
    const installResult = await lifecycle.install(fixtureManifest, []);
    expect(installResult.containerId).toBe(containerId1);
    expect(mockFn).toHaveBeenCalledWith(
      'POST',
      '/v1.45/containers/create?name=haus-app-fixture-app',
      expect.objectContaining({
        Image: 'haus/fixture:1.0.0',
        Labels: expect.objectContaining({ 'io.haus.app': 'fixture-app' }),
        HostConfig: expect.objectContaining({
          Binds: ['/var/lib/haus/apps/fixture-app/data:/app/data:rw'],
          PortBindings: { '8080/tcp': [{ HostPort: '8080' }] },
        }),
      }),
    );

    // 2. Start
    await lifecycle.start(containerId1);
    expect(mockFn).toHaveBeenCalledWith(
      'POST',
      `/v1.45/containers/${containerId1}/start`,
      undefined,
      undefined,
    );

    // 3. Observe
    const observation = await lifecycle.observe(containerId1);
    expect(observation.state).toBe('running');
    expect(observation.health).toBe('healthy');
    expect(observation.image).toBe('haus/fixture:1.0.0');
    expect(observation.ports).toEqual([{ containerPort: 8080, hostPort: 8080, protocol: 'tcp' }]);

    // 4. Stop
    await lifecycle.stop(containerId1);
    expect(mockFn).toHaveBeenCalledWith(
      'POST',
      `/v1.45/containers/${containerId1}/stop`,
      undefined,
      undefined,
    );

    // 5. Remove
    await lifecycle.remove(containerId1);
    expect(mockFn).toHaveBeenCalledWith(
      'DELETE',
      `/v1.45/containers/${containerId1}?v=1&force=1`,
      undefined,
      undefined,
    );
  });

  it('enforces least-privilege policy and rejects ungranted permissions', async () => {
    const { port } = createMockDockerPort();
    const lifecycle = new DockerAppLifecycle(port, { dataRoot: '/var/lib/haus/apps' });

    const privilegedManifest: AppManifest = {
      ...fixtureManifest,
      network: { mode: 'host' },
    };

    // Fails when required 'network:host' is missing
    await expect(lifecycle.install(privilegedManifest, [])).rejects.toThrow('policy_violation');

    // Succeeds when 'network:host' is explicitly granted
    const allowed = await lifecycle.install(privilegedManifest, ['network:host']);
    expect(allowed.containerId).toBeDefined();
  });

  it('performs automated update and rolls back if the new version fails', async () => {
    const { port, containers } = createMockDockerPort();
    const lifecycle = new DockerAppLifecycle(port, { dataRoot: '/var/lib/haus/apps' });

    // Install and start v1
    const { containerId: v1Id } = await lifecycle.install(fixtureManifest, []);
    await lifecycle.start(v1Id);
    expect((await lifecycle.observe(v1Id)).state).toBe('running');

    // Update to v2 (successful)
    const v2Manifest: AppManifest = {
      ...fixtureManifest,
      version: '2.0.0',
      image: 'haus/fixture:2.0.0',
    };
    const updateResult = await lifecycle.update(v1Id, v2Manifest, []);
    expect(updateResult.rolledBack).toBe(false);
    expect(updateResult.containerId).toBe(containerId2);
    expect(containers.has(v1Id)).toBe(false); // Old container cleaned up

    // Update to v3 where new container fails to start
    const v3Manifest: AppManifest = {
      ...fixtureManifest,
      version: '3.0.0',
      image: 'haus/fixture:3.0.0',
    };
    // Simulate v3 failing by modifying container inspect
    const originalRequest = port.request;
    const failingPort: DockerPort = {
      request: vi.fn(async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
        if (method === 'GET' && path.includes(containerId3) && path.endsWith('/json')) {
          // New v3 container reports unhealthy
          return {
            Id: containerId3,
            State: {
              Status: 'exited',
              Running: false,
              ExitCode: 1,
              Health: { Status: 'unhealthy' },
            },
          };
        }
        return originalRequest(method as never, path, body, signal);
      }),
    };

    const failingLifecycle = new DockerAppLifecycle(failingPort, {
      dataRoot: '/var/lib/haus/apps',
    });
    const rollbackResult = await failingLifecycle.update(containerId2, v3Manifest, []);
    expect(rollbackResult.rolledBack).toBe(true);
    expect(rollbackResult.containerId).toBe(containerId2); // Preserved containerId2
  });

  it('recovers an existing container after daemon restart', async () => {
    const { port, containers } = createMockDockerPort();
    const lifecycle = new DockerAppLifecycle(port, { dataRoot: '/var/lib/haus/apps' });

    // Seed existing container that was stopped
    containers.set(containerId1, {
      id: containerId1,
      name: 'haus-app-fixture-app',
      image: 'haus/fixture:1.0.0',
      state: 'exited',
      running: false,
      health: 'none',
      labels: { 'io.haus.app': 'fixture-app' },
    });

    const recovery = await lifecycle.recover('fixture-app');
    expect(recovery.state).toBe('running');
    expect(recovery.containerId).toBe(containerId1);
  });
});
