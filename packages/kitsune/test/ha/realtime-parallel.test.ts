/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  HaFlowRuntime,
  type HaRuntimeEntity,
  type HaRuntimeEvent,
} from '../../dist/ha-flow/index.js';

const venvPython = existsSync(join(process.cwd(), '..', '..', '.venv', 'bin', 'python'))
  ? join(process.cwd(), '..', '..', '.venv', 'bin', 'python')
  : join(process.cwd(), '.venv', 'bin', 'python');
const hasVenvPython = existsSync(venvPython);

it(
  'executes entity commands concurrently across devices, preserves per-entity order, and pushes live events/states',
  { timeout: 45_000, skip: !hasVenvPython },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-runtime-parallel-'));
    const compDir = join(root, 'config/custom_components/haus_perf');
    await mkdir(compDir, { recursive: true });
    await writeFile(
      join(compDir, 'manifest.json'),
      JSON.stringify({
        domain: 'haus_perf',
        name: 'Haus Perf Fixture',
        version: '1.0.0',
        documentation: 'https://example.com',
        codeowners: [],
        requirements: [],
      }),
    );
    await writeFile(
      join(compDir, 'config_flow.py'),
      'from homeassistant import config_entries\nclass PerfFlow(config_entries.ConfigFlow, domain="haus_perf"):\n    VERSION = 1\n',
    );
    await writeFile(
      join(compDir, '__init__.py'),
      [
        'import asyncio',
        'from homeassistant.const import Platform',
        'PLATFORMS = [Platform.LIGHT, Platform.EVENT]',
        'async def async_setup_entry(hass, entry):',
        '    hass.data.setdefault("haus_perf", {"history": []})',
        '    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)',
        '    return True',
        'async def async_unload_entry(hass, entry):',
        '    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)',
      ].join('\n'),
    );
    await writeFile(
      join(compDir, 'light.py'),
      [
        'import asyncio',
        'from homeassistant.components.light import ColorMode, LightEntity',
        'async def async_setup_entry(hass, entry, async_add_entities):',
        '    lights = [PerfLight(hass, i) for i in (1, 2, 3)]',
        '    hass.data["haus_perf"]["lights"] = lights',
        '    async_add_entities(lights)',
        'class PerfLight(LightEntity):',
        '    _attr_supported_color_modes = {ColorMode.COLOR_TEMP}',
        '    _attr_color_mode = ColorMode.COLOR_TEMP',
        '    def __init__(self, hass, idx):',
        '        self.hass = hass',
        '        self._idx = idx',
        '        self._attr_unique_id = f"perf_light_{idx}"',
        '        self._attr_name = f"Perf Light {idx}"',
        '        self._attr_is_on = False',
        '        self._attr_brightness = 0',
        '        self._attr_color_temp_kelvin = 3000',
        '    async def async_turn_on(self, **kwargs):',
        '        delay = 0.16 if kwargs.get("brightness", 0) != 200 else 0.02',
        '        await asyncio.sleep(delay)',
        '        self._attr_is_on = True',
        '        if "brightness" in kwargs:',
        '            self._attr_brightness = kwargs["brightness"]',
        '        if "color_temp_kelvin" in kwargs:',
        '            self._attr_color_temp_kelvin = kwargs["color_temp_kelvin"]',
        '        self.async_write_ha_state()',
        '        if self._idx == 1 and kwargs.get("brightness") == 120:',
        '            ev = self.hass.data["haus_perf"].get("button")',
        '            if ev is not None:',
        '                ev.fire_press()',
        '    async def async_turn_off(self, **kwargs):',
        '        self._attr_is_on = False',
        '        self.async_write_ha_state()',
      ].join('\n'),
    );
    await writeFile(
      join(compDir, 'event.py'),
      [
        'from homeassistant.components.event import EventEntity',
        'async def async_setup_entry(hass, entry, async_add_entities):',
        '    ev = PerfButton()',
        '    hass.data["haus_perf"]["button"] = ev',
        '    async_add_entities([ev])',
        'class PerfButton(EventEntity):',
        '    _attr_unique_id = "perf_button_1"',
        '    _attr_name = "Perf Button"',
        '    _attr_event_types = ["initial_press"]',
        '    def fire_press(self):',
        '        self._trigger_event("initial_press")',
        '        self.async_write_ha_state()',
      ].join('\n'),
    );

    const runtime = new HaFlowRuntime({
      configDir: join(root, 'config'),
      depsDir: join(root, 'deps'),
      startupTimeoutMs: 60_000,
    });
    const pushedEvents: HaRuntimeEvent[] = [];
    const pushedEntityBatches: (readonly HaRuntimeEntity[])[] = [];
    const unsubEv = runtime.onEvent((ev) => pushedEvents.push(ev));
    const unsubStates = runtime.onEntityStates((batch) => pushedEntityBatches.push(batch));

    try {
      const entryId = 'perf-entry-1';
      await runtime.importEntry({
        entry: { entryId, domain: 'haus_perf', title: 'Perf', data: {} },
      });
      await expect
        .poll(async () => (await runtime.setupEntry(entryId)).ok, { timeout: 10_000 })
        .toBe(true);
      const snap = await runtime.entitySnapshot();
      const lightIds = snap.entities
        .filter((e) => e.domain === 'light')
        .map((e) => e.entityId)
        .sort();
      expect(lightIds).toHaveLength(3);

      // 1. Concurrent commands across 3 distinct lights run in parallel (~160ms, not ~480ms),
      //    and kelvin is normalized to color_temp_kelvin cleanly even alongside hs_color.
      const start = performance.now();
      await Promise.all(
        lightIds.map((entityId) =>
          runtime.entityCommand(entryId, entityId, 'turn_on', {
            brightness: 120,
            kelvin: 4500,
            hs_color: [30, 20],
          }),
        ),
      );
      const parallelMs = performance.now() - start;
      expect(parallelMs).toBeLessThan(380);

      // 2. Real-time push delivers ha_event and entity_states without polling entitySnapshot().
      await expect.poll(() => pushedEvents.length, { timeout: 1_000 }).toBeGreaterThanOrEqual(1);
      expect(pushedEvents[0]).toMatchObject({
        entryId,
        eventType: 'initial_press',
      });
      await expect
        .poll(
          () =>
            pushedEntityBatches
              .flat()
              .some(
                (e) =>
                  e.entityId === lightIds[0] &&
                  e.state === 'on' &&
                  e.attributes.color_temp_kelvin === 4500,
              ),
          { timeout: 1_000 },
        )
        .toBe(true);

      // 3. Per-entity FIFO lock ensures slow first command (160ms, brightness=50) finishes
      //    BEFORE fast second command (20ms, brightness=200) on the same entity.
      await Promise.all([
        runtime.entityCommand(entryId, lightIds[1]!, 'turn_on', { brightness: 50 }),
        runtime.entityCommand(entryId, lightIds[1]!, 'turn_on', { brightness: 200 }),
      ]);
      const finalSnap = await runtime.entitySnapshot();
      const light2 = finalSnap.entities.find((e) => e.entityId === lightIds[1]);
      expect(light2?.attributes.brightness).toBe(200);

      // 4. Rapid slider burst on one light coalesces intermediate waiting values while merging
      //    orthogonal attributes (e.g. color_temp_kelvin + brightness) without queueing 6x delay.
      const burstStart = performance.now();
      await Promise.all([
        runtime.entityCommand(entryId, lightIds[2]!, 'turn_on', { brightness: 30 }),
        runtime.entityCommand(entryId, lightIds[2]!, 'turn_on', { brightness: 60 }),
        runtime.entityCommand(entryId, lightIds[2]!, 'turn_on', { color_temp_kelvin: 4200 }),
        runtime.entityCommand(entryId, lightIds[2]!, 'turn_on', { brightness: 110 }),
        runtime.entityCommand(entryId, lightIds[2]!, 'turn_on', { brightness: 150 }),
        runtime.entityCommand(entryId, lightIds[2]!, 'turn_on', { brightness: 200 }),
      ]);
      const burstMs = performance.now() - burstStart;
      // 1 slow in-flight (160ms) + 1 coalesced final (20ms) << 5 * 160ms (800ms)
      expect(burstMs).toBeLessThan(450);
      const afterBurst = await runtime.entitySnapshot();
      const light3 = afterBurst.entities.find((e) => e.entityId === lightIds[2]);
      expect(light3?.attributes.brightness).toBe(200);
      expect(light3?.attributes.color_temp_kelvin).toBe(4200);
    } finally {
      unsubEv();
      unsubStates();
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
