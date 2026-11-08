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
import { DefaultServersService } from '../../src/servers/servers.service.js';
import { DefaultStatusService } from '../../src/status/status.service.js';

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
    it('DefaultServersService reports server telemetry and updates quota', async () => {
      const service = new DefaultServersService();
      const status = await service.status();
      expect(status.servers.length).toBeGreaterThan(0);
      expect(status.servers[0].roles).toContain('coordinator');

      service.update({ storageLimitBytes: 100 * 1024 * 1024 * 1024 });
      const updated = await service.status();
      expect(updated.servers[0].storage?.limitBytes).toBe(100 * 1024 * 1024 * 1024);
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
