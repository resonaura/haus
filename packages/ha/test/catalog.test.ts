/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  diffCatalogs,
  HaIntegrationCatalog,
  type HaCatalogIndex,
  type HaCatalogManifest,
} from '../src/catalog/index.js';

const CATALOG_PATH = existsSync(resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz'))
  ? resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz')
  : resolve('data/ha-catalog-2024.12.5.json.gz');

describe('Built-in Integration Catalog & Tooling (P18.7)', () => {
  it('loads pinned 2024.12.5 catalog with verified SHA-256 and Apache-2.0 license', () => {
    expect(existsSync(CATALOG_PATH)).toBe(true);

    const catalog = HaIntegrationCatalog.fromFile(CATALOG_PATH, true);
    expect(catalog.getVersion()).toBe('2024.12.5');
    expect(catalog.getReleaseTag()).toBe('2024.12.5');
    expect(catalog.getLicense()).toBe('Apache-2.0');
    expect(catalog.getTotalCount()).toBe(1303);
    expect(catalog.getSha256()).toBe(
      '88291207c3fe58fbc63aa829a0e37cd09d1546f3df9083ed199b0eaa15cf8343',
    );
    expect(catalog.getAllDomains().length).toBe(1303);
  });

  it('queries manifests by domain, search term, and discovery matchers', () => {
    const catalog = HaIntegrationCatalog.fromFile(CATALOG_PATH, false);

    // Specific domain lookup
    const hue = catalog.getManifest('hue');
    expect(hue).toBeDefined();
    expect(hue?.name).toBe('Philips Hue');
    expect(hue?.config_flow).toBe(true);
    expect(hue?.iot_class).toBe('local_push');
    expect(hue?.zeroconf).toEqual(['_hue._tcp.local.']);
    expect(hue?.requirements).toContain('aiohue==4.7.3');

    // Zeroconf matcher query
    const zeroconfIntegrations = catalog.query({ hasDiscoveryMatcher: 'zeroconf' });
    expect(zeroconfIntegrations.length).toBe(79);
    expect(zeroconfIntegrations.some((m) => m.domain === 'hue')).toBe(true);
    expect(zeroconfIntegrations.some((m) => m.domain === 'esphome')).toBe(true);
    expect(zeroconfIntegrations.some((m) => m.domain === 'wled')).toBe(true);

    // SSDP matcher query
    const ssdpIntegrations = catalog.query({ hasDiscoveryMatcher: 'ssdp' });
    expect(ssdpIntegrations.length).toBe(38);
    expect(ssdpIntegrations.some((m) => m.domain === 'axis')).toBe(true);

    // Bluetooth matcher query
    const btIntegrations = catalog.query({ hasDiscoveryMatcher: 'bluetooth' });
    expect(btIntegrations.length).toBe(42);

    // Config flow filter
    const flowIntegrations = catalog.query({ configFlow: true });
    expect(flowIntegrations.length).toBe(699);

    // Search query
    const cameraMatches = catalog.query({ search: 'camera' });
    expect(cameraMatches.length).toBeGreaterThan(5);
    expect(cameraMatches.some((m) => m.domain === 'generic')).toBe(true);
  });

  it('reports actual runtime coverage truthfully without claiming universal execution', () => {
    const catalog = HaIntegrationCatalog.fromFile(CATALOG_PATH, false);
    const summary = catalog.getCoverageSummary();

    expect(summary.totalCatalogIntegrations).toBe(1303);
    expect(summary.nativeHausCount).toBe(9);
    expect(summary.kitsuneHacsCount).toBe(7);
    expect(summary.homebridgeCount).toBe(1);
    expect(summary.scryptedCount).toBe(5);
    expect(summary.catalogOnlyCount).toBe(1281);
    expect(summary.executableCoveragePercent).toBe(1.69);

    // Verified executable profiles
    const mqttCoverage = catalog.getRuntimeCoverage('mqtt')!;
    expect(mqttCoverage.category).toBe('native_haus');
    expect(mqttCoverage.runtimeStatus).toBe('executable');
    expect(mqttCoverage.adapter).toBe('@haus/mqtt');
    expect(mqttCoverage.missingCapabilities).toHaveLength(0);

    const hueCoverage = catalog.getRuntimeCoverage('hue')!;
    expect(hueCoverage.category).toBe('kitsune_hacs');
    expect(hueCoverage.runtimeStatus).toBe('executable');
    expect(hueCoverage.adapter).toBe('@haus/kitsune:hacs');

    // Catalog-only profiles report exact missing capabilities
    const sonosCoverage = catalog.getRuntimeCoverage('sonos')!;
    expect(sonosCoverage.category).toBe('catalog_only');
    expect(sonosCoverage.runtimeStatus).toBe('unsupported');
    expect(sonosCoverage.adapter).toBe('none');
    expect(sonosCoverage.missingCapabilities).toContain('config_flow_execution');
    expect(sonosCoverage.missingCapabilities.some((c) => c.startsWith('py_dependency:'))).toBe(
      true,
    );
  });

  it('diffs catalog versions accurately for added, removed, and modified domains', () => {
    const v1Integrations: Record<string, HaCatalogManifest> = {
      hue: {
        domain: 'hue',
        name: 'Philips Hue',
        config_flow: true,
        requirements: ['aiohue==4.7.1'],
        dependencies: [],
        codeowners: ['@balloob'],
      },
      legacy_camera: {
        domain: 'legacy_camera',
        name: 'Legacy Camera',
        config_flow: false,
        requirements: [],
        dependencies: [],
        codeowners: [],
      },
    };

    const v2Integrations: Record<string, HaCatalogManifest> = {
      hue: {
        domain: 'hue',
        name: 'Philips Hue Enhanced',
        config_flow: true,
        requirements: ['aiohue==4.7.3'],
        dependencies: ['http'],
        codeowners: ['@balloob', '@marcelveldt'],
      },
      matter: {
        domain: 'matter',
        name: 'Matter',
        config_flow: true,
        requirements: ['python-matter-server==6.5.0'],
        dependencies: [],
        codeowners: [],
      },
    };

    const diff = diffCatalogs(
      { version: '2024.11.0', integrations: v1Integrations },
      { version: '2024.12.5', integrations: v2Integrations },
    );

    expect(diff.fromVersion).toBe('2024.11.0');
    expect(diff.toVersion).toBe('2024.12.5');
    expect(diff.addedDomains).toEqual(['matter']);
    expect(diff.removedDomains).toEqual(['legacy_camera']);
    expect(diff.modifiedDomains).toHaveLength(1);
    expect(diff.modifiedDomains[0]?.domain).toBe('hue');
    expect(diff.modifiedDomains[0]?.changes).toContain(
      'name: "Philips Hue" -> "Philips Hue Enhanced"',
    );
    expect(diff.modifiedDomains[0]?.changes.some((c) => c.includes('aiohue==4.7.3'))).toBe(true);
  });

  it('rejects tampered or corrupt catalog files during integrity verification', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'haus-catalog-test-'));
    try {
      const tamperedFile = join(tmpDir, 'tampered.json.gz');

      // Create a catalog with a spoofed sha256
      const fakeCatalog: HaCatalogIndex = {
        version: '2024.12.5',
        releaseTag: '2024.12.5',
        license: 'Apache-2.0',
        sourceUrl: 'https://github.com/home-assistant/core',
        totalIntegrations: 1,
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
        generatedAt: new Date().toISOString(),
        integrations: {
          test: {
            domain: 'test',
            name: 'Test',
            config_flow: false,
            requirements: [],
            dependencies: [],
            codeowners: [],
          },
        },
      };

      writeFileSync(tamperedFile, gzipSync(Buffer.from(JSON.stringify(fakeCatalog))));

      expect(() => HaIntegrationCatalog.fromFile(tamperedFile, true)).toThrowError(
        /catalog_integrity_check_failed/,
      );

      // Invalid schema check
      const invalidFile = join(tmpDir, 'invalid.json.gz');
      writeFileSync(invalidFile, gzipSync(Buffer.from(JSON.stringify({ bad: 'data' }))));
      expect(() => HaIntegrationCatalog.fromFile(invalidFile, true)).toThrowError(
        /invalid_catalog_schema/,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('supports safe rollback from backup without mutating credentials or active configs', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'haus-catalog-rollback-'));
    try {
      const liveCatalogFile = join(tmpDir, 'live-catalog.json.gz');
      const backupCatalogFile = join(tmpDir, 'backup-catalog.json.gz');

      // Copy real catalog to backup and live
      copyFileSync(CATALOG_PATH, backupCatalogFile);
      copyFileSync(CATALOG_PATH, liveCatalogFile);

      // Verify backup loads
      const backupCatalog = HaIntegrationCatalog.fromFile(backupCatalogFile, true);
      expect(backupCatalog.getTotalCount()).toBe(1303);

      // Simulate rollback: target overwritten with verified backup
      copyFileSync(backupCatalogFile, liveCatalogFile);
      const restored = HaIntegrationCatalog.fromFile(liveCatalogFile, true);
      expect(restored.getTotalCount()).toBe(1303);
      expect(restored.getSha256()).toBe(backupCatalog.getSha256());
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts discovery matcher rules for all supported discovery sources', () => {
    const catalog = HaIntegrationCatalog.fromFile(CATALOG_PATH);
    const rules = catalog.getDiscoveryMatcherRules();
    expect(rules.length).toBeGreaterThan(150);

    const axis = rules.find((r) => r.domain === 'axis');
    expect(axis).toBeDefined();
    expect(axis?.zeroconf).toBeDefined();
    expect(axis?.ssdp).toBeDefined();

    const wled = rules.find((r) => r.domain === 'wled');
    expect(wled?.zeroconf).toBeDefined();

    const skyconnect = rules.find((r) => r.domain === 'homeassistant_sky_connect');
    expect(skyconnect?.usb).toBeDefined();

    const acaia = rules.find((r) => r.domain === 'acaia');
    expect(acaia?.bluetooth).toBeDefined();

    const hueRule = rules.find((r) => r.domain === 'hue');
    expect(hueRule?.homekit?.models).toContain('BSB002');
  });
});
