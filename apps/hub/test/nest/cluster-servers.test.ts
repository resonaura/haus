/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { PreferencesModule } from '../../src/preferences/preferences.module.js';
import { ServersModule } from '../../src/servers/servers.module.js';
import { ClusterModule } from '../../src/cluster/cluster.module.js';
import { BackupsModule } from '../../src/backup/backups.module.js';
import { StatusModule } from '../../src/status/status.module.js';
import { createNestApp } from '../../src/nest.js';

describe('NestJS Cluster, Servers, Backups, and Preferences Modules (P11.4)', () => {
  describe('Full App OpenAPI & Postman Schema Integration', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      app = await createNestApp();
      await app.listen(0);
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 8793;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('publishes Preferences, Servers, Cluster, Backups and Status in dynamic Postman collection', async () => {
      const res = await fetch(`${baseUrl}/api/docs/postman.json`);
      expect(res.status).toBe(200);
      const collection = await res.json();

      const prefFolder = collection.item.find((f: { name: string }) => f.name === 'Preferences');
      expect(prefFolder).toBeDefined();

      const serversFolder = collection.item.find((f: { name: string }) => f.name === 'Servers');
      expect(serversFolder).toBeDefined();

      const clusterFolder = collection.item.find((f: { name: string }) => f.name === 'Cluster');
      expect(clusterFolder).toBeDefined();

      const backupsFolder = collection.item.find((f: { name: string }) => f.name === 'Backups');
      expect(backupsFolder).toBeDefined();

      const systemFolder = collection.item.find((f: { name: string }) => f.name === 'System');
      expect(systemFolder).toBeDefined();
      const systemItems = systemFolder.item.map((i: { name: string }) => i.name.toLowerCase());
      expect(systemItems.some((n: string) => n.includes('status'))).toBe(true);
    });
  });

  describe('Domain Controllers Functional Validation with Mocked Services', () => {
    let app: INestApplication;
    let baseUrl: string;

    const mockPreferencesService = {
      get: () => ({
        revision: 'rev-1',
        value: { favorites: ['light::bedroom:ceiling'] },
        updatedAt: 1000,
      }),
      patch: (baseRevision: string, patch: Record<string, unknown>) => {
        if (baseRevision !== 'rev-1') {
          return { conflict: true, revision: 'rev-1', value: {}, updatedAt: 1000 };
        }
        return {
          revision: 'rev-2',
          value: { favorites: ['light::bedroom:ceiling'], ...patch },
          updatedAt: 2000,
        };
      },
    };

    const mockServersService = {
      status: async () => ({
        features: { monitoringOnlyServers: true },
        servers: [
          {
            id: 'home-assistant',
            kind: 'home-assistant',
            name: 'Home Assistant',
            online: true,
            lastSeen: 1000,
            enabled: true,
            roles: ['storage', 'stream'],
          },
        ],
        sampledAt: 1000,
      }),
      update: async (patch: { storageLimitBytes: number | null }) => {
        if (patch.storageLimitBytes !== null && patch.storageLimitBytes < 1024) {
          throw new Error('invalid_storage_limit');
        }
      },
    };

    const mockClusterService = {
      status: () => ({
        id: 'hub-main',
        role: 'coordinator',
        nodes: [
          {
            id: 'node-1',
            name: 'Secondary Node',
            url: 'http://192.168.5.117:8790',
            enabled: true,
            roles: ['stream'],
            online: true,
          },
        ],
      }),
      add: async (node: { url: string; name?: string }) => ({
        id: 'node-2',
        name: node.name ?? 'New Node',
        url: node.url,
        enabled: true,
        roles: ['storage'],
        online: true,
      }),
      update: async (id: string, patch: { name?: string; enabled?: boolean }) => ({
        id,
        name: patch.name ?? 'Updated Node',
        url: 'http://192.168.5.117:8790',
        enabled: patch.enabled ?? true,
        roles: ['storage'],
        online: true,
      }),
      remove: (id: string) => ({ removed: true, id }),
    };

    let backupBusy = false;
    const mockBackupsService = {
      list: () => [
        {
          filename: 'backup-1.tar.gz',
          kind: 'haus',
          size: 2048,
          createdAt: 1000,
        },
      ],
      get busy() {
        return backupBusy;
      },
      error: null,
      canSnapshot: (_kind: string) => !backupBusy,
      snapshot: async () => {},
      recoveryKit: () => ({
        recoveryKey: 'rec-key-12345',
        nodes: [{ id: 'node-1' }],
      }),
    };

    const mockStatusService = {
      status: async () => ({
        protocol: 1,
        name: 'Haus',
        version: '0.3.76',
        features: {
          homekitSecureVideo: true,
          cluster: true,
          sharedPreferences: true,
          previewPreheat: true,
          verifiedOriginalPlayback: true,
        },
        connected: true,
        recordingEnabled: true,
        storage: { bytes: 5000 },
      }),
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          PreferencesModule.forRoot(mockPreferencesService),
          ServersModule.forRoot(mockServersService),
          ClusterModule.forRoot(mockClusterService),
          BackupsModule.forRoot(mockBackupsService),
          StatusModule.forRoot(mockStatusService),
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
        }),
      );
      await app.listen(0);
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 8794;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    // Preferences tests
    it('retrieves household preferences at /api/preferences', async () => {
      const res = await fetch(`${baseUrl}/api/preferences`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revision).toBe('rev-1');
      expect(body.value.favorites).toBeDefined();
    });

    it('patches household preferences with valid baseRevision', async () => {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 'rev-1',
          patch: { autoGroupLights: true },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revision).toBe('rev-2');
      expect(body.value.autoGroupLights).toBe(true);
    });

    it('returns 409 conflict when patching with outdated revision', async () => {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseRevision: 'outdated-rev',
          patch: { autoGroupLights: true },
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.conflict).toBe(true);
    });

    // Servers tests
    it('retrieves server cluster status at /api/servers', async () => {
      const res = await fetch(`${baseUrl}/api/servers`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.features.monitoringOnlyServers).toBe(true);
      expect(body.servers.length).toBe(1);
      expect(body.servers[0].id).toBe('home-assistant');
    });

    it('updates storage policy on /api/servers/home-assistant', async () => {
      const res = await fetch(`${baseUrl}/api/servers/home-assistant`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storageLimitBytes: 107374182400 }),
      });
      expect(res.status).toBe(200);
    });

    // Cluster tests
    it('retrieves cluster topology at /api/cluster', async () => {
      const res = await fetch(`${baseUrl}/api/cluster`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe('coordinator');
      expect(body.nodes.length).toBe(1);
    });

    it('adds a new cluster node via POST /api/cluster/nodes', async () => {
      const res = await fetch(`${baseUrl}/api/cluster/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.5.118:8790', name: 'Third Node' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('node-2');
      expect(body.name).toBe('Third Node');
    });

    it('removes cluster node via POST /api/cluster/nodes/:id/remove', async () => {
      const res = await fetch(`${baseUrl}/api/cluster/nodes/node-1/remove`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.removed).toBe(true);
      expect(body.id).toBe('node-1');
    });

    // Backups tests
    it('lists backup archives at /api/backups', async () => {
      const res = await fetch(`${baseUrl}/api/backups`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.busy).toBe(false);
      expect(body.items.length).toBe(1);
      expect(body.items[0].filename).toBe('backup-1.tar.gz');
    });

    it('initiates backup snapshot via POST /api/backups/create', async () => {
      const res = await fetch(`${baseUrl}/api/backups/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'haus' }),
      });
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.started).toBe(true);
    });

    it('returns 400 on invalid backup kind', async () => {
      const res = await fetch(`${baseUrl}/api/backups/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'invalid-kind' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 409 when backup is busy', async () => {
      backupBusy = true;
      try {
        const res = await fetch(`${baseUrl}/api/backups/create`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'haus' }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('backup_busy');
      } finally {
        backupBusy = false;
      }
    });

    it('retrieves recovery kit at /api/backups/recovery', async () => {
      const res = await fetch(`${baseUrl}/api/backups/recovery`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.recoveryKey).toBe('rec-key-12345');
      expect(body.nodes.length).toBe(1);
    });

    // Status tests
    it('retrieves hub runtime status at /api/status', async () => {
      const res = await fetch(`${baseUrl}/api/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.protocol).toBe(1);
      expect(body.name).toBe('Haus');
      expect(body.version).toBe('0.3.76');
      expect(body.connected).toBe(true);
      expect(body.features.cluster).toBe(true);
    });
  });
});
