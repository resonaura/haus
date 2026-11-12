/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  computeCatalogChecksum,
  diffCatalogs,
  HaIntegrationCatalog,
  type HaCatalogIndex,
  type HaCatalogManifest,
} from '../packages/ha/dist/catalog/index.js';

const DEFAULT_SOURCE_DIR = resolve('.venv/lib/python3.13/site-packages/homeassistant/components');
const DEFAULT_CATALOG_FILE = resolve('packages/ha/data/ha-catalog-2024.12.5.json.gz');
const DEFAULT_VERSION = '2024.12.5';
const DEFAULT_LICENSE = 'Apache-2.0';

export function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
  const command = args[0] || 'check';
  const options: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg && arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = 'true';
      }
    }
  }

  return { command, options };
}

export function extractManifestsFromDirectory(
  sourceDir: string,
): Record<string, HaCatalogManifest> {
  if (!existsSync(sourceDir)) {
    throw new Error(`Source components directory not found: ${sourceDir}`);
  }

  const entries = readdirSync(sourceDir, { withFileTypes: true });
  const manifests: Record<string, HaCatalogManifest> = {};

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const manifestPath = join(sourceDir, entry.name, 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const raw = readFileSync(manifestPath, 'utf-8');
          const data = JSON.parse(raw) as Record<string, unknown>;
          const domain = (data.domain as string) || entry.name;
          const manifest: HaCatalogManifest = {
            domain,
            name: (data.name as string) || domain,
            integration_type: data.integration_type as string | undefined,
            iot_class: data.iot_class as string | undefined,
            config_flow: Boolean(data.config_flow),
            documentation: data.documentation as string | undefined,
            requirements: Array.isArray(data.requirements) ? (data.requirements as string[]) : [],
            dependencies: Array.isArray(data.dependencies) ? (data.dependencies as string[]) : [],
            codeowners: Array.isArray(data.codeowners) ? (data.codeowners as string[]) : [],
            zeroconf: Array.isArray(data.zeroconf)
              ? (data.zeroconf as (string | Record<string, unknown>)[])
              : undefined,
            ssdp: Array.isArray(data.ssdp) ? (data.ssdp as Record<string, unknown>[]) : undefined,
            dhcp: Array.isArray(data.dhcp) ? (data.dhcp as Record<string, unknown>[]) : undefined,
            bluetooth: Array.isArray(data.bluetooth)
              ? (data.bluetooth as Record<string, unknown>[])
              : undefined,
            mqtt: Array.isArray(data.mqtt) ? (data.mqtt as string[]) : undefined,
            usb: Array.isArray(data.usb) ? (data.usb as Record<string, unknown>[]) : undefined,
            homekit:
              typeof data.homekit === 'object' && data.homekit !== null
                ? (data.homekit as Record<string, unknown>)
                : undefined,
            single_config_entry: Boolean(data.single_config_entry),
          };
          manifests[domain] = manifest;
        } catch (err) {
          console.error(`Warning: failed to parse ${manifestPath}: ${String(err)}`);
        }
      }
    }
  }

  return manifests;
}

export function buildCatalogIndex(
  manifests: Record<string, HaCatalogManifest>,
  version = DEFAULT_VERSION,
  license = DEFAULT_LICENSE,
): HaCatalogIndex {
  const sha256 = computeCatalogChecksum(manifests);
  return {
    version,
    releaseTag: version,
    license,
    sourceUrl: `https://github.com/home-assistant/core/releases/tag/${version}`,
    totalIntegrations: Object.keys(manifests).length,
    sha256,
    generatedAt: new Date().toISOString(),
    integrations: manifests,
  };
}

export function generateCatalog(
  sourceDir = DEFAULT_SOURCE_DIR,
  outFile = DEFAULT_CATALOG_FILE,
  version = DEFAULT_VERSION,
): HaCatalogIndex {
  console.log(`Extracting manifests from: ${sourceDir}`);
  const manifests = extractManifestsFromDirectory(sourceDir);
  const total = Object.keys(manifests).length;
  console.log(`Extracted ${total} integration manifests.`);

  const index = buildCatalogIndex(manifests, version);
  const rawJson = JSON.stringify(index);
  const compressed = gzipSync(Buffer.from(rawJson, 'utf-8'));

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, compressed);
  console.log(`Wrote compressed catalog to: ${outFile} (${compressed.length} bytes)`);
  console.log(`Version: ${index.version}, License: ${index.license}, SHA-256: ${index.sha256}`);
  return index;
}

export function checkCatalog(catalogFile = DEFAULT_CATALOG_FILE): boolean {
  console.log(`Validating catalog file: ${catalogFile}`);
  try {
    const catalog = HaIntegrationCatalog.fromFile(catalogFile, true);
    console.log(`Catalog verification: PASS`);
    console.log(`  Version: ${catalog.getVersion()}`);
    console.log(`  Release: ${catalog.getReleaseTag()}`);
    console.log(`  License: ${catalog.getLicense()}`);
    console.log(`  Integrations: ${catalog.getTotalCount()}`);
    console.log(`  SHA-256: ${catalog.getSha256()}`);
    console.log(`  Generated: ${catalog.getGeneratedAt()}`);
    return true;
  } catch (error) {
    console.error(`Catalog verification: FAIL - ${String(error)}`);
    return false;
  }
}

export function reportCoverage(catalogFile = DEFAULT_CATALOG_FILE): void {
  const catalog = HaIntegrationCatalog.fromFile(catalogFile, true);
  const summary = catalog.getCoverageSummary();

  console.log(`=== Home Assistant Runtime Coverage Report ===`);
  console.log(`Total Catalog Integrations: ${summary.totalCatalogIntegrations}`);
  console.log(`  - Native Haus Implementations: ${summary.nativeHausCount}`);
  console.log(`  - Kitsune HACS / Sidecar:       ${summary.kitsuneHacsCount}`);
  console.log(`  - Homebridge Runner:            ${summary.homebridgeCount}`);
  console.log(`  - Scrypted Camera Runner:        ${summary.scryptedCount}`);
  console.log(`  - Catalog-only (Metadata):      ${summary.catalogOnlyCount}`);
  console.log(`Active Executable Coverage:       ${summary.executableCoveragePercent}%`);
}

export function diffCatalogFiles(fromFile: string, toFile: string): void {
  console.log(`Diffing catalog "${fromFile}" -> "${toFile}"`);
  const fromCatalog = HaIntegrationCatalog.fromFile(fromFile, false);
  const toCatalog = HaIntegrationCatalog.fromFile(toFile, false);

  const diff = diffCatalogs(
    {
      version: fromCatalog.getVersion(),
      integrations: Object.fromEntries(fromCatalog.getAllManifests().map((m) => [m.domain, m])),
    },
    {
      version: toCatalog.getVersion(),
      integrations: Object.fromEntries(toCatalog.getAllManifests().map((m) => [m.domain, m])),
    },
  );

  console.log(`Diff results (${diff.fromVersion} -> ${diff.toVersion}):`);
  console.log(
    `  Added domains (${diff.addedDomains.length}): ${diff.addedDomains.join(', ') || 'none'}`,
  );
  console.log(
    `  Removed domains (${diff.removedDomains.length}): ${diff.removedDomains.join(', ') || 'none'}`,
  );
  console.log(`  Modified domains (${diff.modifiedDomains.length}):`);
  for (const mod of diff.modifiedDomains) {
    console.log(`    - ${mod.domain}: ${mod.changes.join('; ')}`);
  }
}

export function rollbackCatalog(backupFile: string, targetFile = DEFAULT_CATALOG_FILE): boolean {
  console.log(`Rolling back catalog from ${backupFile} to ${targetFile}...`);
  if (!existsSync(backupFile)) {
    console.error(`Rollback failed: backup file not found: ${backupFile}`);
    return false;
  }
  // Verify backup integrity before restoring
  try {
    HaIntegrationCatalog.fromFile(backupFile, true);
  } catch (err) {
    console.error(`Rollback failed: backup file corrupt: ${String(err)}`);
    return false;
  }

  copyFileSync(backupFile, targetFile);
  console.log(`Rollback completed successfully. Verified restored catalog.`);
  return true;
}

export function main(): void {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'generate': {
      const source = options.source || DEFAULT_SOURCE_DIR;
      const out = options.out || DEFAULT_CATALOG_FILE;
      const ver = options.version || DEFAULT_VERSION;
      generateCatalog(source, out, ver);
      break;
    }
    case 'check': {
      const file = options.file || DEFAULT_CATALOG_FILE;
      const ok = checkCatalog(file);
      if (!ok) process.exit(1);
      break;
    }
    case 'coverage': {
      const file = options.file || DEFAULT_CATALOG_FILE;
      reportCoverage(file);
      break;
    }
    case 'diff': {
      const from = options.from || DEFAULT_CATALOG_FILE;
      const to = options.to;
      if (!to) {
        console.error('Error: --to <file> is required for diff command');
        process.exit(1);
      }
      diffCatalogFiles(from, to);
      break;
    }
    case 'rollback': {
      const backup = options.backup;
      const target = options.target || DEFAULT_CATALOG_FILE;
      if (!backup) {
        console.error('Error: --backup <file> is required for rollback command');
        process.exit(1);
      }
      const ok = rollbackCatalog(backup, target);
      if (!ok) process.exit(1);
      break;
    }
    default:
      console.log(
        `Usage: node scripts/ha-catalog.ts <generate|check|coverage|diff|rollback> [options]`,
      );
      break;
  }
}

// Only invoke main when run directly
if (import.meta.url === `file://${resolve(process.argv[1] || '')}`) {
  main();
}
