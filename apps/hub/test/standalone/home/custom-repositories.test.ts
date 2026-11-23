/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AddonRepositoriesController } from '../../../src/home/apps/repositories.controller.js';
import { CustomAddonRepositoryService } from '../../../src/home/apps/repositories.js';
import { StandaloneHomeService } from '../../../src/home/home.service.js';

function fakeReq(role: 'admin' | 'member'): object {
  return { user: { clientId: `client-${role}`, clientRole: role } };
}

function createAddonRepoFetchMock(versionRef: { current: string }): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/example/ha-addons') {
      return new Response(JSON.stringify({ default_branch: 'main', archived: false }), {
        status: 200,
      });
    }
    if (url === 'https://api.github.com/repos/example/ha-addons/git/trees/main?recursive=1') {
      return new Response(
        JSON.stringify({
          sha: 'c'.repeat(40),
          tree: [
            { path: 'repository.yaml', type: 'blob' },
            { path: 'demo/config.yaml', type: 'blob' },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith('/repository.yaml')) {
      return new Response('name: "Example Add-ons"\nmaintainer: "Example Team"\n', { status: 200 });
    }
    if (url.endsWith('/demo/config.yaml')) {
      return new Response(
        [
          'name: "Demo Add-on"',
          'slug: demo',
          `version: "${versionRef.current}"`,
          'description: "Demo custom add-on"',
          'image: "ghcr.io/example/demo-{arch}"',
          'arch:',
          '  - amd64',
          '  - aarch64',
        ].join('\n'),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('Hub CustomAddonRepositoryService & AddonRepositoriesController', () => {
  it('adds, reloads, protects installed add-ons, and removes custom Supervisor repositories', async () => {
    const home = new StandaloneHomeService();
    const running = new Set<string>();
    home.appManager.registerRuntimeBridge('docker', {
      supports: () => true,
      install: async ({ manifest }) => {
        running.add(manifest.id);
        return { logs: [] };
      },
      execute: async () => undefined,
      configure: async () => undefined,
      isRunning: (appId) => running.has(appId),
      getLogs: () => [],
    });

    const service = new CustomAddonRepositoryService(home);
    const versionRef = { current: '1.0.0' };
    service.setFetchForTesting(createAddonRepoFetchMock(versionRef));
    const controller = new AddonRepositoriesController(service);

    const adminReq = fakeReq('admin');
    const memberReq = fakeReq('member');

    // Non-admin cannot add repositories
    await expect(
      controller.add(memberReq, { url: 'https://github.com/example/ha-addons' }),
    ).rejects.toThrow(ForbiddenException);

    // Admin adds custom add-on repository
    const added = await controller.add(adminReq, { url: 'https://github.com/example/ha-addons' });
    expect(added.repository.name).toBe('Example Add-ons');
    expect(added.repository.addonIds).toHaveLength(1);
    const addonId = added.repository.addonIds[0]!;
    expect(home.appManager.catalog.get(addonId)?.manifest.version).toBe('1.0.0');

    // Duplicate repository returns 409 Conflict
    await expect(
      controller.add(adminReq, { url: 'https://github.com/example/ha-addons' }),
    ).rejects.toThrow(ConflictException);

    // Reload picks up upstream version bump
    versionRef.current = '1.1.0';
    const reloaded = await controller.reloadOne(adminReq, added.repository.id);
    expect(reloaded.repository?.id).toBe(added.repository.id);
    expect(home.appManager.catalog.get(addonId)?.manifest.version).toBe('1.1.0');

    // Install add-on -> refuse removing repository while in use (HA Supervisor parity)
    const entry = home.appManager.catalog.get(addonId)!;
    await home.installApp('client-admin', entry.manifest, []);
    await expect(controller.removePost(adminReq, added.repository.id)).rejects.toThrow(
      ConflictException,
    );

    // Uninstall -> removal succeeds and cleans catalog
    const uninstall = await home.operateApp('client-admin', addonId, 'remove');
    expect(uninstall.status).toBe('ok');
    const removed = await controller.removePost(adminReq, added.repository.id);
    expect(removed).toEqual({ removed: true, id: added.repository.id });
    expect(home.appManager.catalog.get(addonId)).toBeUndefined();
    expect((await controller.list(memberReq)).repositories).toHaveLength(0);
  });
});
