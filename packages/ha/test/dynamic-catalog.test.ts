/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareHaVersions,
  DynamicCatalogService,
  extractCatalogFromHaDirectory,
  writeAtomicGzipJson,
} from '../src/catalog/index.js';
import type { HaCatalogManifest } from '../src/catalog/types.js';

function createStoredWheel(entries: Record<string, string>): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localChunks.push(local, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cdChunks.push(cd, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

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

  it('compares Home Assistant CalVer versions including pre-releases', () => {
    expect(compareHaVersions('2026.11.1', '2024.12.5')).toBe(1);
    expect(compareHaVersions('2024.12.5', '2026.11.1')).toBe(-1);
    expect(compareHaVersions('2026.11.1', '2026.11.1')).toBe(0);
    expect(compareHaVersions('2026.11.0', '2026.11.0b2')).toBe(1);
    expect(compareHaVersions('2026.11.0b1', '2026.11.0b2')).toBe(-1);
  });

  it('extracts seed catalog & translations from HA dir and prefers seed over baseline or poisoned cache', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'ha-catalog-seed-'));
    try {
      const haRoot = join(testDir, 'homeassistant');
      const componentsDir = join(haRoot, 'components');
      const generatedDir = join(haRoot, 'generated');
      mkdirSync(join(componentsDir, 'hue'), { recursive: true });
      mkdirSync(join(componentsDir, 'matter'), { recursive: true });
      mkdirSync(generatedDir, { recursive: true });
      writeFileSync(
        join(haRoot, 'const.py'),
        'MAJOR_VERSION = 2026\nMINOR_VERSION = 11\nPATCH_VERSION = "1"\n',
      );
      writeFileSync(
        join(componentsDir, 'hue', 'manifest.json'),
        JSON.stringify({
          domain: 'hue',
          name: 'Philips Hue',
          config_flow: true,
          iot_class: 'local_push',
        }),
      );
      writeFileSync(
        join(componentsDir, 'hue', 'strings.json'),
        JSON.stringify({ config: { step: { user: { title: 'Bridge' } } } }),
      );
      writeFileSync(
        join(componentsDir, 'matter', 'manifest.json'),
        JSON.stringify({
          domain: 'matter',
          name: 'Matter',
          config_flow: true,
          supported_by: 'hue',
        }),
      );
      writeFileSync(
        join(generatedDir, 'config_flows.py'),
        'FLOWS = {"integration": ["hue", "matter"]}\n',
      );

      const extracted = extractCatalogFromHaDirectory(haRoot);
      expect(extracted.catalogIndex.version).toBe('2026.11.1');
      expect(extracted.catalogIndex.totalIntegrations).toBe(2);
      expect(extracted.translationsIndex.supportedBy['matter']).toBe('hue');
      expect(extracted.translationsIndex.flowHandlers).toEqual(['hue', 'matter']);

      const seedPath = join(testDir, 'seed', 'ha-catalog-latest.json.gz');
      const seedTranslationsPath = join(testDir, 'seed', 'ha-translations-latest.json.gz');
      writeAtomicGzipJson(seedPath, extracted.catalogIndex);
      writeAtomicGzipJson(seedTranslationsPath, extracted.translationsIndex);

      // Simulate poisoned cache holding baseline sha256 re-stamped with 2026.11.1
      const baselineService = new DynamicCatalogService({
        cachePath: join(testDir, 'unused-cache.json.gz'),
      });
      const baselineRaw = baselineService.getCatalog().getAllManifests();
      const poisonedCachePath = join(testDir, 'cache', 'ha-catalog-latest.json.gz');
      writeAtomicGzipJson(poisonedCachePath, {
        version: '2026.11.1',
        releaseTag: '2026.11.1',
        license: 'Apache-2.0',
        sourceUrl: 'https://example.invalid',
        totalIntegrations: baselineRaw.length,
        sha256: baselineService.getCatalog().getSha256(),
        generatedAt: new Date().toISOString(),
        integrations: Object.fromEntries(baselineRaw.map((m) => [m.domain, m])),
      });

      const booted = new DynamicCatalogService({
        cachePath: poisonedCachePath,
        seedPath,
        seedTranslationsPath,
      });
      expect(booted.getVersion()).toBe('2026.11.1');
      expect(booted.getTotalIntegrations()).toBe(2);
      expect(booted.getTranslations().resolveSupportedBy('matter')).toBe('hue');
      expect(booted.isCacheComplete('2026.11.1')).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('syncs full wheel via ensureLatest and refuses stale-manifest cache poisoning when offline', async () => {
    const testDir = mkdtempSync(join(tmpdir(), 'ha-catalog-ensure-'));
    const cachePath = join(testDir, 'cache', 'ha-catalog-latest.json.gz');
    try {
      const offlineService = new DynamicCatalogService({
        cachePath,
        fetchFn: async () => new Response('down', { status: 503 }),
      });
      const offlineResult = await offlineService.ensureLatest({ force: true });
      expect(offlineResult.status).toBe('offline');
      expect(existsSync(cachePath)).toBe(false);

      const wheelEntries: Record<string, string> = {};
      for (let i = 0; i < 510; i++) {
        const domain = `dom_${String(i).padStart(3, '0')}`;
        wheelEntries[`homeassistant/components/${domain}/manifest.json`] = JSON.stringify({
          domain,
          name: `Domain ${i}`,
          config_flow: true,
        });
        wheelEntries[`homeassistant/components/${domain}/strings.json`] = JSON.stringify({
          config: { step: { user: { title: `Setup ${domain}` } } },
        });
      }
      const wheelBuf = createStoredWheel(wheelEntries);

      const onlineService = new DynamicCatalogService({
        cachePath,
        fetchFn: async (input) => {
          const url = String(input);
          if (url.includes('pypi.org')) {
            return new Response(
              JSON.stringify({
                info: { version: '2026.11.1' },
                urls: [
                  {
                    packagetype: 'bdist_wheel',
                    url: 'https://files.example.invalid/homeassistant-2026.11.1-py3-none-any.whl',
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (url.endsWith('.whl')) {
            return new Response(new Uint8Array(wheelBuf), { status: 200 });
          }
          return new Response('Not Found', { status: 404 });
        },
      });

      const upgraded = await onlineService.ensureLatest();
      expect(upgraded.status).toBe('updated');
      expect(upgraded.version).toBe('2026.11.1');
      expect(upgraded.total).toBe(510);
      expect(onlineService.isCacheComplete('2026.11.1')).toBe(true);
      expect(onlineService.getComponentsOverlayDir()).toBeDefined();

      const secondCheck = await onlineService.ensureLatest();
      expect(secondCheck.status).toBe('up_to_date');
      expect(secondCheck.source).toBe('cached');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
