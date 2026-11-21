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

it('sets up Bluetooth passive/active update processor integrations and forwards distinct event entities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-ble-'));
  const component = join(root, 'config/custom_components/haus_ble_dimmer');
  await mkdir(component, { recursive: true });
  await writeFile(
    join(component, 'manifest.json'),
    JSON.stringify({
      domain: 'haus_ble_dimmer',
      name: 'BLE Dimmer Fixture',
      version: '1.0.0',
      documentation: 'https://example.com',
      codeowners: [],
      dependencies: ['bluetooth'],
      requirements: [],
    }),
  );
  await writeFile(
    join(component, '__init__.py'),
    [
      'import logging',
      'from homeassistant.components.bluetooth import BluetoothScanningMode',
      'from homeassistant.components.bluetooth.active_update_processor import ActiveBluetoothProcessorCoordinator',
      'from homeassistant.const import Platform',
      'PLATFORMS = [Platform.EVENT, Platform.BUTTON]',
      'async def async_setup_entry(hass, entry):',
      '    coordinator = ActiveBluetoothProcessorCoordinator(',
      '        hass, logging.getLogger(__name__),',
      '        address="F8:24:41:C5:7D:98", mode=BluetoothScanningMode.PASSIVE,',
      '        update_method=lambda info: {}, needs_poll_method=lambda info, last: False,',
      '        connectable=False,',
      '    )',
      '    hass.data.setdefault("haus_ble_dimmer", {})[entry.entry_id] = {"coordinator": coordinator}',
      '    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)',
      '    entry.async_on_unload(coordinator.async_start())',
      '    return True',
      'async def async_unload_entry(hass, entry):',
      '    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(component, 'event.py'),
    [
      'from homeassistant.components.event import EventEntity',
      'class DimmerEvent(EventEntity):',
      '    _attr_unique_id = "F8:24:41:C5:7D:98-dimmer"',
      '    _attr_name = "BLE Dimmer"',
      '    _attr_event_types = ["press", "rotate_right"]',
      '    def fire(self, event_type: str) -> None:',
      '        self._trigger_event(event_type)',
      '        self.async_write_ha_state()',
      '    def refresh_only(self) -> None:',
      '        self._attr_extra_state_attributes = {"rssi": -60}',
      '        self.async_write_ha_state()',
      'async def async_setup_entry(hass, entry, async_add_entities):',
      '    entity = DimmerEvent()',
      '    hass.data["haus_ble_dimmer"][entry.entry_id]["event"] = entity',
      '    async_add_entities([entity])',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(component, 'button.py'),
    [
      'from homeassistant.components.button import ButtonEntity',
      'class TriggerButton(ButtonEntity):',
      '    def __init__(self, entry_id: str, action: str) -> None:',
      '        self._entry_id = entry_id',
      '        self._action = action',
      '        self._attr_unique_id = f"ble-dimmer-{action}"',
      '        self._attr_name = f"Dimmer {action}"',
      '    async def async_press(self) -> None:',
      '        target = self.hass.data["haus_ble_dimmer"][self._entry_id]["event"]',
      '        if self._action == "noop":',
      '            target.refresh_only()',
      '        else:',
      '            target.fire(self._action)',
      'async def async_setup_entry(hass, entry, async_add_entities):',
      '    async_add_entities([TriggerButton(entry.entry_id, "press"), TriggerButton(entry.entry_id, "noop")])',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(component, 'config_flow.py'),
    'from homeassistant import config_entries\nclass BleDimmerFlow(config_entries.ConfigFlow, domain="haus_ble_dimmer"):\n    VERSION = 1\n',
  );
  const runtime = new HaFlowRuntime({
    configDir: join(root, 'config'),
    depsDir: join(root, 'deps'),
    startupTimeoutMs: 60_000,
  });
  const pushedEvents: Array<{ entityId: string; eventType: string }> = [];
  runtime.onEvent((event) => {
    pushedEvents.push({ entityId: event.entityId, eventType: event.eventType });
  });
  try {
    await runtime.importEntry({
      entry: {
        entryId: 'ble-dimmer-entry',
        domain: 'haus_ble_dimmer',
        title: 'BLE Dimmer',
        data: {},
        uniqueId: 'F8:24:41:C5:7D:98',
      },
    });
    await expect
      .poll(async () => (await runtime.setupEntry('ble-dimmer-entry')).ok, { timeout: 15_000 })
      .toBe(true);
    const snapshot = await runtime.entitySnapshot();
    const dimmer = snapshot.entities.find((entity) => entity.domain === 'event');
    const pressButton = snapshot.entities.find(
      (entity) => entity.domain === 'button' && entity.uniqueId === 'ble-dimmer-press',
    );
    const noopButton = snapshot.entities.find(
      (entity) => entity.domain === 'button' && entity.uniqueId === 'ble-dimmer-noop',
    );
    expect(dimmer).toMatchObject({ domain: 'event', state: 'unknown' });
    expect(pushedEvents).toHaveLength(0);
    if (!dimmer || !pressButton || !noopButton) throw new Error('missing fixture entities');

    await runtime.entityCommand('ble-dimmer-entry', pressButton.entityId, 'press', {});
    await expect.poll(() => pushedEvents.length, { timeout: 5_000 }).toBe(1);
    expect(pushedEvents[0]).toEqual({ entityId: dimmer.entityId, eventType: 'press' });

    // Non-event attribute updates must not re-emit the previous event_type.
    await runtime.entityCommand('ble-dimmer-entry', noopButton.entityId, 'press', {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(pushedEvents).toHaveLength(1);
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
