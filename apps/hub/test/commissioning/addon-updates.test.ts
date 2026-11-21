/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AppCatalog,
  Apps,
  resolveImageArchTemplate,
  validateAppManifest,
  type AppManifest,
  type DockerAppLifecycle,
} from '@haus/apps';
import { Identities } from '@haus/core/types';
import {
  collectInstalledAppUpdates,
  parseAddonConfigYaml,
  syncUpstreamAddonCatalogVersion,
} from '../../src/commissioning/updates/addon-upstream.js';
import { createStandaloneAppDriver } from '../../src/home/standalone-driver.js';
import type { InstalledAppEntry } from '../../src/home/app-driver.js';
import type { StandaloneHomeService } from '../../src/home/home.service.js';

describe('Add-on catalog, {arch} templates, and upstream update sync', () => {
  it('expands Home Assistant {arch} placeholders across supported architectures', () => {
    expect(resolveImageArchTemplate('ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}:1.6.41', 'arm64')).toBe(
      'ghcr.io/resonaura/aqara-g5pro-mqtt/aarch64:1.6.41',
    );
    expect(resolveImageArchTemplate('ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}:1.6.41', 'x64')).toBe(
      'ghcr.io/resonaura/aqara-g5pro-mqtt/amd64:1.6.41',
    );
    expect(resolveImageArchTemplate('ghcr.io/resonaura/haus-kettle-{arch}:0.1.5', 'armv7')).toBe(
      'ghcr.io/resonaura/haus-kettle-armv7:0.1.5',
    );
  });

  it('registers aqara-g5pro, nixie-clock, and haus-kettle with valid manifests and build-tag semver compare', () => {
    const catalog = AppCatalog.createDefaultCatalog();
    for (const id of ['aqara-g5pro', 'nixie-clock', 'haus-kettle']) {
      const entry = catalog.get(id);
      expect(entry).toBeDefined();
      expect(entry?.addonConfigPath).toBeTruthy();
      expect(validateAppManifest(entry?.manifest).valid).toBe(true);
    }

    const aqara = catalog.get('aqara-g5pro');
    expect(aqara?.manifest.services).toContain('mqtt:want');
    expect(aqara?.manifest.accessories).toEqual({ protocol: 'haus-camera-v2', port: 8580 });

    const pending = catalog.checkUpdate('aqara-g5pro', '1.6.39+haus.20261111.2');
    expect(pending.updateAvailable).toBe(true);
    expect(pending.latestVersion).toBe('1.6.41');

    const sameBaseWithBuild = catalog.checkUpdate('aqara-g5pro', '1.6.41+haus.20261121.1');
    expect(sameBaseWithBuild.updateAvailable).toBe(false);
  });

  it('parses HA add-on config.yaml safely', () => {
    const parsed = parseAddonConfigYaml(`
name: "Aqara G5 Pro MQTT"
version: "1.6.42"
slug: "aqara_g5pro_mqtt"
image: "ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}" # comment
options:
  version: "ignored-indented"
`);
    expect(parsed).toEqual({
      version: '1.6.42',
      image: 'ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}',
    });
  });

  it('discovers newer upstream config.yaml releases and registers them onto AppCatalog', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const entry = catalog.get('aqara-g5pro')!;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === 'https://raw.githubusercontent.com/resonaura/aqara-g5pro-mqtt/main/app/config.yaml') {
        return new Response(
          'version: "1.6.42"\nimage: "ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}"\n',
          { status: 200 },
        );
      }
      if (url.includes('/v2/resonaura/aqara-g5pro-mqtt/aarch64/manifests/1.6.42')) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const synced = await syncUpstreamAddonCatalogVersion(entry, catalog, fetchMock, {
      architecture: 'arm64',
    });
    expect(synced).toEqual({
      version: '1.6.42',
      image: 'ghcr.io/resonaura/aqara-g5pro-mqtt/aarch64:1.6.42',
    });

    const update = catalog.checkUpdate('aqara-g5pro', '1.6.39+haus.20261111.2');
    expect(update.updateAvailable).toBe(true);
    expect(update.latestVersion).toBe('1.6.42');
    expect(update.targetManifest?.image).toBe('ghcr.io/resonaura/aqara-g5pro-mqtt/aarch64:1.6.42');
    expect(update.targetManifest?.accessories).toEqual({ protocol: 'haus-camera-v2', port: 8580 });
  });

  it('rejects untrusted repository hijack and skips unpublished tags returning 404', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const entry = catalog.get('aqara-g5pro')!;

    const hijackFetch = vi.fn<typeof fetch>(async () => {
      return new Response('version: "9.9.9"\nimage: "ghcr.io/attacker/malware/{arch}"\n', {
        status: 200,
      });
    });
    const hijacked = await syncUpstreamAddonCatalogVersion(entry, catalog, hijackFetch, {
      architecture: 'arm64',
    });
    expect(hijacked).toBeUndefined();
    expect(catalog.checkUpdate('aqara-g5pro', '1.6.41').updateAvailable).toBe(false);

    const unpublishedFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('raw.githubusercontent.com')) {
        return new Response(
          'version: "1.6.43"\nimage: "ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}"\n',
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    const unpublished = await syncUpstreamAddonCatalogVersion(entry, catalog, unpublishedFetch, {
      architecture: 'arm64',
    });
    expect(unpublished).toBeUndefined();
    expect(catalog.checkUpdate('aqara-g5pro', '1.6.41').updateAvailable).toBe(false);
  });

  it('passes supervisor runtimeEnvironment and preserves existing host_network permission on update', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const installedManifest: AppManifest = {
      id: 'aqara-g5pro',
      name: 'Aqara G5 Pro MQTT Bridge',
      version: '1.6.39+haus.20261111.2',
      image: 'haus-aqara:pi-20261117',
      architectures: ['amd64', 'arm64'],
      network: { mode: 'host' },
      mounts: [{ target: 'data', containerPath: '/data' }],
      services: ['mqtt:want'],
      accessories: { protocol: 'haus-camera-v2', port: 8580 },
    };

    const installedApps = new Map<string, InstalledAppEntry>([
      [
        'aqara-g5pro',
        {
          manifest: installedManifest,
          state: 'running',
          logs: [],
          config: { log_level: 'info' },
          containerId: 'a'.repeat(64),
          // Simulates a migrated add-on entry with no persisted grantedPermissions
        },
      ],
    ]);

    const lifecycleUpdate = vi.fn().mockResolvedValue({
      containerId: 'b'.repeat(64),
      rolledBack: false,
      manifest: catalog.get('aqara-g5pro')!.manifest,
      image: {
        reference: 'sha256:' + '1'.repeat(64),
        imageId: 'sha256:' + '1'.repeat(64),
        digest: 'sha256:' + '2'.repeat(64),
        source: 'registry',
        platform: 'linux/arm64',
      },
    });
    const lifecycle = {
      update: lifecycleUpdate,
    } as unknown as DockerAppLifecycle;

    const supervisorRegister = vi.fn().mockResolvedValue({
      SUPERVISOR_API: 'http://127.0.0.1:8790/api/supervisor',
      SUPERVISOR_TOKEN: 'deterministic-hmac-token',
    });

    const apps = new Apps(
      new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
      { authorize: async () => true },
    );
    apps.register(
      createStandaloneAppDriver(installedApps, lifecycle, undefined, catalog, undefined, {
        register: supervisorRegister,
      }),
    );

    const inv = await apps.list('admin');
    const app = inv.apps[0]!;
    const res = await apps.operate('admin', app.id, 'update');

    expect(res.status).toBe('ok');
    expect(res.data).toMatchObject({ updated: 'aqara-g5pro', version: '1.6.41' });
    expect(supervisorRegister).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'aqara-g5pro', version: '1.6.41' }),
      { log_level: 'info' },
    );
    expect(lifecycleUpdate).toHaveBeenCalledWith(
      'a'.repeat(64),
      expect.objectContaining({ id: 'aqara-g5pro', version: '1.6.41' }),
      ['network:host'],
      {
        SUPERVISOR_API: 'http://127.0.0.1:8790/api/supervisor',
        SUPERVISOR_TOKEN: 'deterministic-hmac-token',
      },
      undefined,
      undefined,
    );
    expect(installedApps.get('aqara-g5pro')?.manifest.version).toBe('1.6.41');
    expect(installedApps.get('aqara-g5pro')?.containerId).toBe('b'.repeat(64));
  });

  it('collectInstalledAppUpdates reports aqara-g5pro update from upstream config.yaml', async () => {
    const catalog = AppCatalog.createDefaultCatalog();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('raw.githubusercontent.com/resonaura/aqara-g5pro-mqtt')) {
        return new Response(
          'version: "1.6.44"\nimage: "ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}"\n',
          { status: 200 },
        );
      }
      if (url.includes('/v2/resonaura/aqara-g5pro-mqtt/')) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const fakeHome = {
      listApps: async () => ({
        apps: [
          {
            id: 'app-aqara',
            name: 'Aqara G5 Pro MQTT Bridge',
            version: '1.6.39+haus.20261111.2',
            image: 'haus-aqara:pi-20261117',
            state: 'running',
            managed: true,
            available: true,
            actions: ['stop', 'restart'],
            source: { instanceId: 'standalone-local', externalId: 'aqara-g5pro' },
          },
        ],
        drivers: [],
      }),
      getAppCatalogEntry: (id: string) => catalog.get(id),
      checkAppUpdate: (id: string) => catalog.checkUpdate(id, '1.6.39+haus.20261111.2'),
      appManager: { catalog },
    } as unknown as StandaloneHomeService;

    const items = await collectInstalledAppUpdates({
      homeService: fakeHome,
      fetchImpl: fetchMock,
      installing: new Set(),
      checkedAt: '2026-11-21T00:00:00.000Z',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'app:aqara-g5pro',
      domain: 'aqara-g5pro',
      category: 'addon',
      installedVersion: '1.6.39+haus.20261111.2',
      latestVersion: '1.6.44',
      updateAvailable: true,
      canInstall: true,
    });
  });
});
