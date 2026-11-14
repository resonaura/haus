/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DynamicCatalogService, HaIntegrationCatalog } from '@haus/ha';
import { BrandsController } from '../../src/brands/brands.controller.js';
import { BrandsService } from '../../src/brands/brands.service.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2eoAAAAASUVORK5CYII=',
  'base64',
);

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('BrandsService & BrandsController', () => {
  it('enriches HA manifest supported_by and @haus/apps repositoryUrl metadata automatically', async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      seenUrls.push(url);
      if (url.endsWith('/tuya/icon@2x.png') || url.endsWith('/meross/icon@2x.png')) {
        return new Response(TINY_PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('missing', { status: 404 });
    });

    const service = new BrandsService({
      catalog: {
        getComponentsOverlayDir: () => undefined,
        getCatalog: () =>
          ({
            getManifest: (domain: string) =>
              domain === 'smart_plug_virtual'
                ? { domain: 'smart_plug_virtual', name: 'Smart Plug', supported_by: 'tuya' }
                : undefined,
          }) as Pick<HaIntegrationCatalog, 'getManifest'> as HaIntegrationCatalog,
      } as Pick<DynamicCatalogService, 'getComponentsOverlayDir' | 'getCatalog'> as DynamicCatalogService,
    });
    service.setFetchForTesting(fetchMock);
    service.setLocalDirsForTesting([]);

    const controller = new BrandsController(service);

    const virtualResult = await controller.getIconByQuery('integration', 'smart_plug_virtual');
    expect(virtualResult.dataUri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
    expect(seenUrls.some((u) => u.includes('/tuya/icon@2x.png'))).toBe(true);

    const appResult = await controller.getIconByParam('app', 'meross_lan');
    expect(appResult.dataUri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
    expect(seenUrls.some((u) => u.includes('/meross/icon@2x.png'))).toBe(true);
  });

  it('resolves local HA overlay icons and rejects invalid IDs with BadRequestException', async () => {
    const overlayDir = await mkdtemp(join(tmpdir(), 'haus-hub-brands-'));
    tempDirs.push(overlayDir);
    await mkdir(join(overlayDir, 'local_custom'), { recursive: true });
    await writeFile(join(overlayDir, 'local_custom', 'dark_icon.png'), TINY_PNG);

    const service = new BrandsService();
    service.setLocalDirsForTesting([overlayDir]);
    service.setFetchForTesting(vi.fn(async () => new Response('missing', { status: 404 })));

    const controller = new BrandsController(service);
    const localRes = await controller.getIconByQuery('integration', 'local_custom', '1');
    expect(localRes.dataUri).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);

    await expect(controller.getIconByQuery('integration', '../evil')).rejects.toThrow(
      'Invalid brand icon.',
    );
  });
});
