/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { test, onTestFinished } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedConfig } from '@haus/hub/preferences';
import { openTestCatalog } from '../support/catalog.js';

test('shared preferences use revision guards and reject credentials or arbitrary settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-shared-config-'));
  const catalog = await openTestCatalog(join(root, 'haus.sqlite'));
  const shared = new SharedConfig(catalog.transactions);
  await shared.ready;
  onTestFinished(async () => {
    await catalog.close();
    await rm(root, { recursive: true, force: true });
  });

  assert.equal((await shared.get()).revision, '0');
  const first = await shared.patch('0', { roomIcons: { narnia: 'moon' } });
  assert.equal((await shared.patch('0', { favorites: ['bad'] })).conflict, true);
  assert.deepEqual((await shared.get()).value, { roomIcons: { narnia: 'moon' } });
  assert.notEqual(
    (await shared.patch(first.revision, { favorites: ['lamp'] })).revision,
    first.revision,
  );
  await assert.rejects(
    shared.patch(shared.revision, { access_token: 'secret' }),
    /invalid_shared_config/,
  );
});

test('server names and room assignments synchronize without replacing other preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-shared-config-'));
  const database = join(root, 'haus.sqlite');
  const catalog = await openTestCatalog(database);
  const shared = new SharedConfig(catalog.transactions);
  await shared.ready;
  onTestFinished(async () => {
    await catalog.close();
    await rm(root, { recursive: true, force: true });
  });

  const first = await shared.patch('0', {
    favorites: ['light.narnia'],
    roomIcons: { narnia: 'moon' },
  });
  const serverDevices = {
    'home-assistant': { areaId: 'narnia' },
    'node-miku': { name: 'Miku', areaId: 'narnia' },
    'node-laptop': { name: 'Black Laptop', areaId: 'narnia' },
  };
  const saved = await shared.patch(first.revision, { serverDevices });
  assert.deepEqual(saved.value.serverDevices, serverDevices);
  assert.deepEqual(saved.value.favorites, ['light.narnia']);
  assert.deepEqual(saved.value.roomIcons, { narnia: 'moon' });

  const restoredCatalog = await openTestCatalog(database);
  const restored = new SharedConfig(restoredCatalog.transactions);
  await restored.ready;
  assert.deepEqual(await restored.get(), saved);
  assert.equal((await shared.patch(first.revision, { serverDevices: {} })).conflict, true);
  assert.deepEqual((await shared.get()).value.serverDevices, serverDevices);
  await restoredCatalog.close();
});
