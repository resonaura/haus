/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { HaFlowRuntime } from '../../dist/ha-flow/index.js';

const venvPython = existsSync(join(process.cwd(), '..', '..', '.venv', 'bin', 'python'))
  ? join(process.cwd(), '..', '..', '.venv', 'bin', 'python')
  : join(process.cwd(), '.venv', 'bin', 'python');
const hasVenvPython = existsSync(venvPython);

test(
  'ha-flow worker handles mqtt (non-hassio), webhook flows (cloud stub), and shimmed system dependencies cleanly',
  { timeout: 60_000, skip: !hasVenvPython },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-stability-'));
    const configDir = join(root, 'config');
    const depsDir = join(root, 'deps');
    const compDir = join(configDir, 'custom_components', 'shimmed_dep_probe');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(
      join(compDir, '__init__.py'),
      [
        'from homeassistant.const import Platform',
        'async def async_setup_entry(hass, entry):',
        '  await hass.config_entries.async_forward_entry_setups(entry, [Platform.SENSOR, Platform.CAMERA])',
        '  return True',
        'async def async_unload_entry(hass, entry):',
        '  return await hass.config_entries.async_unload_platforms(entry, [Platform.SENSOR, Platform.CAMERA])',
      ].join('\n'),
    );
    writeFileSync(
      join(compDir, 'sensor.py'),
      'async def async_setup_entry(hass, entry, async_add_entities):\n  async_add_entities([])\n',
    );
    writeFileSync(
      join(compDir, 'camera.py'),
      'async def async_setup_entry(hass, entry, async_add_entities):\n  async_add_entities([])\n',
    );
    writeFileSync(
      join(compDir, 'manifest.json'),
      JSON.stringify({
        domain: 'shimmed_dep_probe',
        name: 'Shimmed Dep Probe',
        version: '1.0.0',
        config_flow: true,
        dependencies: ['frontend', 'recorder', 'cloud', 'camera', 'websocket_api'],
      }),
    );
    const failOnceDir = join(configDir, 'custom_components', 'fail_once_probe');
    mkdirSync(failOnceDir, { recursive: true });
    writeFileSync(
      join(failOnceDir, 'manifest.json'),
      JSON.stringify({
        domain: 'fail_once_probe',
        name: 'Fail Once Probe',
        version: '1.0.0',
        config_flow: true,
      }),
    );
    writeFileSync(
      join(failOnceDir, '__init__.py'),
      [
        'async def async_setup_entry(hass, entry):',
        '  calls = hass.data.setdefault("fail_once_probe_calls", 0) + 1',
        '  hass.data["fail_once_probe_calls"] = calls',
        '  if calls > 1:',
        '    raise RuntimeError("double_setup_cascade_detected")',
        '  return False',
      ].join('\n'),
    );
    writeFileSync(
      join(compDir, 'config_flow.py'),
      [
        'import sys',
        'from homeassistant import config_entries',
        'from homeassistant.components import cloud',
        'from homeassistant.helpers.hassio import is_hassio',
        'class ShimmedDepProbeFlow(config_entries.ConfigFlow, domain="shimmed_dep_probe"):',
        '  VERSION = 1',
        '  async def async_step_user(self, user_input=None):',
        '    assert not is_hassio(self.hass)',
        '    assert not cloud.async_active_subscription(self.hass)',
        '    assert "core.uuid" in self.hass.data',
        '    assert "websocket_api" in self.hass.config.components',
        '    assert not sys.path[0].endswith("/deps"), f"deps_dir must not shadow venv: {sys.path[0]}"',
        '    return self.async_create_entry(title="Shimmed OK", data={"ok": True})',
      ].join('\n'),
    );
    const progressDir = join(configDir, 'custom_components', 'progress_tr_probe');
    mkdirSync(join(progressDir, 'translations'), { recursive: true });
    writeFileSync(join(progressDir, '__init__.py'), '');
    writeFileSync(
      join(progressDir, 'manifest.json'),
      JSON.stringify({
        domain: 'progress_tr_probe',
        name: 'Progress Probe',
        version: '1.0.0',
        config_flow: true,
      }),
    );
    writeFileSync(
      join(progressDir, 'translations', 'en.json'),
      JSON.stringify({
        config: {
          progress: {
            wait_pair: 'Press the button on {device_name} now.',
          },
        },
      }),
    );
    writeFileSync(
      join(progressDir, 'config_flow.py'),
      [
        'import asyncio',
        'from homeassistant import config_entries',
        'class ProgressProbeFlow(config_entries.ConfigFlow, domain="progress_tr_probe"):',
        '  VERSION = 1',
        '  _task = None',
        '  async def async_step_user(self, user_input=None):',
        '    if self._task is None:',
        '      self._task = self.hass.async_create_task(asyncio.sleep(10))',
        '    return self.async_show_progress(',
        '      step_id="user",',
        '      progress_action="wait_pair",',
        '      progress_task=self._task,',
        '      description_placeholders={"device_name": "Bridge X"},',
        '    )',
      ].join('\n'),
    );

    const runtime = new HaFlowRuntime({
      configDir,
      depsDir,
      autoInstallReqs: false,
      setupOnCreate: false,
    });

    try {
      // 1. MQTT starts cleanly without KeyError('hassio')
      const mqttStep = await runtime.initFlow({ domain: 'mqtt' });
      assert.equal(mqttStep.flowResult?.type, 'form');
      assert.equal(mqttStep.flowResult?.step_id, 'broker');
      await runtime.abortFlow(String(mqttStep.flowResult?.flow_id));

      // 2. WebhookConfigFlow (gpslogger) completes cleanly without ModuleNotFoundError('mutagen')
      const gpsInit = await runtime.initFlow({ domain: 'gpslogger' });
      assert.equal(gpsInit.flowResult?.type, 'form');
      const gpsDone = await runtime.configureFlow({
        flowId: String(gpsInit.flowResult?.flow_id),
        userInput: {},
      });
      assert.equal(gpsDone.flowResult?.type, 'create_entry');
      assert.equal(gpsDone.entry?.domain, 'gpslogger');

      // 3. Custom integration depending on shimmed system components (frontend/recorder/cloud/camera)
      // initializes cleanly AND forwards Platform.CAMERA + Platform.SENSOR without IntegrationNotLoaded
      const probe = await runtime.initFlow({ domain: 'shimmed_dep_probe' });
      assert.equal(probe.flowResult?.type, 'create_entry');
      assert.equal(probe.entry?.title, 'Shimmed OK');
      // Immediate terminal flow is cached so subsequent flow_get succeeds cleanly
      const probeFlowId = String(probe.flowResult?.flow_id);
      if (probeFlowId) {
        const cachedProbe = await runtime.getFlow(probeFlowId);
        assert.equal(cachedProbe.flowResult?.type, 'create_entry');
      }
      const probeEntryId = String(probe.entry?.entry_id);
      assert.ok(probeEntryId && probeEntryId !== 'undefined');
      let setupRes = await runtime.setupEntry(probeEntryId);
      for (let i = 0; i < 40 && setupRes.state === 'setup_in_progress'; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
        setupRes = await runtime.setupEntry(probeEntryId);
      }
      assert.equal(setupRes.ok, true);
      assert.equal(setupRes.state, 'loaded');

      // 3b. SHOW_PROGRESS resolves localized component.<domain>.config.progress.<action>
      const progStep = await runtime.initFlow({ domain: 'progress_tr_probe' });
      assert.equal(progStep.flowResult?.type, 'progress');
      assert.equal(progStep.localized?.description, 'Press the button on Bridge X now.');
      await runtime.abortFlow(String(progStep.flowResult?.flow_id));

      // 4. YAML-only HA component without async_setup_entry (e.g. eufy) returns not_supported cleanly
      // and a failing entry setup does NOT cascade into an immediate double-setup reload
      await runtime.syncState({
        entries: [
          { entryId: 'yaml_only_eufy', domain: 'eufy', title: 'Configure Eufy Security', data: {} },
          { entryId: 'fail_once_1', domain: 'fail_once_probe', title: 'Fail Once', data: {} },
        ],
      });
      let eufySetup = await runtime.setupEntry('yaml_only_eufy');
      for (let i = 0; i < 20 && eufySetup.state === 'setup_in_progress'; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
        eufySetup = await runtime.setupEntry('yaml_only_eufy');
      }
      assert.equal(eufySetup.ok, false);
      assert.equal(eufySetup.state, 'not_supported');

      let failSetup = await runtime.setupEntry('fail_once_1');
      for (let i = 0; i < 20 && failSetup.state === 'setup_in_progress'; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
        failSetup = await runtime.setupEntry('fail_once_1');
      }
      assert.equal(failSetup.ok, false);
      assert.equal(failSetup.state, 'setup_error');
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
