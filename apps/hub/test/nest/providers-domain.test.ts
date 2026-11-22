/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { DefaultPreferencesService } from '../../src/preferences/preferences.service.js';
import {
  DefaultBackupsService,
  seal,
  unseal,
  fileDigest,
  restoreCatalog,
  CATALOG_SNAPSHOT,
} from '../../src/backup/backups.service.js';
import { DefaultClusterService } from '../../src/cluster/cluster.service.js';
import { deduplicateClusterNodes } from '../../src/cluster/nodes.js';
import { DefaultServersService } from '../../src/servers/servers.service.js';
import { DefaultStatusService } from '../../src/status/status.service.js';
import type { NvrTransport } from '../../src/nvr/transport/service.js';
import type { Cluster } from '../../src/cluster/cluster.js';
import type { ClusterStateStore } from '../../src/cluster/coordination/state.js';

describe('Nest Providers & Domain Services (P11.7)', () => {
  describe('DefaultPreferencesService', () => {
    it('initializes with default revision 0 and empty value', async () => {
      const service = new DefaultPreferencesService();
      const current = await service.get();
      expect(current.revision).toBe('0');
      expect(current.value).toEqual({});
    });

    it('patches allowed keys and returns updated revision', async () => {
      const service = new DefaultPreferencesService();
      const patched = await service.patch('0', {
        favorites: ['light.porch'],
        roomIcons: { porch: 'lamp' },
      });
      expect(patched.conflict).toBeUndefined();
      expect(patched.revision).not.toBe('0');
      expect(patched.value.favorites).toEqual(['light.porch']);

      const retrieved = await service.get();
      expect(retrieved.revision).toBe(patched.revision);
      expect(retrieved.value.roomIcons).toEqual({ porch: 'lamp' });
    });

    it('returns conflict if baseRevision does not match current revision', async () => {
      const service = new DefaultPreferencesService();
      await service.patch('0', { favorites: ['light.a'] });
      const conflict = await service.patch('0', { favorites: ['light.b'] });
      expect(conflict.conflict).toBe(true);
      expect(conflict.value.favorites).toEqual(['light.a']);
    });

    it('rejects forbidden or invalid patch keys', async () => {
      const service = new DefaultPreferencesService();
      await expect(service.patch('0', { forbiddenKey: 123 })).rejects.toThrow(
        'invalid_shared_config',
      );
    });
  });

  describe('DefaultBackupsService & Cryptographic Vault', () => {
    it('creates snapshot and manages recovery kit', async () => {
      const service = new DefaultBackupsService();
      expect(service.busy).toBe(false);
      expect(service.error).toBeNull();

      await service.snapshot('haus');
      const items = service.list();
      expect(items.length).toBe(1);
      expect(items[0].kind).toBe('haus');

      const kit = service.recoveryKit();
      expect(kit.version).toBe(1);
      expect(typeof kit.recoveryKey).toBe('string');
    });

    it('seals and unseals encrypted backups with authenticated integrity', async () => {
      const root = await mkdtemp(join(tmpdir(), 'haus-backup-test-'));
      const key = randomBytes(32);
      const plaintext = Buffer.from('hello-haus-nvr-encrypted-backup-payload');
      const sealedPath = join(root, 'backup.enc');
      const unsealedPath = join(root, 'backup.dec');

      try {
        const sealed = await seal(Readable.from(plaintext), sealedPath, key, { testId: '42' });
        expect(sealed.size).toBeGreaterThan(plaintext.length);
        expect(sealed.digest).toMatch(/^[a-f0-9]{64}$/);

        const digest = await fileDigest(sealedPath);
        expect(digest).toBe(sealed.digest);

        const metadata = await unseal(sealedPath, unsealedPath, key);
        expect(metadata.testId).toBe('42');

        const decrypted = await readFile(unsealedPath);
        expect(decrypted.toString()).toBe(plaintext.toString());
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('restores catalog snapshot exclusively', async () => {
      const root = await mkdtemp(join(tmpdir(), 'haus-restore-test-'));
      try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(join(root, 'restore'), { recursive: true });
        await writeFile(join(root, 'restore', CATALOG_SNAPSHOT), 'db-snapshot');

        const restored = await restoreCatalog(root);
        expect(restored).toBe(true);
        const content = await readFile(join(root, 'haus.sqlite'), 'utf8');
        expect(content).toBe('db-snapshot');

        // Second call should return false because destination already exists (EEXIST)
        const duplicate = await restoreCatalog(root);
        expect(duplicate).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('DefaultClusterService', () => {
    it('manages cluster nodes lifecycle', async () => {
      const service = new DefaultClusterService();
      const initial = service.status();
      expect(initial.role).toBe('coordinator');
      expect(initial.nodes).toEqual([]);

      const added = await service.add({
        name: 'Node 1',
        url: 'http://192.168.5.117:8790',
        roles: ['storage', 'stream'],
      });
      expect(added.id).toBeDefined();
      expect(added.online).toBe(true);

      const afterAdd = service.status();
      expect(afterAdd.nodes).toHaveLength(1);
      expect(afterAdd.nodes[0].name).toBe('Node 1');

      const updated = await service.update(added.id, { name: 'Node 1 Primary', enabled: false });
      expect(updated.name).toBe('Node 1 Primary');
      expect(updated.enabled).toBe(false);

      const removed = await service.remove(added.id);
      expect(removed.removed).toBe(true);
      expect(service.status().nodes).toHaveLength(0);
    });
  });

  describe('DefaultServersService & DefaultStatusService', () => {
    it('DefaultServersService reports schema-valid ServerHost and updates quota', async () => {
      const service = new DefaultServersService();
      const status = await service.status();
      expect(status.servers.length).toBeGreaterThan(0);
      expect(status.servers[0].roles).toContain('coordinator');
      expect(status.servers[0].local).toBe(true);
      const host = status.servers[0].host as Record<string, unknown>;
      expect(typeof host?.sampledAt).toBe('string');
      expect(host?.cpu).toMatchObject({ logicalCores: expect.any(Number) });
      expect(host?.memory).toMatchObject({ totalBytes: expect.any(Number) });
      expect(host?.swap).toMatchObject({ supported: expect.any(Boolean) });
      expect(Array.isArray(host?.disks)).toBe(true);

      service.update({ storageLimitBytes: 100 * 1024 * 1024 * 1024 });
      const updated = await service.status();
      expect(updated.servers[0].storage?.limitBytes).toBe(100 * 1024 * 1024 * 1024);
    });

    it('DefaultServersService wires live NvrTransport and RECORDING_CLUSTER telemetry and deduplicates self/duplicates', async () => {
      let currentLimit: number | null = null;
      const localHost = {
        sampledAt: new Date().toISOString(),
        scope: 'host',
        hostname: 'haus',
        platform: 'linux',
        release: '6.12.0',
        arch: 'arm64',
        uptimeSeconds: 1200,
        cpu: { model: 'Cortex-A72', logicalCores: 4, usage: 0.12, loadAverage: [0.3, 0.2, 0.1] },
        memory: { totalBytes: 4e9, installedBytes: 4e9, availableBytes: 2e9, usedBytes: 2e9 },
        swap: { supported: true, totalBytes: 1e9, usedBytes: 0 },
        disks: [],
        docker: { available: true, source: 'host-collector', containers: [] },
        pm2: { available: false, source: 'unavailable', processes: [] },
        systemServices: { available: true, source: 'host-collector', services: [] },
      };
      const peerHost = { ...localHost, hostname: 'miku', arch: 'x64' };
      const nvrTransport = {
        options: {
          instanceId: 'inst-pi',
          roles: ['storage', 'stream'],
          maxStreams: 4,
          host: { status: () => localHost },
          blobs: {
            status: async () => ({
              usedBytes: 1024,
              maxBytes: 10000,
              storageLimitBytes: currentLimit,
              limitSource: currentLimit === null ? 'default' : 'user',
              reserveBytes: 512,
              totalBytes: 20000,
              availableBytes: 9000,
              freeBytes: 15000,
              reservedBytes: 0,
              activeTransfers: 0,
              verification: { supported: true },
            }),
          },
          settings: {
            status: () => ({
              storageLimitBytes: currentLimit,
              source: currentLimit === null ? 'default' : 'user',
            }),
            update: async (input: { storageLimitBytes: number | null }) => {
              currentLimit = input.storageLimitBytes;
              return { storageLimitBytes: currentLimit, source: 'user' };
            },
          },
          streams: { size: 1 },
          detectors: { status: () => ({ supported: true, active: 1, max: 2 }) },
          playback: { status: () => ({ profile: 1, active: 0, max: 2 }) },
        },
      } as unknown as NvrTransport;
      const recordingCluster = {
        healthSampledAt: Date.now(),
        refreshHealth: async () => {},
        nodes: () => [],
        status: () => ({
          nodes: [
            {
              id: 'hub-miku-worker-01',
              name: 'Miku',
              url: 'http://192.168.5.117:8792',
              enabled: true,
              roles: ['storage', 'stream'],
              online: true,
              lastSeen: 123456,
              backupCopies: 3,
              remote: {
                instanceId: 'inst-miku',
                host: peerHost,
                storage: { usedBytes: 2048, maxBytes: 50000, storageLimitBytes: null },
                settings: { storageLimitBytes: null, source: 'default' },
                streams: { active: 2, max: 6 },
                detectors: { active: 1, max: 4 },
                playback: { profile: 1, active: 0, max: 3 },
              },
            },
          ],
        }),
      } as unknown as Cluster;
      const stateStore = {
        getStateSync: () => ({
          hubId: 'hub-standalone-01',
          homeId: 'home-1',
          role: 'coordinator',
          coordinatorEpoch: 1,
          coordinatorId: 'hub-standalone-01',
          coordinatorUrl: 'http://192.168.4.44:8790',
          fenced: false,
          updatedAt: Date.now(),
        }),
      } as unknown as ClusterStateStore;
      const clusterService = {
        status: () => ({
          id: 'hub-standalone-01',
          coordinatorId: 'hub-standalone-01',
          role: 'coordinator',
          epoch: 1,
          fenced: false,
          nodes: [
            {
              id: 'dup-self-url',
              name: 'Self Dup',
              url: 'http://192.168.4.44:8790',
              enabled: true,
              roles: ['storage'],
              online: true,
            },
            {
              id: 'hub-miku-worker-01',
              name: 'Miku',
              url: 'http://192.168.5.117:8792',
              enabled: true,
              roles: ['storage', 'stream'],
              online: true,
            },
          ],
        }),
        add: async () => {
          throw new Error('unused');
        },
        update: async () => {
          throw new Error('unused');
        },
        remove: async () => ({ removed: true, id: '' }),
      };

      const service = new DefaultServersService(
        clusterService,
        undefined,
        nvrTransport,
        recordingCluster,
        stateStore,
      );
      const status = await service.status();
      expect(status.servers).toHaveLength(2);
      expect(status.servers[0]).toMatchObject({
        id: 'hub-standalone-01',
        kind: 'hub',
        local: true,
        url: 'http://192.168.4.44:8790',
        host: localHost,
        streams: { active: 1, max: 4 },
        analysis: { active: 1, max: 2 },
      });
      expect(status.servers[1]).toMatchObject({
        id: 'hub-miku-worker-01',
        kind: 'hub',
        local: false,
        url: 'http://192.168.5.117:8792',
        host: peerHost,
        backupCopies: 3,
        streams: { active: 2, max: 6 },
        analysis: { active: 1, max: 4 },
      });

      await service.update({ storageLimitBytes: 50 * 1024 ** 3 });
      expect(currentLimit).toBe(50 * 1024 ** 3);
    });

    it('deduplicateClusterNodes removes self entries and duplicate peer URLs while preferring hub-* IDs', async () => {
      const nodesMap = new Map([
        [
          'self-duplicate',
          { id: 'self-duplicate', url: 'http://192.168.4.44:8790', online: true },
        ],
        [
          'legacy-uuid',
          { id: 'legacy-uuid', url: 'http://192.168.5.117:8792', online: true },
        ],
        [
          'hub-miku-worker-01',
          { id: 'hub-miku-worker-01', url: 'http://192.168.5.117:8792/', online: true },
        ],
      ]);
      const removed = await deduplicateClusterNodes({
        nodesMap,
        localHubId: 'hub-standalone-01',
        localUrl: 'http://192.168.4.44:8790',
      });
      expect(removed.sort()).toEqual(['legacy-uuid', 'self-duplicate']);
      expect([...nodesMap.keys()]).toEqual(['hub-miku-worker-01']);
    });

    it('DefaultStatusService reports runtime features and connection status', () => {
      const service = new DefaultStatusService();
      const status = service.status();
      expect(status.name).toBe('Haus');
      expect(status.version).toBe('0.3.76');
      expect(status.features.homekitSecureVideo).toBe(true);
      expect(status.mode).toBe('standalone');
      expect(status.connected).toBe(true);

      const applianceService = new DefaultStatusService('ha-green');
      const applianceStatus = applianceService.status();
      expect(applianceStatus.mode).toBe('ha-appliance');
      expect(applianceStatus.connected).toBe(false);
    });
  });
});
