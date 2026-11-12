/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DynamicCatalogService } from '../src/catalog/dynamic.js';
import type { HaCatalogManifest } from '../src/catalog/types.js';

describe('Dynamic HA Catalog & Upstream Sync', () => {
  it('cold boots from Tier 1 baseline without external network calls', () => {
    const service = new DynamicCatalogService({
      cachePath: join(tmpdir(), 'non-existent-tier1-test-cache.json.gz'),
    });
    const catalog = service.getCatalog();

    expect(catalog.getVersion()).toBe('2024.12.5');
    expect(catalog.getTotalCount()).toBe(1303);
    expect(catalog.getAllDomains()).toContain('hue');
    expect(catalog.getAllDomains()).toContain('xiaomi_ble');
    expect(catalog.getAllDomains()).toContain('matter');
  });

  it('detects upstream updates via PyPI API mock', async () => {
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('pypi.org')) {
        return new Response(JSON.stringify({ info: { version: '2026.11.1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    const service = new DynamicCatalogService({
      cachePath: join(tmpdir(), 'non-existent-pypi-test-cache.json.gz'),
      fetchFn: mockFetch,
    });
    const check = await service.checkUpstreamVersion();

    expect(check.latestVersion).toBe('2026.11.1');
    expect(check.currentVersion).toBe('2024.12.5');
    expect(check.updateAvailable).toBe(true);
    expect(check.releaseSource).toBe('pypi');
  });

  it('detects upstream updates via GitHub Releases API fallback with ETag support', async () => {
    let etagSent: string | null = null;
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('pypi.org')) {
        return new Response('Error', { status: 500 });
      }
      if (url.includes('api.github.com')) {
        etagSent = (init?.headers as Record<string, string>)?.['If-None-Match'] ?? null;
        if (etagSent === 'W/"abc123etag"') {
          return new Response(null, { status: 304 });
        }
        return new Response(JSON.stringify({ tag_name: '2026.11.1' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            etag: 'W/"abc123etag"',
          },
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    const service = new DynamicCatalogService({ fetchFn: mockFetch });
    const check1 = await service.checkUpstreamVersion();
    expect(check1.latestVersion).toBe('2026.11.1');
    expect(check1.releaseSource).toBe('github');

    // Second call should utilize ETag and return cached/304
    const check2 = await service.checkUpstreamVersion();
    expect(etagSent).toBe('W/"abc123etag"');
    expect(check2.releaseSource).toBe('cached');
  });

  it('refreshes catalog, persists Tier 2 disk cache, and cold boots from cache', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'ha-catalog-test-'));
    const cachePath = join(testDir, 'ha-catalog-latest.json.gz');

    try {
      const mockFetch = async (): Promise<Response> => {
        return new Response(JSON.stringify({ info: { version: '2026.11.1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const newManifest: HaCatalogManifest = {
        domain: 'matter_bridge_v2',
        name: 'Matter Bridge v2',
        config_flow: true,
        iot_class: 'local_push',
        requirements: ['matter-server>=7.0.0'],
        dependencies: [],
        codeowners: ['@haus'],
      };

      const service = new DynamicCatalogService({
        cachePath,
        fetchFn: mockFetch,
      });

      expect(service.getVersion()).toBe('2024.12.5');

      const updated = await service.refreshCatalog('2026.11.1', [newManifest]);
      expect(updated.getVersion()).toBe('2026.11.1');
      expect(updated.getTotalCount()).toBe(1304);
      expect(updated.getManifest('matter_bridge_v2')).toBeDefined();
      expect(existsSync(cachePath)).toBe(true);

      // Verify cold boot from cache
      const freshBootService = new DynamicCatalogService({ cachePath });
      expect(freshBootService.getVersion()).toBe('2026.11.1');
      expect(freshBootService.getTotalIntegrations()).toBe(1304);
      expect(freshBootService.getCatalog().getManifest('matter_bridge_v2')).toBeDefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
