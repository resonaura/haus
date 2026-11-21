/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DockerPort } from '@haus/apps';

interface MockContainerRecord {
  id: string;
  name: string;
  image: string;
  state: string;
  labels: Record<string, string>;
}

function handleDockerRequest(
  containers: Map<string, MockContainerRecord>,
  nextIndex: () => number,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): { status: number; payload: unknown } {
  const hostArch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const dockerArch = hostArch === 'arm64' ? 'aarch64' : 'x86_64';

  if (method === 'GET' && url === '/version') {
    return { status: 200, payload: { ApiVersion: '1.45', MinAPIVersion: '1.24' } };
  }
  if (method === 'GET' && /^\/v1\.\d+\/info$/.test(url)) {
    return { status: 200, payload: { OSType: 'linux', Architecture: dockerArch } };
  }
  if (method === 'GET' && /^\/v1\.\d+\/images\/.+\/json$/.test(url)) {
    return {
      status: 200,
      payload: {
        Id: `sha256:${'1'.repeat(64)}`,
        Os: 'linux',
        Architecture: hostArch,
        RepoDigests: [],
      },
    };
  }
  if (method === 'POST' && /^\/v1\.\d+\/images\/create/.test(url)) {
    return { status: 200, payload: { status: 'Downloaded' } };
  }
  if (method === 'GET' && /^\/v1\.\d+\/containers\/json/.test(url)) {
    return {
      status: 200,
      payload: Array.from(containers.values()).map((c) => ({
        Id: c.id,
        Names: [`/${c.name}`],
        Image: c.image,
        State: c.state,
        Labels: c.labels,
      })),
    };
  }
  if (method === 'POST' && /^\/v1\.\d+\/containers\/create/.test(url)) {
    const parsed = new URL(url, 'http://localhost');
    const name = parsed.searchParams.get('name') ?? `haus-app-${nextIndex()}`;
    const id = nextIndex().toString(16).padStart(64, 'a');
    const image = typeof body?.Image === 'string' ? body.Image : 'example/app:latest';
    const labels =
      body?.Labels && typeof body.Labels === 'object'
        ? (body.Labels as Record<string, string>)
        : {};
    containers.set(id, { id, name, image, state: 'created', labels });
    return { status: 201, payload: { Id: id } };
  }
  const actionMatch = url.match(/^\/v1\.\d+\/containers\/([a-f0-9]{64})\/(start|stop|restart)$/);
  if (method === 'POST' && actionMatch) {
    const [, id, action] = actionMatch;
    const container = id ? containers.get(id) : undefined;
    if (!container) return { status: 404, payload: { message: 'not_found' } };
    container.state = action === 'stop' ? 'exited' : 'running';
    return { status: 204, payload: {} };
  }
  const inspectMatch = url.match(/^\/v1\.\d+\/containers\/([a-f0-9]{64})\/json$/);
  if (method === 'GET' && inspectMatch) {
    const id = inspectMatch[1];
    const container = id ? containers.get(id) : undefined;
    if (!container) return { status: 404, payload: { message: 'not_found' } };
    return {
      status: 200,
      payload: {
        Id: container.id,
        Name: `/${container.name}`,
        State: { Status: container.state, Running: container.state === 'running' },
        Config: { Image: container.image },
      },
    };
  }
  const deleteMatch = url.match(/^\/v1\.\d+\/containers\/([a-f0-9]{64})/);
  if (method === 'DELETE' && deleteMatch) {
    const id = deleteMatch[1];
    if (id) containers.delete(id);
    return { status: 204, payload: {} };
  }
  return { status: 200, payload: {} };
}

export function createMockDockerPort(): DockerPort {
  const containers = new Map<string, MockContainerRecord>();
  let seq = 1;
  return {
    async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
      const payloadBody =
        body && typeof body === 'object' && !(body instanceof AbortSignal)
          ? (body as Record<string, unknown>)
          : undefined;
      const result = handleDockerRequest(containers, () => seq++, method, path, payloadBody);
      return result.payload as T;
    },
  };
}

export interface MockDockerSocketHandle {
  readonly socketPath: string;
  close(): Promise<void>;
}

export async function startMockDockerSocket(): Promise<MockDockerSocketHandle> {
  const dir = await mkdtemp(join(tmpdir(), 'haus-d-'));
  const socketPath = join(dir, 'd.sock');
  const containers = new Map<string, MockContainerRecord>();
  let seq = 1;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Record<string, unknown> | undefined;
      if (chunks.length > 0) {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
        } catch {
          // ignore non-JSON body
        }
      }
      const { status, payload } = handleDockerRequest(
        containers,
        () => seq++,
        req.method ?? 'GET',
        req.url ?? '/',
        body,
      );
      if (status === 204) {
        res.writeHead(204);
        res.end();
        return;
      }
      const json = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(json);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    socketPath,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function attachMockDockerEnv(): Promise<{
  readonly dataDir: string;
  close(): Promise<void>;
}> {
  const prevSocket = process.env.HAUS_DOCKER_SOCKET;
  const prevData = process.env.HAUS_DATA_DIR;
  const mockDocker = await startMockDockerSocket();
  const dataDir = await mkdtemp(join(tmpdir(), 'haus-standalone-nest-'));
  process.env.HAUS_DOCKER_SOCKET = mockDocker.socketPath;
  process.env.HAUS_DATA_DIR = dataDir;
  return {
    dataDir,
    async close() {
      await mockDocker.close();
      await rm(dataDir, { recursive: true, force: true });
      if (prevSocket === undefined) delete process.env.HAUS_DOCKER_SOCKET;
      else process.env.HAUS_DOCKER_SOCKET = prevSocket;
      if (prevData === undefined) delete process.env.HAUS_DATA_DIR;
      else process.env.HAUS_DATA_DIR = prevData;
    },
  };
}
