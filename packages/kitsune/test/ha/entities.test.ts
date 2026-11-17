/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { HaFlowRuntime } from '../../dist/ha-flow/index.js';

it('runs a synchronized HA entry and retains its entity across config synchronization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-entities-'));
  const runtime = new HaFlowRuntime({
    configDir: join(root, 'config'),
    depsDir: join(root, 'deps'),
    startupTimeoutMs: 60_000,
  });
  try {
    const entry = {
      entryId: 'haus-runtime-random',
      domain: 'random',
      title: 'Runtime Sensor',
      data: {},
      options: { entity_type: 'sensor', name: 'Runtime Sensor', minimum: 0, maximum: 10 },
      source: 'migration',
      version: 1,
    };
    await runtime.syncState({ entries: [entry] });
    await expect.poll(async () => (await runtime.setupEntry(entry.entryId)).ok).toBe(true);
    const before = await runtime.entitySnapshot();
    expect(before.entities).toEqual([
      expect.objectContaining({ entryId: entry.entryId, domain: 'sensor', name: 'Runtime Sensor' }),
    ]);
    await runtime.syncState({ entries: [entry] });
    expect((await runtime.setupEntry(entry.entryId)).ok).toBe(true);
    expect((await runtime.entitySnapshot()).entities[0]?.entityId).toBe(
      before.entities[0]?.entityId,
    );
    await runtime.syncState({ entries: [{ ...entry, disabledBy: 'user' }] });
    await expect
      .poll(async () => (await runtime.entitySnapshot()).entities.length, { timeout: 10_000 })
      .toBe(0);
    await runtime.syncState({ entries: [{ ...entry, disabledBy: null }] });
    await expect.poll(async () => (await runtime.setupEntry(entry.entryId)).ok).toBe(true);
    expect((await runtime.entitySnapshot()).entities[0]?.entityId).toBe(
      before.entities[0]?.entityId,
    );
    const importedEntity = before.entities[0];
    if (!importedEntity) throw new Error('expected a runtime entity');
    await expect(
      runtime.importEntry({
        entry: { ...entry, disabledBy: null },
        entities: [
          {
            entity_id: importedEntity.entityId,
            platform: 'random',
            unique_id: importedEntity.uniqueId,
            original_name: importedEntity.name,
          },
        ],
      }),
    ).resolves.toEqual({ entryId: entry.entryId, domain: entry.domain });
    expect((await runtime.entitySnapshot()).entities.map((entity) => entity.entityId)).toEqual(
      before.entities.map((entity) => entity.entityId),
    );
    await expect(
      runtime.entityCommand('different-entry', before.entities[0]?.entityId ?? '', 'turn_on', {}),
    ).rejects.toThrow('integration_entity_unavailable');
    expect((await runtime.unloadEntry(entry.entryId)).ok).toBe(true);
    expect((await runtime.entitySnapshot()).entities).toHaveLength(0);
    await expect.poll(async () => (await runtime.setupEntry(entry.entryId)).ok).toBe(true);
    expect((await runtime.entitySnapshot()).entities[0]?.entityId).toBe(
      before.entities[0]?.entityId,
    );
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

it('keeps the worker responsive while an integration is still connecting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-slow-'));
  const component = join(root, 'config/custom_components/haus_fixture');
  await mkdir(component, { recursive: true });
  await writeFile(
    join(component, 'manifest.json'),
    JSON.stringify({
      domain: 'haus_fixture',
      name: 'Fixture',
      version: '1.0.0',
      documentation: 'https://example.com',
      codeowners: [],
      requirements: [],
    }),
  );
  await writeFile(
    join(component, '__init__.py'),
    'import asyncio\nasync def async_setup_entry(hass, entry):\n    await asyncio.sleep(2)\n    hass.config_entries.async_update_entry(entry, options={**entry.options, "runtime_setting": "retained"})\n    return True\nasync def async_unload_entry(hass, entry):\n    return True\n',
  );
  await writeFile(
    join(component, 'config_flow.py'),
    'from homeassistant import config_entries\nclass FixtureFlow(config_entries.ConfigFlow, domain="haus_fixture"):\n    VERSION = 1\n',
  );
  const runtime = new HaFlowRuntime({
    configDir: join(root, 'config'),
    depsDir: join(root, 'deps'),
  });
  try {
    await runtime.importEntry({
      entry: { entryId: 'slow-entry', domain: 'haus_fixture', title: 'Slow', data: {} },
    });
    expect(await runtime.setupEntry('slow-entry')).toEqual({
      ok: false,
      state: 'setup_in_progress',
    });
    const start = performance.now();
    expect((await runtime.health()).ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(1_000);
    await expect
      .poll(async () => (await runtime.setupEntry('slow-entry')).ok, { timeout: 10_000 })
      .toBe(true);
    expect(
      (await runtime.entitySnapshot()).entries?.find((entry) => entry.entryId === 'slow-entry')
        ?.config?.options,
    ).toEqual({ runtime_setting: 'retained' });
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('imports a large disabled HA registry without activating the integration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-import-'));
  const runtime = new HaFlowRuntime({
    configDir: join(root, 'config'),
    depsDir: join(root, 'deps'),
    startupTimeoutMs: 60_000,
  });
  const entryId = 'large-disabled-hue';
  const areas = Array.from({ length: 6 }, (_, index) => ({
    id: `area-${index}`,
    name: `Fixture room ${index}`,
  }));
  const devices = Array.from({ length: 25 }, (_, index) => ({
    id: `device-${index}`,
    name: `Fixture bridge ${index}`,
    identifiers: [['hue', `fixture-${index}`]],
    area_id: `area-${index % areas.length}`,
  }));
  const entities = Array.from({ length: 125 }, (_, index) => ({
    entity_id: `light.fixture_${index}`,
    platform: 'hue',
    unique_id: `fixture-${index}-${'x'.repeat(520)}`,
    device_id: `device-${Math.floor(index / 5)}`,
    area_id: `area-${index % areas.length}`,
    original_name: `Fixture light ${index}`,
    ...(index === 45
      ? { disabled_by: 'user' }
      : index === 90
        ? { disabled_by: 'hass' }
        : index === 120
          ? { disabled_by: 'device' }
          : {}),
    ...(index === 45
      ? { entity_category: 'diagnostic' }
      : index === 90
        ? { entity_category: 'config' }
        : {}),
  }));
  const payload = {
    entry: {
      entryId,
      domain: 'hue',
      title: 'Fixture Hue bridge',
      data: { bridge_id: 'fixture' },
      options: {},
      uniqueId: 'fixture-bridge',
      version: 1,
      minorVersion: 0,
      disabledBy: 'user',
    },
    entities,
    devices,
    areas,
  };

  try {
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(64 * 1024);
    await expect(runtime.importEntry(payload)).resolves.toEqual({
      entryId,
      domain: 'hue',
    });
    const snapshot = await runtime.entitySnapshot();
    const imported = snapshot.entries?.find((entry) => entry.entryId === entryId);
    expect(imported?.config?.minorVersion).toBe(0);
    expect(imported?.state).not.toBe('loaded');
    expect(snapshot.entities.some((entity) => entity.entryId === entryId)).toBe(false);
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
