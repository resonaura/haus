/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Apps, type AppManifest } from '@haus/apps';
import { Identities } from '@haus/core/types';
import {
  createStandaloneAppDriver,
  StandaloneAppManager,
  type InstalledAppEntry,
} from '../../src/home/app-driver.js';
import { StandaloneHomePersistence } from '../../src/home/home.persistence.js';
import { AppOptions, persistAppOptions } from '../../src/home/options.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';

const manifest: AppManifest = {
  id: 'fixture-app',
  name: 'Fixture App',
  version: '1.0.0',
  image: 'example/fixture:1.0.0',
  architectures: ['amd64'],
};

describe('App option persistence', () => {
  it.each(['success', 'file-failure', 'denied'] as const)(
    'keeps runtime options and persisted configuration consistent on %s',
    async (mode) => {
      const root = mkdtempSync(join(tmpdir(), 'haus-app-configure-'));
      const source = await openCatalog(join(root, 'catalog.sqlite'));
      const transactions = new Transactions(source);
      try {
        const installed = new Map<string, InstalledAppEntry>();
        const identities = new Identities(
          { get: () => undefined, putIfAbsent: (_source, id) => id },
          () => 'fixture-app',
        );
        let authorized = true;
        const apps = new Apps(identities, { authorize: async () => authorized });
        const options = new AppOptions(root);
        apps.register(createStandaloneAppDriver(installed, undefined, options));
        const persistence = new StandaloneHomePersistence(transactions);
        const manager = new StandaloneAppManager(
          installed,
          apps,
          persistence,
          undefined,
          undefined,
          root,
          undefined,
          undefined,
          options,
        );
        const original = { token: 'preserved-private-value', disable_mqtt_with_haus: false };
        const { appId } = await manager.installApp('admin', manifest, [], original);
        if (mode === 'file-failure') {
          const blocked = join(root, 'blocked');
          writeFileSync(blocked, 'preserve');
          options.setRoot(blocked);
        }
        if (mode === 'denied') authorized = false;
        const result = await manager.operateApp('admin', appId, 'configure', {
          disable_mqtt_with_haus: true,
        });
        const expected =
          mode === 'success' ? { ...original, disable_mqtt_with_haus: true } : original;
        expect(result.status).toBe(mode === 'success' ? 'ok' : 'error');
        expect(JSON.stringify(result)).not.toContain(original.token);
        if (mode === 'file-failure') expect(result.reason).toBe('app_options_persist_failed');
        const file = join(root, manifest.id, 'data', 'options.json');
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(installed.get(manifest.id)?.config).toEqual(expected);
        expect((await persistence.load()).apps[0]?.[1].config).toEqual(expected);
        // This is the same private file the App reads at its next start.
        expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe(original.token);
        await manager.close();
      } finally {
        await transactions.drain();
        await source.destroy();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('atomically replaces options with owner-only permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-app-options-'));
    try {
      persistAppOptions(root, manifest.id, { token: 'one' });
      persistAppOptions(root, manifest.id, { token: 'two', enabled: true });

      const directory = join(root, manifest.id, 'data');
      const target = join(directory, 'options.json');
      assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { token: 'two', enabled: true });
      expect(statSync(target).mode & 0o777).toBe(0o600);
      expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops installation when option storage is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-app-options-failure-'));
    try {
      const blocked = join(root, 'not-a-directory');
      writeFileSync(blocked, 'preserve');
      const installed = new Map<string, InstalledAppEntry>();
      const identities = new Identities(
        {
          get: () => undefined,
          putIfAbsent: (_source, id) => id,
        },
        () => 'fixture-app',
      );
      const apps = new Apps(identities, { authorize: async () => true });
      apps.register(createStandaloneAppDriver(installed));
      const manager = new StandaloneAppManager(
        installed,
        apps,
        new StandaloneHomePersistence(),
        undefined,
        undefined,
        blocked,
      );

      await expect(manager.installApp('admin', manifest, [], { token: 'private' })).rejects.toThrow(
        'app_options_persist_failed',
      );
      expect(installed.size).toBe(0);
      expect(manager.getInstallProgress(manifest.id)).toMatchObject({
        stage: 'failed',
        errorCode: 'app_options_persist_failed',
      });
      expect(readFileSync(blocked, 'utf8')).toBe('preserve');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes an incomplete temporary file when replacement fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-app-options-replace-'));
    try {
      const directory = join(root, manifest.id, 'data');
      mkdirSync(join(directory, 'options.json'), { recursive: true });

      expect(() => persistAppOptions(root, manifest.id, { token: 'private' })).toThrow(
        'app_options_persist_failed',
      );
      expect(readdirSync(directory)).toEqual(['options.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
