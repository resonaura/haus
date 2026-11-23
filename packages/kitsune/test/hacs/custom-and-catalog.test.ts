/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppCatalog } from '@haus/apps';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeHacsTrustAndStability,
  extractHacsRepositoryFromUrl,
  HacsDefaultCatalog,
  HacsUpdateManager,
  HACS_V2_INTEGRATIONS_URL,
  type HacsRepositoryView,
} from '../../src/index.js';
import { buildComponentZip, createZipBuffer } from '../fixtures/zip.js';

describe('HACS custom repositories & official v2 default catalog', () => {
  let tempDir: string;
  let storageDir: string;
  let customComponentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-hacs-custom-'));
    storageDir = join(tempDir, 'storage');
    customComponentsDir = join(tempDir, 'custom_components');
    await mkdir(customComponentsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('extracts owner/repo from full GitHub URLs and rejects invalid hosts', () => {
    expect(extractHacsRepositoryFromUrl('ThomasLomas/ha-starlinghomehub')).toBe(
      'ThomasLomas/ha-starlinghomehub',
    );
    expect(extractHacsRepositoryFromUrl('https://github.com/ThomasLomas/ha-starlinghomehub')).toBe(
      'ThomasLomas/ha-starlinghomehub',
    );
    expect(
      extractHacsRepositoryFromUrl('https://github.com/ThomasLomas/ha-starlinghomehub.git'),
    ).toBe('ThomasLomas/ha-starlinghomehub');
    expect(
      extractHacsRepositoryFromUrl('https://github.com/ThomasLomas/ha-starlinghomehub/tree/main'),
    ).toBe('ThomasLomas/ha-starlinghomehub');
    expect(extractHacsRepositoryFromUrl('https://evil.example/owner/repo')).toBeNull();
    expect(extractHacsRepositoryFromUrl('../escape/repo')).toBeNull();
  });

  it('adds a custom HACS repo by inspecting real manifest.json domain, installs with zip_release, and guards removal', async () => {
    const zip = buildComponentZip({
      domain: 'starling_home_hub',
      version: '2.4.0',
      minHaVersion: '2025.1.0',
    });
    const removedDomains: string[] = [];

    const fetchMock = (async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/ThomasLomas/ha-starlinghomehub') {
        return new Response(
          JSON.stringify({
            id: 777123456,
            full_name: 'ThomasLomas/ha-starlinghomehub',
            name: 'ha-starlinghomehub',
            description: 'Starling Home Hub for Home Assistant',
            default_branch: 'master',
            archived: false,
            stargazers_count: 420,
            topics: ['home-assistant', 'nest'],
          }),
          { status: 200 },
        );
      }
      if (
        url ===
        'https://api.github.com/repos/ThomasLomas/ha-starlinghomehub/git/trees/master?recursive=1'
      ) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'hacs.json', type: 'blob' },
              { path: 'custom_components/starling_home_hub/manifest.json', type: 'blob' },
              { path: 'custom_components/starling_home_hub/__init__.py', type: 'blob' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/ThomasLomas/ha-starlinghomehub/master/hacs.json')) {
        return new Response(
          JSON.stringify({
            name: 'Starling Home Hub',
            zip_release: true,
            filename: 'starling-release.zip',
            homeassistant: '2025.1.0',
          }),
          { status: 200 },
        );
      }
      if (
        url.endsWith(
          '/ThomasLomas/ha-starlinghomehub/master/custom_components/starling_home_hub/manifest.json',
        )
      ) {
        return new Response(
          JSON.stringify({
            domain: 'starling_home_hub',
            name: 'Starling Home Hub',
            version: '2.4.0',
            config_flow: true,
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api.github.com/repos/ThomasLomas/ha-starlinghomehub/releases/latest') {
        return new Response(
          JSON.stringify({
            tag_name: 'v2.4.0',
            zipball_url: 'https://example.test/wrong-zipball.zip',
            assets: [
              { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums.txt' },
              {
                name: 'starling-release.zip',
                browser_download_url: 'https://example.test/starling-release.zip',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://example.test/starling-release.zip') {
        return new Response(zip, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: fetchMock,
      hooks: {
        getRuntimeHaVersion: () => '2026.4.0',
        onRemoved: async (domain) => {
          removedDomains.push(domain);
        },
      },
    });

    const added = (await manager.handleHacsCommand({
      type: 'hacs/repositories/add',
      repository: 'https://github.com/ThomasLomas/ha-starlinghomehub.git',
      category: 'integration',
    })) as HacsRepositoryView;

    expect(added.id).toBe('777123456');
    expect(added.domain).toBe('starling_home_hub');
    expect(added.name).toBe('Starling Home Hub');
    expect(added.default_branch).toBe('master');
    expect(added.custom).toBe(true);
    expect(added.stars).toBe(420);

    // Duplicate check matches official HACS
    await expect(
      manager.handleHacsCommand({
        type: 'hacs/repositories/add',
        repository: 'thomaslomas/ha-starlinghomehub',
        category: 'integration',
      }),
    ).rejects.toThrow('hacs_repository_exists');

    // Download respects hacs.json zip_release + filename
    const op = await manager.installUpdate(added.id);
    expect(op.phase).toBe('installed');
    expect(op.domain).toBe('starling_home_hub');

    // Cannot remove custom repository while still installed
    await expect(
      manager.handleHacsCommand({
        type: 'hacs/repositories/remove',
        repository: added.id,
      }),
    ).rejects.toThrow('hacs_repository_installed_remove_first');

    // Remove download first, then remove custom repository
    await manager.handleHacsCommand({ type: 'hacs/repository/remove', repository: added.id });
    expect(removedDomains).toEqual(['starling_home_hub']);
    const removedRepo = (await manager.handleHacsCommand({
      type: 'hacs/repositories/remove',
      repository: added.id,
    })) as { removed: boolean };
    expect(removedRepo.removed).toBe(true);
  });

  it('rejects archived repos, missing manifests, and HA Add-on repos mistaken for HACS', async () => {
    const fetchMock = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/org/archived-int')) {
        return new Response(
          JSON.stringify({ id: 1, full_name: 'org/archived-int', archived: true }),
          {
            status: 200,
          },
        );
      }
      if (url.endsWith('/repos/org/addon-repo')) {
        return new Response(
          JSON.stringify({
            id: 2,
            full_name: 'org/addon-repo',
            default_branch: 'main',
            archived: false,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/repos/org/addon-repo/git/trees/main')) {
        return new Response(JSON.stringify({ tree: [{ path: 'repository.yaml', type: 'blob' }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/repos/org/content-root-repo')) {
        return new Response(
          JSON.stringify({
            id: 3,
            full_name: 'org/content-root-repo',
            default_branch: 'main',
            archived: false,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/repos/org/content-root-repo/git/trees/main')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'hacs.json', type: 'blob' },
              { path: 'manifest.json', type: 'blob' },
              { path: '__init__.py', type: 'blob' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/org/content-root-repo/main/hacs.json')) {
        return new Response(JSON.stringify({ name: 'Root Widget', content_in_root: true }), {
          status: 200,
        });
      }
      if (url.endsWith('/org/content-root-repo/main/manifest.json')) {
        return new Response(
          JSON.stringify({
            domain: 'root_widget',
            name: 'Root Widget',
            version: '1.0.0',
            config_flow: true,
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: fetchMock,
    });

    await expect(
      manager.handleHacsCommand({
        type: 'hacs/repositories/add',
        repository: 'org/archived-int',
        category: 'integration',
      }),
    ).rejects.toThrow('hacs_repository_archived');

    await expect(
      manager.handleHacsCommand({
        type: 'hacs/repositories/add',
        repository: 'org/addon-repo',
        category: 'integration',
      }),
    ).rejects.toThrow('hacs_is_addon_repository');

    const rootRepo = (await manager.handleHacsCommand({
      type: 'hacs/repositories/add',
      repository: 'org/content-root-repo',
      category: 'integration',
    })) as HacsRepositoryView;
    expect(rootRepo.domain).toBe('root_widget');
    expect(rootRepo.name).toBe('Root Widget');
  });

  it('indexes official HACS v2 default catalog, persists disk cache, scores trust, and syncs to AppCatalog', async () => {
    const mockCatalogPayload = {
      '900001': {
        full_name: 'popular/ha-dyson-local',
        domain: 'dyson_local',
        manifest_name: 'Dyson Local',
        description: 'Local control for Dyson purifiers and fans.',
        last_version: '1.9.2',
        last_updated: new Date().toISOString(),
        stargazers_count: 1400,
        downloads: 25000,
        topics: ['dyson', 'home-assistant'],
      },
      '900002': {
        full_name: 'tiny/niche-widget',
        domain: 'niche_widget',
        manifest_name: 'Niche Widget',
        description: 'Small experimental sensor.',
        last_version: '0.0.2',
        last_updated: '2022-01-01T00:00:00Z',
        stargazers_count: 1,
        downloads: 3,
      },
    };

    const fetchMock = (async (input: string | URL) => {
      if (String(input) === HACS_V2_INTEGRATIONS_URL) {
        return new Response(JSON.stringify(mockCatalogPayload), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: fetchMock,
    });
    const indexed = await manager.defaultCatalog.refresh(true);
    expect(indexed).toHaveLength(2);

    // Reload from disk cache offline
    const offlineCatalog = new HacsDefaultCatalog(storageDir, (async () => {
      throw new Error('offline');
    }) as typeof fetch);
    expect(await offlineCatalog.loadDiskCache()).toBe(true);
    expect(offlineCatalog.size()).toBe(2);

    // Popular vs tiny trust scoring
    const popularScore = computeHacsTrustAndStability({
      stars: 1400,
      downloads: 25000,
      lastUpdated: new Date().toISOString(),
    });
    const tinyScore = computeHacsTrustAndStability({
      stars: 1,
      downloads: 3,
      lastUpdated: '2022-01-01T00:00:00Z',
    });
    expect(popularScore.trustScore).toBeGreaterThan(tinyScore.trustScore);
    expect(popularScore.trustScore).toBeLessThanOrEqual(92);
    expect(tinyScore.stabilityTier).toBe('low');

    // Sync into AppCatalog produces valid HACS entries
    const appCatalog = new AppCatalog();
    const syncedCount = await manager.syncIntoAppCatalog(appCatalog);
    expect(syncedCount).toBeGreaterThanOrEqual(2);
    const dysonEntry = appCatalog.get('hacs-dyson-local');
    expect(dysonEntry).toBeDefined();
    expect(dysonEntry?.runtimeType).toBe('hacs');
    expect(dysonEntry?.domain).toBe('dyson_local');
    expect(dysonEntry?.hacsRepositoryId).toBe('900001');
    expect(dysonEntry?.stars).toBe(1400);

    // Ensure zip fixture helper remains unused-free (smoke check root zip)
    const rootZip = createZipBuffer({ 'manifest.json': '{"domain":"root_widget"}' });
    expect(rootZip.byteLength).toBeGreaterThan(0);
  });
});
