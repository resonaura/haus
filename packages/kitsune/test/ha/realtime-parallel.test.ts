/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import {
  HaFlowRuntime,
  type HaRuntimeEntity,
  type HaRuntimeEvent,
} from '../../dist/ha-flow/index.js';

const execFileAsync = promisify(execFile);

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

      // 2. Real-time push delivers ha_event (with sessionId) and entity_states without polling entitySnapshot().
      await expect.poll(() => pushedEvents.length, { timeout: 1_000 }).toBeGreaterThanOrEqual(1);
      expect(typeof snap.sessionId).toBe('string');
      expect(snap.sessionId?.length).toBeGreaterThan(0);
      expect(pushedEvents[0]).toMatchObject({
        sessionId: snap.sessionId,
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

it(
  'Python EntityCommandQueue sums queued relative brightness steps and is_live_event_transition handles fresh first events',
  { timeout: 15_000, skip: !hasVenvPython },
  async () => {
    const haFlowDir = fileURLToPath(new URL('../../src/ha-flow', import.meta.url));
    const script = [
      'import asyncio, json, sys',
      'from datetime import datetime, timedelta, timezone',
      'from types import SimpleNamespace',
      `sys.path.insert(0, ${JSON.stringify(haFlowDir)})`,
      'from subentries import EntityCommandQueue, extract_event_data, is_live_event_transition',
      'from watchdog import HueEventWatchdog',
      'now = datetime(2026, 11, 21, 12, 0, 5, tzinfo=timezone.utc)',
      'fresh = SimpleNamespace(entity_id="event.dimmer", state=(now - timedelta(milliseconds=20)).isoformat(), last_updated=now)',
      'stale = SimpleNamespace(entity_id="event.dimmer", state=(now - timedelta(minutes=10)).isoformat(), last_updated=now)',
      'old = SimpleNamespace(entity_id="event.dimmer", state=(now - timedelta(minutes=10)).isoformat(), last_updated=now)',
      'unavail = SimpleNamespace(entity_id="event.dimmer", state="unavailable", last_updated=now)',
      'assert is_live_event_transition(None, fresh) is True',
      'assert is_live_event_transition(None, stale) is False',
      'assert is_live_event_transition(old, fresh) is True',
      'assert is_live_event_transition(unavail, stale) is False',
      'assert is_live_event_transition(unavail, fresh) is True',
      'assert is_live_event_transition(old, SimpleNamespace(entity_id="event.dimmer", state="unknown", last_updated=now)) is False',
      'assert extract_event_data({"event_type": "clock_wise", "event_types": ["clock_wise"], "friendly_name": "Dial", "steps": 15, "duration": 200}) == {"steps": 15, "duration": 200}',
      'assert extract_event_data({"event_type": "initial_press", "friendly_name": "Btn"}) is None',
      'async def main():',
      '    q = EntityCommandQueue()',
      '    gate = asyncio.Event()',
      '    calls = []',
      '    async def dispatch(dom, svc, data):',
      '        if not calls:',
      '            calls.append((svc, dict(data)))',
      '            await gate.wait()',
      '            return',
      '        calls.append((svc, dict(data)))',
      '    t1 = asyncio.create_task(q.run("light", "light.narnia", "turn_on", {"brightness_step_pct": 20}, dispatch))',
      '    await asyncio.sleep(0)',
      '    t2 = asyncio.create_task(q.run("light", "light.narnia", "turn_on", {"brightness_step_pct": 20}, dispatch))',
      '    t3 = asyncio.create_task(q.run("light", "light.narnia", "turn_on", {"brightness_step_pct": 20}, dispatch))',
      '    t4 = asyncio.create_task(q.run("light", "light.narnia", "turn_on", {"brightness_step_pct": 80}, dispatch))',
      '    await asyncio.sleep(0)',
      '    gate.set()',
      '    await asyncio.gather(t1, t2, t3, t4)',
      '    # Verify HueEventWatchdog closes old API before reload and catches dead tasks & silent stalls.',
      '    clock = [100.0]',
      '    order = []',
      '    class FakeTask:',
      '        def __init__(self, done_flag=False): self._done = done_flag',
      '        def done(self): return self._done',
      '    class FakeEvents:',
      '        def __init__(self, connected=True, tasks=None, qsize=0):',
      '            self.connected = connected',
      '            self._bg_tasks = tasks if tasks is not None else [FakeTask(), FakeTask(), FakeTask()]',
      '            self._event_queue = SimpleNamespace(qsize=lambda: qsize)',
      '            self._cbs = []',
      '        def subscribe(self, cb):',
      '            self._cbs.append(cb)',
      '            return lambda: self._cbs.remove(cb) if cb in self._cbs else None',
      '    class FakeApi:',
      '        def __init__(self, events): self.events = events',
      '        async def close(self): order.append("close")',
      '    entry = SimpleNamespace(entry_id="hue-1", domain="hue", state=SimpleNamespace(value="loaded"), runtime_data=SimpleNamespace(api=FakeApi(FakeEvents())))',
      '    async def fake_reload(eid):',
      '        order.append(f"reload:{eid}")',
      '        entry.runtime_data = SimpleNamespace(api=FakeApi(FakeEvents()))',
      '        return True',
      '    hass = SimpleNamespace(config_entries=SimpleNamespace(async_entries=lambda dom=None: [entry], async_reload=fake_reload))',
      '    reloaded_cb = []',
      '    wd = HueEventWatchdog(hass, on_reloaded=reloaded_cb.append, clock=lambda: clock[0])',
      '    assert await wd.check_once() == []',
      '    # Dead background task triggers close -> reload immediately.',
      '    entry.runtime_data.api.events._bg_tasks[1]._done = True',
      '    assert await wd.check_once() == ["hue-1"]',
      '    assert order == ["close", "reload:hue-1"] and reloaded_cb == ["hue-1"]',
      '    # Cooldown prevents immediate thrashing.',
      '    entry.runtime_data.api.events._bg_tasks[0]._done = True',
      '    assert await wd.check_once() == []',
      '    # After cooldown + silent stream stall (>75s), watchdog reloads again.',
      '    entry.runtime_data.api.events._bg_tasks[0]._done = False',
      '    clock[0] += 80.0',
      '    assert await wd.check_once() == ["hue-1"]',
      '    assert order == ["close", "reload:hue-1", "close", "reload:hue-1"]',
      '    print(json.dumps(calls))',
      'asyncio.run(main())',
    ].join('\n');

    const { stdout } = await execFileAsync(venvPython, ['-c', script], { timeout: 10_000 });
    expect(JSON.parse(stdout.trim())).toEqual([
      ['turn_on', { brightness_step_pct: 20 }],
      ['turn_on', { brightness_step_pct: 100 }],
    ]);
  },
);
