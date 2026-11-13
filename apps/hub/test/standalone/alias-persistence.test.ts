/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppCatalog } from '@haus/apps';
import type { HausDevice } from '@haus/core';
import { afterEach, describe, expect, it } from 'vitest';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { reconcileHomebridgeGoveeDevice } from '../../src/mqtt/govee-hybrid.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';

function makeHomebridgeOutlet(id: string, name: string, serialNumber: string): HausDevice {
  return {
    id,
    source: { instanceId: 'homebridge:homebridge-govee', externalId: id },
    name,
    category: 'power',
    roomId: 'narnia',
    areaId: 'narnia',
    manufacturer: 'Govee',
    model: 'H5083',
    serialNumber,
    connectivity: { protocol: 'local_ip' },
    availability: 'online',
    endpoints: [
      {
        id: `${id}:outlet`,
        name,
        category: 'power',
        roomId: 'narnia',
        availability: 'online',
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['turn_on', 'turn_off'] },
        ],
        readings: { on_off: { value: false, freshness: 'live' } },
      },
    ],
  };
}

describe('Standalone device alias SQLite persistence', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  async function openHome(dbPath: string): Promise<{
    home: StandaloneHomeService;
    close: () => Promise<void>;
  }> {
    const source = await openCatalog(dbPath);
    const transactions = new Transactions(source);
    const home = new StandaloneHomeService(undefined, transactions);
    const close = async (): Promise<void> => {
      await home.getPersistence().flush();
      await home.onModuleDestroy();
      await transactions.drain();
      if (source.isInitialized) await source.destroy();
    };
    cleanups.push(close);
    return { home, close };
  }

  it('persists registered aliases across StandaloneHomeService SQLite restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'haus-alias-persist-'));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'haus.sqlite');

    const first = await openHome(dbPath);
    await first.home.onModuleInit();

    const hbOutlet = makeHomebridgeOutlet(
      'homebridge:homebridge-govee:UUID-1',
      'Narnia Garland',
      'BC:66:60:74:F4:C7:B4:42',
    );
    first.home.registerDevice(hbOutlet);
    await first.home.registerAlias('mqtt_gv2mqtt-BC666074F4C7B442', hbOutlet.id);
    expect(first.home.getDevice('mqtt_gv2mqtt-BC666074F4C7B442')?.id).toBe(hbOutlet.id);
    await first.close();

    const second = await openHome(dbPath);
    await second.home.onModuleInit();

    expect(second.home.getDevice('mqtt_gv2mqtt-BC666074F4C7B442')?.id).toBe(hbOutlet.id);
    const snapshot = await second.home.getPersistence().load();
    expect(snapshot.aliases).toContainEqual(['mqtt_gv2mqtt-BC666074F4C7B442', hbOutlet.id]);
  });

  it('deterministically backfills and persists mqtt_gv2mqtt MAC aliases during reconciliation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'haus-alias-backfill-'));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'haus.sqlite');

    const hbCatalogEntry = AppCatalog.createDefaultCatalog().get('homebridge-govee');
    expect(hbCatalogEntry).toBeDefined();

    const first = await openHome(dbPath);
    if (hbCatalogEntry) {
      await first.home.getPersistence().save('app', 'homebridge-govee', {
        manifest: hbCatalogEntry.manifest,
        state: 'running',
        logs: [],
        config: { hybridSplit: true, outletsOnly: true },
      });
    }
    await first.home.onModuleInit();

    const hbOutlet = makeHomebridgeOutlet(
      'homebridge:homebridge-govee:UUID-2',
      'Narnia Lamp Plug',
      'F5:F0:60:74:F4:AB:AB:82',
    );
    const reconciled = reconcileHomebridgeGoveeDevice(first.home, hbOutlet);
    await Promise.all(reconciled.aliasPromises);
    first.home.registerDevice(reconciled.device);

    expect(first.home.getDevice('mqtt_gv2mqtt-F5F06074F4ABAB82')?.id).toBe(hbOutlet.id);

    const secondPass = reconcileHomebridgeGoveeDevice(first.home, reconciled.device);
    expect(secondPass.aliasPromises).toHaveLength(0);
    await first.close();

    const second = await openHome(dbPath);
    await second.home.onModuleInit();

    expect(second.home.getDevice('mqtt_gv2mqtt-F5F06074F4ABAB82')?.id).toBe(hbOutlet.id);
  });
});
