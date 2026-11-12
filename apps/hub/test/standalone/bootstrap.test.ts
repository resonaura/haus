/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, createHubService } from '@haus/hub/runtime';
import { StandaloneHaClient } from '@haus/hub/ha';

test('loadConfig defaults to standalone when Home Assistant credentials are absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-config-test-'));
  const prevData = process.env.HAUS_DATA;
  const prevSupToken = process.env.SUPERVISOR_TOKEN;
  const prevHaToken = process.env.HAUS_HA_TOKEN;
  const prevStandalone = process.env.HAUS_STANDALONE;
  const prevAppliance = process.env.HAUS_APPLIANCE;
  const prevMode = process.env.HAUS_MODE;

  try {
    process.env.HAUS_DATA = root;
    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_STANDALONE;
    delete process.env.HAUS_APPLIANCE;
    delete process.env.HAUS_MODE;

    const config = await loadConfig();
    assert.equal(config.standalone, true);
    assert.equal(config.mode, 'standalone');
    assert.equal(config.base, null);
    assert.equal(config.ws, null);
    assert.equal(config.token, null);
    assert.ok(config.apiToken);
    assert.notEqual(config.apiToken, 'haus-standalone-local');
    assert.match(config.apiToken, /^[a-f0-9]{48}$/);

    // Ambient SUPERVISOR_TOKEN without explicit appliance choice still stays standalone
    process.env.SUPERVISOR_TOKEN = 'ambient-supervisor-token';
    const ambientConfig = await loadConfig();
    assert.equal(ambientConfig.standalone, true);
    assert.equal(ambientConfig.mode, 'standalone');

    // Explicit HA Green appliance enables ha-appliance overlay
    process.env.HAUS_APPLIANCE = 'ha-green';
    const applianceConfig = await loadConfig();
    assert.equal(applianceConfig.standalone, false);
    assert.equal(applianceConfig.mode, 'ha-appliance');
    assert.equal(applianceConfig.appliance, 'ha-green');
    assert.equal(applianceConfig.token, 'ambient-supervisor-token');
  } finally {
    if (prevData) process.env.HAUS_DATA = prevData;
    else delete process.env.HAUS_DATA;
    if (prevSupToken) process.env.SUPERVISOR_TOKEN = prevSupToken;
    else delete process.env.SUPERVISOR_TOKEN;
    if (prevHaToken) process.env.HAUS_HA_TOKEN = prevHaToken;
    else delete process.env.HAUS_HA_TOKEN;
    if (prevStandalone) process.env.HAUS_STANDALONE = prevStandalone;
    else delete process.env.HAUS_STANDALONE;
    if (prevAppliance) process.env.HAUS_APPLIANCE = prevAppliance;
    else delete process.env.HAUS_APPLIANCE;
    if (prevMode) process.env.HAUS_MODE = prevMode;
    else delete process.env.HAUS_MODE;
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

test('createHubService starts and stops cleanly in standalone mode without Home Assistant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-bootstrap-standalone-'));
  const media = join(root, 'media');
  await mkdir(media, { recursive: true });

  const prevData = process.env.HAUS_DATA;
  const prevDataDir = process.env.HAUS_DATA_DIR;
  const prevMedia = process.env.HAUS_MEDIA;
  const prevPort = process.env.PORT;
  const prevSupToken = process.env.SUPERVISOR_TOKEN;
  const prevHaToken = process.env.HAUS_HA_TOKEN;
  const prevStandalone = process.env.HAUS_STANDALONE;

  try {
    process.env.HAUS_DATA = root;
    delete process.env.HAUS_DATA_DIR;
    process.env.HAUS_MEDIA = media;
    process.env.PORT = '0'; // ephemeral port
    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    process.env.HAUS_STANDALONE = '1';

    const service = createHubService();
    await service.start();

    assert.ok(service);

    // Clean shutdown
    await service.stop();
  } finally {
    if (prevData) process.env.HAUS_DATA = prevData;
    else delete process.env.HAUS_DATA;
    if (prevDataDir) process.env.HAUS_DATA_DIR = prevDataDir;
    else delete process.env.HAUS_DATA_DIR;
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
