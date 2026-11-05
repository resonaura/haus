/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { StandaloneHaClient } from '../lib/ha-client.mjs';
import { bootstrapHub } from '../lib/bootstrap.mjs';

test('loadConfig defaults to standalone when Home Assistant credentials are absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-config-test-'));
  const prevData = process.env.HAUS_DATA;
  const prevSupToken = process.env.SUPERVISOR_TOKEN;
  const prevHaToken = process.env.HAUS_HA_TOKEN;
  const prevStandalone = process.env.HAUS_STANDALONE;

  try {
    process.env.HAUS_DATA = root;
    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_STANDALONE;

    const config = await loadConfig();
    assert.equal(config.standalone, true);
    assert.equal(config.base, null);
    assert.equal(config.ws, null);
    assert.equal(config.token, null);
    assert.ok(config.apiToken);
  } finally {
    if (prevData) process.env.HAUS_DATA = prevData;
    else delete process.env.HAUS_DATA;
    if (prevSupToken) process.env.SUPERVISOR_TOKEN = prevSupToken;
    if (prevHaToken) process.env.HAUS_HA_TOKEN = prevHaToken;
    if (prevStandalone) process.env.HAUS_STANDALONE = prevStandalone;
    await rm(root, { recursive: true, force: true });
  }
});

test('StandaloneHaClient operates in-memory with zero network calls', async () => {
  const client = new StandaloneHaClient();
  assert.equal(client.connected, false);
  client.start();
  assert.equal(client.connected, false);

  const reg = await client.registry();
  assert.deepEqual(reg, { states: [], entities: [], devices: [], areas: [] });

  await assert.rejects(async () => client.request({ type: 'get_states' }), /ha_disconnected/);
  assert.equal(client.primaryRecordingInput(), undefined);

  client.stop();
  assert.equal(client.stopped, true);
});

test('bootstrapHub starts and stops cleanly in standalone mode without Home Assistant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-bootstrap-standalone-'));
  const media = join(root, 'media');
  await mkdir(media, { recursive: true });

  const prevData = process.env.HAUS_DATA;
  const prevMedia = process.env.HAUS_MEDIA;
  const prevPort = process.env.PORT;
  const prevSupToken = process.env.SUPERVISOR_TOKEN;
  const prevHaToken = process.env.HAUS_HA_TOKEN;
  const prevStandalone = process.env.HAUS_STANDALONE;

  try {
    process.env.HAUS_DATA = root;
    process.env.HAUS_MEDIA = media;
    process.env.PORT = '0'; // ephemeral port
    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    process.env.HAUS_STANDALONE = '1';

    const defers = [];
    const scope = {
      defer(fn) {
        defers.push(fn);
      },
    };
    const abortController = new AbortController();

    const app = await bootstrapHub({
      signal: abortController.signal,
      scope,
    });

    assert.ok(app);
    assert.equal(typeof app.close, 'function');

    // Clean shutdown
    await app.close();
    for (const fn of defers.reverse()) {
      try {
        await fn();
      } catch {}
    }
  } finally {
    if (prevData) process.env.HAUS_DATA = prevData;
    else delete process.env.HAUS_DATA;
    if (prevMedia) process.env.HAUS_MEDIA = prevMedia;
    else delete process.env.HAUS_MEDIA;
    if (prevPort) process.env.PORT = prevPort;
    else delete process.env.PORT;
    if (prevSupToken) process.env.SUPERVISOR_TOKEN = prevSupToken;
    if (prevHaToken) process.env.HAUS_HA_TOKEN = prevHaToken;
    if (prevStandalone) process.env.HAUS_STANDALONE = prevStandalone;
    await rm(root, { recursive: true, force: true });
  }
});
