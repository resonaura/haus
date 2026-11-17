/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_CATALOG_SEED_DIR,
  DynamicCatalogService,
  extractCatalogFromHaDirectory,
  LATEST_CATALOG_FILENAME,
  LATEST_TRANSLATIONS_FILENAME,
  writeAtomicGzipJson,
} from '@haus/ha';
import {
  resolveCatalogCachePath,
  resolveCatalogSeedPaths,
} from '../commissioning/lan/reconcile.js';

interface ParsedCatalogCliArgs {
  readonly command: string;
  readonly flags: ReadonlyMap<string, string>;
}

function parseCatalogCliArgs(argv: readonly string[]): ParsedCatalogCliArgs {
  const command = argv[0] ?? 'status';
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, 'true');
    }
  }
  return { command, flags };
}

function resolveDetectedHaDirectory(): string | undefined {
  for (const base of [
    process.env.HAUS_HA_SITE_PACKAGES,
    '/opt/ha-venv/lib',
    resolve('.venv/lib'),
  ]) {
    if (!base) continue;
    if (existsSync(join(base, 'components'))) return base;
    for (const py of ['python3.14', 'python3.13', 'python3.12']) {
      const candidate = join(base, py, 'site-packages', 'homeassistant');
      if (existsSync(join(candidate, 'components'))) return candidate;
    }
  }
  return undefined;
}

export async function runCatalogCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { command, flags } = parseCatalogCliArgs(argv);
  const dataDirFlag = flags.get('data-dir');
  if (dataDirFlag) {
    process.env.HAUS_DATA_DIR = resolve(dataDirFlag);
  }
  const cachePath = flags.get('cache')
    ? resolve(flags.get('cache') as string)
    : resolveCatalogCachePath();
  const seeds = resolveCatalogSeedPaths();

  switch (command) {
    case 'seed': {
      const source = flags.get('source') ?? resolveDetectedHaDirectory();
      if (!source) {
        console.error('Error: --source <homeassistant-dir> is required (none auto-detected)');
        return 1;
      }
      const outDir = resolve(flags.get('out-dir') ?? DEFAULT_CATALOG_SEED_DIR);
      const extracted = extractCatalogFromHaDirectory(source, {
        version: flags.get('version'),
        license: 'Apache-2.0',
      });
      writeAtomicGzipJson(join(outDir, LATEST_CATALOG_FILENAME), extracted.catalogIndex);
      writeAtomicGzipJson(join(outDir, LATEST_TRANSLATIONS_FILENAME), extracted.translationsIndex);
      console.log(
        `Seeded HA catalog ${extracted.version} (${extracted.catalogIndex.totalIntegrations} integrations) -> ${outDir}`,
      );
      return 0;
    }

    case 'sync': {
      const bestEffort = flags.get('best-effort') === 'true';
      const force = flags.get('force') === 'true';
      const requestedVersion = flags.get('version');
      const service = new DynamicCatalogService({
        cachePath,
        seedPath: seeds.catalogPath,
        seedTranslationsPath: seeds.translationsPath,
      });

      if (requestedVersion) {
        try {
          const updated = await service.refreshCatalog(requestedVersion);
          console.log(
            `Synced HA catalog ${updated.getVersion()} (${updated.getTotalCount()} integrations)`,
          );
          return 0;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`HA catalog sync failed: ${msg}`);
          return bestEffort ? 0 : 1;
        }
      }

      const result = await service.ensureLatest({ force });
      console.log(
        `HA catalog ${result.status}: version=${result.version} integrations=${result.total} source=${result.source}${result.error ? ` (${result.error})` : ''}`,
      );
      if (result.status === 'offline' && !bestEffort) {
        return 1;
      }
      return 0;
    }

    case 'status': {
      const service = new DynamicCatalogService({
        cachePath,
        seedPath: seeds.catalogPath,
        seedTranslationsPath: seeds.translationsPath,
      });
      console.log(
        JSON.stringify(
          {
            version: service.getVersion(),
            integrations: service.getTotalIntegrations(),
            cachePath: service.getCachePath(),
            cacheComplete: service.isCacheComplete(),
            seedPath: seeds.catalogPath ?? null,
            overlayDir: service.getComponentsOverlayDir() ?? null,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    default:
      console.log(
        'Usage: haus-catalog <sync|seed|status> [--force] [--best-effort] [--data-dir <dir>]',
      );
      return command === 'help' ? 0 : 1;
  }
}

if (import.meta.url === `file://${resolve(process.argv[1] ?? '')}`) {
  const code = await runCatalogCli();
  if (code !== 0) process.exit(code);
}
