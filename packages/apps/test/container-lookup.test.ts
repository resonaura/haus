/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DockerAppLifecycle,
  DockerSocket,
  type AppManifest,
  type DockerPort,
} from '../src/index.js';

describe('DockerAppLifecycle container lookup, host mount detection, and update continuity', () => {
  const oldId = '1'.repeat(64);
  const newId = '2'.repeat(64);
  const hubId = '9'.repeat(64);

  const aqaraManifest: AppManifest = {
    id: 'aqara-g5pro',
    name: 'Aqara G5 Pro MQTT Bridge',
    version: '1.6.41',
    image: 'ghcr.io/resonaura/aqara-g5pro-mqtt/aarch64:1.6.41',
    architectures: ['amd64', 'arm64'],
    network: { mode: 'host' },
    mounts: [{ target: 'data', containerPath: '/data' }],
    services: ['mqtt:want'],
  };

  it('findContainer observes a stopped container without starting it and extracts build-tag version', async () => {
    const request = vi.fn(async (method: string, path: string) => {
      if (method === 'GET' && path === '/v1.45/containers/json?all=1') {
        return [
          {
            Id: oldId,
            Names: ['/haus-app-aqara-g5pro'],
            State: 'exited',
            Labels: { 'io.haus.app': 'aqara-g5pro' },
          },
        ];
      }
      if (method === 'GET' && path === `/v1.45/containers/${oldId}/json`) {
        return {
          Id: oldId,
          Name: '/haus-app-aqara-g5pro',
          Image: `sha256:${'d'.repeat(64)}`,
          Config: {
            Image: 'haus-aqara:pi-20261117',
            Labels: {
              'io.haus.app': 'aqara-g5pro',
              'io.haus.version': '1.6.39',
              'org.opencontainers.image.version': '1.6.39+haus.20261111.2',
            },
          },
          State: { Status: 'exited', Running: false, ExitCode: 0 },
          Mounts: [
            {
              Type: 'bind',
              Source: '/var/lib/haus/hub/apps/aqara-g5pro/data',
              Destination: '/data',
              RW: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected call: ${method} ${path}`);
    });

    const lifecycle = new DockerAppLifecycle({ request } as DockerPort, { dataRoot: '/data/apps' });
    const found = await lifecycle.findContainer('aqara-g5pro');

    expect(found.state).toBe('stopped');
    expect(found.containerId).toBe(oldId);
    expect(found.observation?.version).toBe('1.6.39+haus.20261111.2');
    expect(found.observation?.image).toBe('haus-aqara:pi-20261117');
    expect(found.observation?.imageId).toBe(`sha256:${'d'.repeat(64)}`);
    expect(found.observation?.mounts).toEqual([
      {
        type: 'bind',
        source: '/var/lib/haus/hub/apps/aqara-g5pro/data',
        destination: '/data',
        rw: true,
      },
    ]);
    expect(request).not.toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('/start'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('detectHostDataDir resolves the host path backing /data from the running hub container', async () => {
    const request = vi.fn(async (method: string, path: string) => {
      if (method === 'GET' && path === '/v1.45/containers/json?all=1') {
        return [
          {
            Id: oldId,
            Names: ['/haus-app-aqara-g5pro'],
            State: 'running',
            Mounts: [
              {
                Type: 'bind',
                Source: '/var/lib/haus/hub/apps/aqara-g5pro/data',
                Destination: '/data',
              },
            ],
          },
          {
            Id: hubId,
            Names: ['/haus-hub'],
            State: 'running',
            Mounts: [
              { Type: 'bind', Source: '/var/lib/haus/hub', Destination: '/data' },
              { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' },
            ],
          },
        ];
      }
      throw new Error(`Unexpected call: ${method} ${path}`);
    });

    const lifecycle = new DockerAppLifecycle({ request } as DockerPort, { dataRoot: '/data/apps' });
    expect(await lifecycle.detectHostDataDir('/data')).toBe('/var/lib/haus/hub');
    expect(await lifecycle.detectHostDataDir('/nonexistent')).toBeUndefined();
  });

  it('update preserves predecessor host bind mount fallback and renames new container to canonical name', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path === `/v1.45/containers/${oldId}/json`) {
        return {
          Id: oldId,
          Name: '/haus-app-aqara-g5pro',
          Config: { Image: 'haus-aqara:pi-20261117' },
          State: { Status: 'running', Running: true },
          Mounts: [
            {
              Type: 'bind',
              Source: '/var/lib/haus/hub/apps/aqara-g5pro/data',
              Destination: '/data',
              RW: true,
            },
          ],
        };
      }
      if (method === 'POST' && path.includes('/containers/create')) {
        return { Id: newId };
      }
      if (method === 'GET' && path === `/v1.45/containers/${newId}/json`) {
        return {
          Id: newId,
          Name: '/haus-update-tmp',
          Config: { Image: aqaraManifest.image },
          State: { Status: 'running', Running: true },
        };
      }
      return undefined;
    });

    const lifecycle = new DockerAppLifecycle({ request } as DockerPort, {
      dataRoot: '/data/apps',
      hostDataRoot: '/data/apps',
    });
    const res = await lifecycle.update(oldId, aqaraManifest, ['network:host']);

    expect(res.rolledBack).toBe(false);
    expect(res.containerId).toBe(newId);
    const createCall = calls.find((c) => c.path.includes('/containers/create'));
    const hostConfig = (createCall?.body as { HostConfig?: { Binds?: string[] } })?.HostConfig;
    expect(hostConfig?.Binds).toEqual(['/var/lib/haus/hub/apps/aqara-g5pro/data:/data:rw']);
    expect(
      calls.some((c) => c.path === `/v1.45/containers/${newId}/rename?name=haus-app-aqara-g5pro`),
    ).toBe(true);
  });

  it('DockerSocket allows only canonical haus-app-* rename targets', async () => {
    const socket = new DockerSocket('/tmp/nonexistent-haus-test.sock');
    await expect(
      socket.request('POST', `/v1.45/containers/${newId}/rename?name=unrelated-name`),
    ).rejects.toThrow('docker_operation_not_allowed');
    await expect(
      socket.request('POST', `/v1.45/containers/${newId}/rename?name=haus-app-../evil`),
    ).rejects.toThrow('docker_operation_not_allowed');
    // Valid canonical path passes allowlist validation and only fails trying to connect to socket
    await expect(
      socket.request('POST', `/v1.45/containers/${newId}/rename?name=haus-app-aqara-g5pro`),
    ).rejects.toThrow('docker_unavailable');
  });
});
