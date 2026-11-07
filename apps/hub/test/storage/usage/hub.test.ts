/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, expect, type TestContext } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { hubStorageUsage } from '../../../src/storage/usage/hub.js';

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'haus-hub-usage-'));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const config = { data: join(root, 'data'), media: join(root, 'media') };
  await Promise.all(Object.values(config).map((path) => mkdir(path)));
  return { root, config };
}

test('does not create a usage service without both managed roots', () => {
  expect(hubStorageUsage({})).toBeNull();
  expect(hubStorageUsage({ data: '/unused' })).toBeNull();
  expect(hubStorageUsage({ media: '/unused' })).toBeNull();
});

test('classifies Hub media, archives and workspace without exposing paths or backup identities', async (context) => {
  const { root, config } = await fixture(context);
  const ha = 'a'.repeat(64),
    haus = 'b'.repeat(64),
    unknown = 'c'.repeat(64);
  const data = [
    'buffer/ring.ts',
    `backups/${ha}.enc`,
    `backups/${haus}.enc`,
    `backups/${unknown}.enc`,
    'backups/upload.tmp',
    'catalog.sqlite-wal',
    'daemon.log',
    'layout.concat',
    'options.json',
    'backup.key',
  ];
  const media = [
    'camera.mp4',
    'camera.playback.mp4',
    'camera.partial.work.mp4',
    'camera.repair-abc.mp4',
    'camera.normalize-abc.mp4',
    'image.jpg',
    'private-source.bin',
  ];
  for (const [directory, files] of [
    [config.data, data],
    [config.media, media],
  ] as const)
    for (const name of files) {
      const path = join(directory, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, 'x');
    }
  let snapshots = 0;
  const usage = hubStorageUsage(config, {
    list() {
      snapshots++;
      return [
        { digest: ha, kind: 'ha' },
        { digest: haus, kind: 'haus' },
      ];
    },
  });
  expect(snapshots).toBe(0);
  if (!usage) throw Error('fixture_roots_missing');
  const report = await usage.collect();
  expect(snapshots).toBe(1);
  expect(report.complete).toBe(true);
  expect(report.files).toBe(17);
  expect(report.logicalBytes).toBe(17);
  expect(Object.fromEntries(report.categories.map((row) => [row.id, row.files]))).toEqual({
    'config-backups': 1,
    configuration: 2,
    databases: 1,
    'ha-backups': 1,
    logs: 1,
    originals: 1,
    other: 2,
    prebuffer: 1,
    prepared: 1,
    snapshots: 1,
    temporary: 5,
  });
  for (const privateValue of [root, ha, haus, unknown, 'private-source'])
    expect(JSON.stringify(report)).not.toContain(privateValue);
});

test('keeps one immutable backup classification snapshot throughout each scan', async (context) => {
  const { config } = await fixture(context),
    digest = 'd'.repeat(64);
  await mkdir(join(config.data, 'backups'));
  await writeFile(join(config.data, 'backups', digest + '.enc'), 'x');
  const items = [{ digest, kind: 'ha' }];
  let snapshots = 0;
  const usage = hubStorageUsage(config, {
    list() {
      snapshots++;
      queueMicrotask(() => {
        items[0].kind = 'haus';
      });
      return items;
    },
  });
  if (!usage) throw Error('fixture_roots_missing');
  expect((await usage.collect()).categories.map((row) => row.id)).toEqual(['ha-backups']);
  expect(items[0].kind).toBe('haus');
  expect((await usage.collect()).categories.map((row) => row.id)).toEqual(['config-backups']);
  expect(snapshots).toBe(2);
});
