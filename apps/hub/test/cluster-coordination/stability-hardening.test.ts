/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HaEntryImport } from '@haus/kitsune';
import { isShutdownStorageError, runSerialized } from '../../src/cluster/sync/merge.js';
import { HaEntryImporter } from '../../src/commissioning/ha-flow/entry-importer.js';
import { EncryptedHaSecretsStore } from '../../src/commissioning/ha-flow/helpers.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { startHubMdnsAdvertisement } from '../../src/runtime/discovery.js';
import { StatsEngine } from '../../src/stats/stats.engine.js';
import { openStatsSource } from '../../src/stats/stats.source.js';
import { StatsStore } from '../../src/stats/stats.store.js';
import { createPostgresPoolExtra } from '../../src/storage/dialect.js';

describe('Hub stability hardening', () => {
  it('restricts ciao mDNS responder to non-virtual LAN IPv4 addresses (excluding wg0)', async () => {
    const getResponder = vi.fn(() => ({
      createService: vi.fn(() => ({ advertise: vi.fn(async () => undefined) })),
      shutdown: vi.fn(async () => undefined),
    }));

    const stop = await startHubMdnsAdvertisement({
      env: { HAUS_HUB_ID: 'hub-worker', HAUS_HOME_ID: 'home-1' },
      port: 8790,
      interfaces: {
        eno1: [
          {
            address: '192.168.5.117',
            netmask: '255.255.252.0',
            family: 'IPv4',
            mac: '00:11:22:33:44:55',
            internal: false,
            cidr: '192.168.5.117/22',
          },
        ],
        wg0: [
          {
            address: '10.10.10.2',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: false,
            cidr: '10.10.10.2/24',
          },
        ],
        docker0: [
          {
            address: '172.17.0.1',
            netmask: '255.255.0.0',
            family: 'IPv4',
            mac: '02:42:ac:11:00:01',
            internal: false,
            cidr: '172.17.0.1/16',
          },
        ],
      },
      getLocalAddresses: () => new Set(['192.168.5.117', '10.10.10.2', '172.17.0.1']),
      ciao: { getResponder },
    });

    expect(getResponder).toHaveBeenCalledWith({
      interface: ['192.168.5.117'],
      disableIpv6: true,
    });
    await stop?.();
  });

  it('enables PostgreSQL TCP keepAlive and idle_in_transaction_session_timeout on catalog and stats pools', () => {
    for (const role of ['catalog', 'stats'] as const) {
      const extra = createPostgresPoolExtra(role, {});
      expect(extra.keepAlive).toBe(true);
      expect(extra.keepAliveInitialDelayMillis).toBe(10_000);
      expect(extra.options).toContain('idle_in_transaction_session_timeout=30000');
    }
  });

  it('serializes concurrent sync tasks per peer key and cleans up idle lanes', async () => {
    const lanes = new Map<string, Promise<void>>();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runSerialized(lanes, 'peer-miku', async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 1;
    });
    const second = runSerialized(lanes, 'peer-miku', async () => {
      events.push('second:start');
      events.push('second:end');
      return 2;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    expect(lanes.size).toBe(0);
  });

  it('recognizes benign storage/abort shutdown errors', () => {
    expect(isShutdownStorageError(Error('storage_closed'))).toBe(true);
    expect(isShutdownStorageError(Error('stats_store_closed'))).toBe(true);
    expect(isShutdownStorageError(Error('cluster_sync_shutdown'))).toBe(true);
    const abortErr = Error('aborted');
    abortErr.name = 'AbortError';
    expect(isShutdownStorageError(abortErr)).toBe(true);
    expect(isShutdownStorageError(Error('peer_http_500'))).toBe(false);
  });

  it('restores imported HA registries once with restoreOnly and ignores volatile entry.data changes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'haus-restore-stability-'));
    try {
      const importCalls: HaEntryImport[] = [];
      const runtime = {
        importEntry: vi.fn(async (input: HaEntryImport) => {
          importCalls.push(input);
          return { entryId: input.entry.entryId, domain: input.entry.domain };
        }),
      };

      const entriesService = new HubIntegrationEntryService();
      const secrets = new EncryptedHaSecretsStore(undefined, tempDir);
      await secrets.saveEntryPayload(
        'meross-1',
        { host: '192.168.5.50', timestamp: 1000 },
        {},
        {
          entities: [{ entity_id: 'switch.meross_1', platform: 'meross_lan', unique_id: 'u1' }],
          devices: [],
          areas: [],
        },
      );

      const importer = new HaEntryImporter(entriesService, secrets);

      const firstIssues = await importer.restoreRegistries(runtime, [
        {
          entryId: 'meross-1',
          domain: 'meross_lan',
          title: 'Outdoor Plug',
          source: 'import',
          data: { host: '192.168.5.50', timestamp: 1000 },
          options: {},
        },
      ]);
      expect(firstIssues).toEqual([]);
      expect(importCalls).toHaveLength(1);
      expect(importCalls[0]?.restoreOnly).toBe(true);

      // Runtime polling mutates `entry.data.timestamp`; registry itself is unchanged -> no duplicate restore.
      const secondIssues = await importer.restoreRegistries(runtime, [
        {
          entryId: 'meross-1',
          domain: 'meross_lan',
          title: 'Outdoor Plug',
          source: 'import',
          data: { host: '192.168.5.50', timestamp: 2000 },
          options: {},
        },
      ]);
      expect(secondIssues).toEqual([]);
      expect(importCalls).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exits StatsEngine.stop cleanly when StatsStore closes before flush finishes', async () => {
    const source = await openStatsSource(':memory:');
    const store = new StatsStore(source);
    const engine = new StatsEngine(store);
    await engine.initialize();
    engine.record('sensor.power', 42, 1_700_000_000);
    await store.close();
    await expect(engine.stop()).resolves.toBeUndefined();
  });
});
