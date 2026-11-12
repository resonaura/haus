/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  AppCatalog,
  DockerAppLifecycle,
  type AppManifest,
  type DockerPort,
} from '@haus/apps';
import { Identities } from '@haus/core/types';
import {
  createStandaloneAppDriver,
  StandaloneAppManager,
  type InstalledAppEntry,
} from '../../src/home/app-driver.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';
import { AppOptions } from '../../src/home/options.js';
import { Apps } from '@haus/apps';
import { HomeController } from '../../src/home/home.controller.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import type { Request } from 'express';

class MockDockerPort implements DockerPort {
  public requests: Array<{ method: string; path: string; body?: unknown }> = [];
  public failUpdate = false;

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    this.requests.push({ method, path, body });

    if (method === 'GET' && path === '/version') {
      return { ApiVersion: '1.45', MinAPIVersion: '1.24' } as T;
    }
    if (method === 'POST' && path.includes('/containers/create')) {
      return { Id: 'c'.repeat(64) } as T;
    }
    if (method === 'POST' && (path.endsWith('/start') || path.endsWith('/stop'))) {
      if (this.failUpdate && path.includes('c'.repeat(64)) && path.endsWith('/start')) {
        throw new Error('container_failed_to_start');
      }
      return {} as T;
    }
    if (method === 'GET' && path.includes('/json')) {
      return {
        Id: 'c'.repeat(64),
        State: { Status: 'running', Running: true },
        Config: { Image: 'test-image' },
      } as T;
    }
    return {} as T;
  }
}

describe('AppCatalog and Catalog-Backed Updates (P18.9.1.3 & P18.9.2)', () => {
  let tempDir: string;
  let mockDocker: MockDockerPort;
  let lifecycle: DockerAppLifecycle;
  let catalog: AppCatalog;
  let installedApps: Map<string, InstalledAppEntry>;
  let persistence: StandaloneHomePersistence;
  let appManager: StandaloneAppManager;

  const baseManifest: AppManifest = {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    image: 'test-app:1.0.0',
    architectures: ['amd64', 'arm64'],
    network: { mode: 'bridge' },
  };

  const updatedManifest: AppManifest = {
    id: 'test-app',
    name: 'Test App',
    version: '1.1.0',
    image: 'test-app:1.1.0',
    architectures: ['amd64', 'arm64'],
    network: { mode: 'bridge' },
  };

  const privilegedUpdatedManifest: AppManifest = {
    id: 'test-app',
    name: 'Test App',
    version: '2.0.0',
    image: 'test-app:2.0.0',
    architectures: ['amd64', 'arm64'],
    network: { mode: 'host' }, // Requires 'network:host' permission
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-catalog-test-'));
    mockDocker = new MockDockerPort();
    lifecycle = new DockerAppLifecycle(mockDocker, {
      dataRoot: join(tempDir, 'data'),
      hostDataRoot: join(tempDir, 'data'),
    });

    catalog = new AppCatalog();
    catalog.register({
      category: 'utility',
      runtimeType: 'docker',
      featured: true,
      author: 'Haus Team',
      manifest: baseManifest,
      versions: [
        {
          version: '1.1.0',
          manifest: updatedManifest,
          releaseNotes: 'Fixed bug and performance improvements.',
        },
        {
          version: '2.0.0',
          manifest: privilegedUpdatedManifest,
          releaseNotes: 'Major upgrade with host networking.',
        },
      ],
    });

    catalog.register({
      category: 'bridge',
      runtimeType: 'homebridge',
      author: 'bwp91',
      manifest: {
        id: 'homebridge-govee',
        name: 'Homebridge Govee',
        version: '11.39.0',
        image: 'node:22-bookworm-slim',
        architectures: ['amd64', 'arm64'],
      },
    });

    installedApps = new Map();
    persistence = new StandaloneHomePersistence();
    const identities = new Identities(
      {
        get: (s) => `${s.instanceId}:${s.externalId}`,
        putIfAbsent: (s) => `${s.instanceId}:${s.externalId}`,
      },
      () => 'app-1',
    );
    const apps = new Apps(identities, { authorize: async () => true });
    const options = new AppOptions(tempDir);
    apps.register(createStandaloneAppDriver(installedApps, lifecycle, options, catalog));

    appManager = new StandaloneAppManager(
      installedApps,
      apps,
      persistence,
      undefined,
      lifecycle,
      tempDir,
      undefined,
      tempDir,
      options,
      catalog,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Catalog Listing and Filtering', () => {
    it('lists catalog entries with category, runtimeType, and search filters', () => {
      const all = catalog.list();
      expect(all).toHaveLength(2);

      const bridges = catalog.list({ category: 'bridge' });
      expect(bridges).toHaveLength(1);
      expect(bridges[0]?.manifest.id).toBe('homebridge-govee');

      const dockerApps = catalog.list({ runtimeType: 'docker' });
      expect(dockerApps).toHaveLength(1);
      expect(dockerApps[0]?.manifest.id).toBe('test-app');

      const searched = catalog.list({ search: 'govee' });
      expect(searched).toHaveLength(1);
      expect(searched[0]?.manifest.id).toBe('homebridge-govee');
    });

    it('creates default catalog with pre-seeded integrations and plugins', () => {
      const defaultCat = AppCatalog.createDefaultCatalog();
      const entries = defaultCat.list();
      expect(entries.length).toBeGreaterThanOrEqual(8);

      const aqara = defaultCat.get('aqara-cameras');
      expect(aqara?.manifest.version).toBe('1.2.0');
      expect(aqara?.versions?.[0]?.version).toBe('1.3.0');

      const govee = defaultCat.get('homebridge-govee');
      expect(govee?.runtimeType).toBe('homebridge');
      expect(govee?.author).toBe('bwp91');

      const meross = defaultCat.get('meross_lan');
      expect(meross?.runtimeType).toBe('hacs');
      expect(meross?.category).toBe('utility');
    });

    it('projects marketplace views with installed state and version diffs', () => {
      // Initially not installed
      const marketplace = appManager.listMarketplace();
      const testApp = marketplace.find((e) => e.id === 'test-app');
      expect(testApp?.installed).toBe(false);
      expect(testApp?.updateAvailable).toBe(false);
      expect(testApp?.latestVersion).toBe('2.0.0');

      // Install v1.0.0
      installedApps.set('test-app', {
        manifest: baseManifest,
        state: 'running',
        logs: [],
        config: {},
        containerId: 'b'.repeat(64),
      });

      const updatedMarketplace = appManager.listMarketplace();
      const installedTestApp = updatedMarketplace.find((e) => e.id === 'test-app');
      expect(installedTestApp?.installed).toBe(true);
      expect(installedTestApp?.state).toBe('running');
      expect(installedTestApp?.currentVersion).toBe('1.0.0');
      expect(installedTestApp?.latestVersion).toBe('2.0.0');
      expect(installedTestApp?.updateAvailable).toBe(true);
      expect(installedTestApp?.releaseNotes).toBeDefined();

      // Filter by installed: true
      const onlyInstalled = appManager.listMarketplace({ installed: true });
      expect(onlyInstalled).toHaveLength(1);
      expect(onlyInstalled[0]?.id).toBe('test-app');

      // Filter by installed: false
      const onlyAvailable = appManager.listMarketplace({ installed: false });
      expect(onlyAvailable).toHaveLength(1);
      expect(onlyAvailable[0]?.id).toBe('homebridge-govee');
    });
  });

  describe('Update Check and Target Manifest Resolution', () => {
    it('accurately identifies when updates are available and resolves target manifest', () => {
      const result = catalog.checkUpdate('test-app', '1.0.0');
      expect(result.updateAvailable).toBe(true);
      expect(result.latestVersion).toBe('2.0.0');
      expect(result.targetManifest?.version).toBe('2.0.0');
      expect(result.releaseNotes).toBe('Major upgrade with host networking.');

      // Already on latest
      const upToDate = catalog.checkUpdate('test-app', '2.0.0');
      expect(upToDate.updateAvailable).toBe(false);
      expect(upToDate.latestVersion).toBeUndefined();

      // Unknown app
      const unknown = catalog.checkUpdate('unknown-app', '1.0.0');
      expect(unknown.updateAvailable).toBe(false);
    });

    it('delegates update checking through StandaloneAppManager', () => {
      installedApps.set('test-app', {
        manifest: baseManifest,
        state: 'running',
        logs: [],
        config: {},
        containerId: 'b'.repeat(64),
      });

      const check = appManager.checkAppUpdate('test-app');
      expect(check.updateAvailable).toBe(true);
      expect(check.currentVersion).toBe('1.0.0');
      expect(check.latestVersion).toBe('2.0.0');
    });
  });

  describe('Transactional Catalog-Backed App Updates', () => {
    it('successfully updates an app to the target catalog version', async () => {
      // Register custom catalog entry where v1.1.0 is the latest
      const customCatalog = new AppCatalog();
      customCatalog.register({
        category: 'utility',
        runtimeType: 'docker',
        manifest: baseManifest,
        versions: [
          {
            version: '1.1.0',
            manifest: updatedManifest,
            releaseNotes: 'Performance improvements',
          },
        ],
      });

      // Re-create driver with custom catalog
      const apps = new Apps(
        new Identities(
          { get: (s) => s.externalId, putIfAbsent: (s) => s.externalId },
          () => '1',
        ),
        { authorize: async () => true },
      );
      apps.register(
        createStandaloneAppDriver(
          installedApps,
          lifecycle,
          new AppOptions(tempDir),
          customCatalog,
        ),
      );

      const managerWithDriver = new StandaloneAppManager(
        installedApps,
        apps,
        persistence,
        undefined,
        lifecycle,
        tempDir,
        undefined,
        tempDir,
        new AppOptions(tempDir),
        customCatalog,
      );

      installedApps.set('test-app', {
        manifest: baseManifest,
        state: 'running',
        logs: ['[init] App started'],
        config: {},
        containerId: 'b'.repeat(64),
      });

      const result = await managerWithDriver.updateApp('admin-user', 'test-app');
      expect(result.status).toBe('ok');
      expect(result.data).toEqual({ updated: 'test-app', version: '1.1.0' });

      // Verify installedApps entry updated
      const updatedEntry = installedApps.get('test-app');
      expect(updatedEntry?.manifest.version).toBe('1.1.0');
      expect(updatedEntry?.containerId).toBe('c'.repeat(64));
      expect(updatedEntry?.logs.some((l) => l.includes('App updated to 1.1.0'))).toBe(true);
    });

    it('refuses update when no newer catalog version exists', async () => {
      installedApps.set('test-app', {
        manifest: privilegedUpdatedManifest, // v2.0.0 (latest)
        state: 'running',
        logs: [],
        config: {},
        containerId: 'b'.repeat(64),
      });

      const result = await appManager.updateApp('admin-user', 'test-app');
      expect(result.status).toBe('error');
      expect(result.reason).toBe('no_update_available');
    });

    it('requires reauthorization when updated manifest requests new permissions', async () => {
      installedApps.set('test-app', {
        manifest: baseManifest, // v1.0.0 (bridge network)
        state: 'running',
        logs: [],
        config: {},
        containerId: 'b'.repeat(64),
        grantedPermissions: [],
      });

      // Target v2.0.0 requires 'network:host'
      const refused = await appManager.updateApp('admin-user', 'test-app');
      expect(refused.status).toBe('error');
      expect(refused.reason).toBe('reauthorization_required');
      expect(refused.data).toEqual({ missingPermissions: ['network:host'] });

      // Succeeds when permission is explicitly granted
      const granted = await appManager.updateApp('admin-user', 'test-app', ['network:host']);
      expect(granted.status).toBe('ok');
      expect(granted.data).toEqual({ updated: 'test-app', version: '2.0.0' });

      const updatedEntry = installedApps.get('test-app');
      expect(updatedEntry?.manifest.version).toBe('2.0.0');
      expect(updatedEntry?.grantedPermissions).toContain('network:host');
    });

    it('handles rollback safely if replacement container fails to start', async () => {
      mockDocker.failUpdate = true;

      installedApps.set('test-app', {
        manifest: baseManifest,
        state: 'running',
        logs: [],
        config: {},
        containerId: 'b'.repeat(64),
        grantedPermissions: ['network:host'],
      });

      const result = await appManager.updateApp('admin-user', 'test-app', ['network:host']);
      expect(result.status).toBe('error');
      expect(result.reason).toBe('container_failed_to_start');
      expect(result.data).toEqual({ rolledBack: true });

      // Original container and manifest remain intact
      const entry = installedApps.get('test-app');
      expect(entry?.manifest.version).toBe('1.0.0');
      expect(entry?.containerId).toBe('b'.repeat(64));
    });
  });

  describe('HomeController Endpoints', () => {
    let service: StandaloneHomeService;
    let controller: HomeController;

    beforeEach(() => {
      service = new StandaloneHomeService();
      controller = new HomeController(service);
    });

    it('GET /api/apps/catalog returns marketplace entries', () => {
      const res = controller.listCatalog();
      expect(res.entries.length).toBeGreaterThanOrEqual(8);
      const aqara = res.entries.find((e) => e.id === 'aqara-cameras');
      expect(aqara).toBeDefined();
      expect(aqara?.category).toBe('security');
    });

    it('GET /api/apps/catalog/:id returns details and versions', () => {
      const res = controller.getCatalogEntry('aqara-cameras');
      expect(res.entry).toBeDefined();
      expect(res.entry.manifest.id).toBe('aqara-cameras');
      expect(res.entry.versions?.[0]?.version).toBe('1.3.0');

      expect(() => controller.getCatalogEntry('non-existent')).toThrow();
    });

    it('GET /api/apps/:id/update-check checks installed app update', () => {
      const check = controller.checkAppUpdate('non-installed');
      expect(check.updateAvailable).toBe(false);
    });

    it('POST /api/apps/:id/update handles update and errors correctly', async () => {
      const req = { user: { clientId: 'admin' } } as unknown as Request;

      // Unknown app throws 404
      await expect(controller.updateApp(req, 'non-existent')).rejects.toThrow();
    });
  });
});
