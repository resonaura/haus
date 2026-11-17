/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LATEST_CATALOG_FILENAME, LATEST_TRANSLATIONS_FILENAME } from '@haus/ha';
import { runCatalogCli } from '../../src/cli/catalog.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { HubUpdatesService } from '../../src/commissioning/updates.js';
import { HomeKitControllerService } from '../../src/homekit/service.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';

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

describe('Hub HA Catalog Seed, Startup Sync & Updates Cache Invalidation', () => {
  const disposers: Array<() => Promise<void> | void> = [];
  const origFetch = globalThis.fetch;
  let tempDir: string | undefined;
  let prevDataDir: string | undefined;
  let prevSeedDir: string | undefined;

  afterEach(async () => {
    globalThis.fetch = origFetch;
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      await dispose?.();
    }
    if (prevDataDir === undefined) delete process.env.HAUS_DATA_DIR;
    else process.env.HAUS_DATA_DIR = prevDataDir;
    if (prevSeedDir === undefined) delete process.env.HAUS_CATALOG_SEED_DIR;
    else process.env.HAUS_CATALOG_SEED_DIR = prevSeedDir;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('seeds catalog via CLI, boots CommissioningService from seed, and invalidates updates cache on sync', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-hub-catalog-sync-'));
    prevDataDir = process.env.HAUS_DATA_DIR;
    prevSeedDir = process.env.HAUS_CATALOG_SEED_DIR;

    const haRoot = join(tempDir, 'fake-ha');
    const componentsDir = join(haRoot, 'components');
    const generatedDir = join(haRoot, 'generated');
    const seedDir = join(tempDir, 'seed');
    const dataDir = join(tempDir, 'data');

    await mkdir(join(componentsDir, 'hue'), { recursive: true });
    await mkdir(join(componentsDir, 'sonos'), { recursive: true });
    await mkdir(generatedDir, { recursive: true });
    await writeFile(
      join(haRoot, 'const.py'),
      'MAJOR_VERSION = 2026\nMINOR_VERSION = 11\nPATCH_VERSION = "1"\n',
    );
    await writeFile(
      join(componentsDir, 'hue', 'manifest.json'),
      JSON.stringify({ domain: 'hue', name: 'Philips Hue', config_flow: true }),
    );
    await writeFile(
      join(componentsDir, 'sonos', 'manifest.json'),
      JSON.stringify({ domain: 'sonos', name: 'Sonos', config_flow: true }),
    );

    const seedCode = await runCatalogCli(['seed', '--source', haRoot, '--out-dir', seedDir]);
    expect(seedCode).toBe(0);

    process.env.HAUS_DATA_DIR = dataDir;
    process.env.HAUS_CATALOG_SEED_DIR = seedDir;

    const statusCode = await runCatalogCli(['status', '--data-dir', dataDir]);
    expect(statusCode).toBe(0);

    const ds = await openCatalog(join(dataDir, 'haus.sqlite'));
    disposers.push(() => ds.destroy());
    const tx = new Transactions(ds);
    const entries = new HubIntegrationEntryService(undefined, tx, undefined);
    await entries.onModuleInit();
    disposers.push(() => entries.onModuleDestroy());

    const homekit = new HomeKitControllerService();
    const commissioning = new CommissioningService(homekit, undefined, undefined, entries);
    disposers.push(() => commissioning.onModuleDestroy());

    expect(commissioning.catalog.getVersion()).toBe('2026.11.1');
    expect(commissioning.catalog.getTotalIntegrations()).toBe(2);

    let hookCalls = 0;
    commissioning.setHaCatalogRefreshHook(async () => {
      hookCalls += 1;
    });

    // Offline sync degrades safely without overwriting seed version
    globalThis.fetch = async () => new Response('offline', { status: 503 });
    const offlineCheck = await commissioning.syncCatalogIfNeeded();
    expect(offlineCheck.status).toBe('offline');
    expect(commissioning.catalog.getVersion()).toBe('2026.11.1');

    // Populate HubUpdatesService cache at 2026.11.1
    const updates = new HubUpdatesService(commissioning, entries, undefined);
    updates.setFetchForTesting(async (url) => {
      if (String(url).includes('pypi.org')) {
        return new Response(JSON.stringify({ info: { version: '2026.11.1' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    const firstUpdates = await updates.listUpdates();
    const firstCatalogItem = firstUpdates.items.find((i) => i.id === 'catalog:ha-integrations');
    expect(firstCatalogItem?.installedVersion).toBe('2026.11.1');
    expect(firstCatalogItem?.updateAvailable).toBe(false);

    // Online wheel upgrade through CommissioningService.syncCatalogIfNeeded triggers hook & invalidates updates cache
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
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('pypi.org')) {
        return new Response(
          JSON.stringify({
            info: { version: '2026.12.0' },
            urls: [
              {
                packagetype: 'bdist_wheel',
                url: 'https://files.example.invalid/homeassistant-2026.12.0-py3-none-any.whl',
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
    };

    const synced = await commissioning.syncCatalogIfNeeded();
    expect(synced.status).toBe('updated');
    expect(synced.version).toBe('2026.12.0');
    expect(synced.total).toBe(510);
    expect(hookCalls).toBe(1);

    const secondUpdates = await updates.listUpdates();
    const secondCatalogItem = secondUpdates.items.find((i) => i.id === 'catalog:ha-integrations');
    expect(secondCatalogItem?.installedVersion).toBe('2026.12.0');
    expect(join(seedDir, LATEST_CATALOG_FILENAME)).toContain(LATEST_CATALOG_FILENAME);
    expect(join(seedDir, LATEST_TRANSLATIONS_FILENAME)).toContain(LATEST_TRANSLATIONS_FILENAME);
  });
});
