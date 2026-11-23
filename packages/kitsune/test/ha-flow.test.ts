/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { HacsVirtualizer, HaFlowRuntime, HaFlowWorkerError } from '../dist/index.js';

const venvPython = existsSync(join(process.cwd(), '..', '..', '.venv', 'bin', 'python'))
  ? join(process.cwd(), '..', '..', '.venv', 'bin', 'python')
  : join(process.cwd(), '.venv', 'bin', 'python');
const hasVenvPython = existsSync(venvPython);

test(
  'HaFlowRuntime runs real HA config, menu, helper, virtual supported_by, and file upload flows',
  {
    timeout: 90_000,
    skip: !hasVenvPython,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-test-'));
    const runtime = new HaFlowRuntime({
      configDir: join(root, 'config'),
      depsDir: join(root, 'deps'),
      autoInstallReqs: true,
      setupOnCreate: false,
    });

    try {
      const health = await runtime.health();
      assert.equal(health.ok, true);
      assert.ok(health.haVersion.length > 0);

      // Menu step -> form step -> create_entry on HA core helper `random`
      const randInit = await runtime.initFlow({ domain: 'random' });
      assert.equal(randInit.flowResult?.type, 'menu');
      assert.ok(randInit.localized?.menuOptions.sensor);

      const randForm = await runtime.configureFlow({
        flowId: String(randInit.flowResult?.flow_id),
        userInput: { next_step_id: 'sensor' },
      });
      assert.equal(randForm.flowResult?.type, 'form');
      assert.ok((randForm.flowResult?.data_schema?.length ?? 0) > 0);

      const randDone = await runtime.configureFlow({
        flowId: String(randForm.flowResult?.flow_id),
        userInput: { name: 'Test Random', minimum: 0, maximum: 10 },
      });
      assert.equal(randDone.flowResult?.type, 'create_entry');
      assert.equal(randDone.entry?.domain, 'random');
      assert.equal(randDone.entry?.title, 'Test Random');

      // Options flow on the created config entry (derivative / random / template / generic)
      const handlers = await runtime.listFlowHandlers();
      assert.ok(handlers.handlers.includes('ipp'));
      assert.ok(handlers.handlers.includes('template'));
      assert.ok(handlers.handlers.length >= 600);

      // Virtual supported_by brand (`3_day_blinds` -> `motion_blinds`)
      const virt = await runtime.initFlow({ domain: '3_day_blinds' });
      assert.equal(virt.flowResult?.type, 'form');
      assert.equal(virt.flowResult?.handler, 'motion_blinds');
      assert.equal(virt.localized?.supportedBy, '3_day_blinds');
      assert.equal(virt.localized?.integrationTitle, '3 Day Blinds');
      await runtime.abortFlow(String(virt.flowResult?.flow_id));

      // On-demand PyPI dependency installation via uv (`ipp` -> `pyipp`)
      const ipp = await runtime.initFlow({ domain: 'ipp' });
      assert.equal(ipp.flowResult?.type, 'form');
      const ippFields = (ipp.flowResult?.data_schema ?? []).map((f) => f.name);
      assert.deepEqual(ippFields, ['host', 'port', 'base_path', 'ssl', 'verify_ssl']);
      await runtime.abortFlow(String(ipp.flowResult?.flow_id));

      // File upload + translations RPC + application credentials
      const uploaded = await runtime.uploadFile(
        'cert.pem',
        Buffer.from('test-pem').toString('base64'),
      );
      assert.ok(uploaded.fileId.length > 0);
      assert.equal(uploaded.filename, 'cert.pem');

      await runtime.addApplicationCredential({
        domain: 'spotify',
        clientId: 'cid-123',
        clientSecret: 'csec-456',
        name: 'My Spotify',
      });
      const creds = await runtime.listApplicationCredentials();
      assert.equal(creds.items.length, 1);

      const spotifyFlow = await runtime.initFlow({ domain: 'spotify' });
      assert.equal(spotifyFlow.flowResult?.type, 'external');
      assert.ok(spotifyFlow.flowResult?.url?.includes('accounts.spotify.com'));
      await runtime.abortFlow(String(spotifyFlow.flowResult?.flow_id));

      const tr = await runtime.getTranslations({
        categories: ['config', 'title'],
        integrations: ['template'],
      });
      assert.equal(tr.translations['component.template.title'], 'Template');

      // Sync state and run options flow / duplicate checks cleanly
      const synced = await runtime.syncState({
        entries: [
          {
            entryId: 'ent-generic-1',
            domain: 'generic',
            title: 'Porch Camera',
            data: {},
            options: { stream_source: 'rtsp://127.0.0.1/live' },
          },
        ],
      });
      assert.equal(synced.entriesCount, 1);

      const optFlow = await runtime.initFlow({
        domain: 'generic',
        flowKind: 'options',
        entryId: 'ent-generic-1',
      });
      assert.equal(optFlow.flowResult?.type, 'form');
      assert.ok((optFlow.flowResult?.data_schema?.length ?? 0) > 0);
      await runtime.abortFlow(String(optFlow.flowResult?.flow_id), 'options');

      // Discovery ServiceInfo construction (`mqtt` -> `tasmota`)
      const tasmotaPayload = {
        ip: '192.168.1.99',
        dn: 'Living Plug',
        fn: ['Plug'],
        hn: 'tasmota-plug',
        mac: 'AABBCCDDEEFF',
        md: 'Sonoff S31',
        t: 'tasmota_plug',
        ft: '%prefix%/%topic%/',
        rl: [1],
        swc: [-1],
        sw: ['13.1.0'],
        tp: ['cmnd', 'stat', 'tele'],
      };
      const disc = await runtime.triggerDiscovery({
        domain: 'tasmota',
        protocol: 'mqtt',
        discoveryKey: 'mqtt:tasmota:test-1',
        info: {
          topic: 'tasmota/discovery/AABBCCDDEEFF/config',
          subscribedTopic: 'tasmota/discovery/#',
          payload: JSON.stringify(tasmotaPayload),
        },
      });
      assert.equal(disc.outcome, 'form');
      assert.ok(disc.localized?.description?.includes('Tasmota'));
      assert.equal(disc.localized?.integrationTitle, 'Tasmota');
      const progress = await runtime.listProgressFlows();
      assert.ok(progress.flows.some((f) => f.handler === 'tasmota'));
      await runtime.abortFlow(String(disc.flowResult?.flow_id));
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'HaFlowRuntime reports missing requirements honestly when autoInstallReqs is disabled',
  { timeout: 45_000, skip: !hasVenvPython },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-noreq-'));
    const runtime = new HaFlowRuntime({
      configDir: join(root, 'config'),
      depsDir: join(root, 'deps'),
      autoInstallReqs: false,
    });
    try {
      await assert.rejects(
        () => runtime.initFlow({ domain: 'brother' }),
        (err: unknown) =>
          err instanceof HaFlowWorkerError &&
          err.code === 'missing_requirements' &&
          (err.missingRequirements?.length ?? 0) > 0,
      );
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'ha-flow worker exits cleanly on /dev/null stdin and isolates optional after_dependencies failures',
  { timeout: 45_000, skip: !hasVenvPython },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-resilience-'));
    const configDir = join(root, 'config');
    const depsDir = join(root, 'deps');
    const haFlowDir = existsSync(join(process.cwd(), 'dist', 'ha-flow'))
      ? join(process.cwd(), 'dist', 'ha-flow')
      : join(process.cwd(), 'packages', 'kitsune', 'dist', 'ha-flow');

    const writeTestFlow = (domain: string, extraManifest: Record<string, unknown>) => {
      const dir = join(configDir, 'custom_components', domain);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '__init__.py'), '');
      writeFileSync(
        join(dir, 'config_flow.py'),
        [
          'from homeassistant import config_entries',
          'import voluptuous as vol',
          `class TestFlowHandler(config_entries.ConfigFlow, domain=${JSON.stringify(domain)}):`,
          '  VERSION = 1',
          '  async def async_step_user(self, user_input=None):',
          '    return self.async_show_form(step_id="user", data_schema=vol.Schema({vol.Required("name"): str}))',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          domain,
          name: domain,
          version: '1.0.0',
          config_flow: true,
          ...extraManifest,
        }),
      );
    };

    writeTestFlow('opt_after_test', { after_dependencies: ['brother'] });
    writeTestFlow('req_dep_test', { dependencies: ['brother'] });

    const runtime = new HaFlowRuntime({
      configDir,
      depsDir,
      autoInstallReqs: false,
      setupOnCreate: false,
    });

    try {
      const workerRes = spawnSync(venvPython, [join(haFlowDir, 'worker.py'), configDir, depsDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
        encoding: 'utf8',
      });
      assert.equal(workerRes.status, 0, workerRes.stderr);

      const { handlers } = await runtime.listFlowHandlers();
      assert.ok(handlers.includes('opt_after_test'));
      assert.ok(handlers.includes('req_dep_test'));
      const optRes = await runtime.initFlow({ domain: 'opt_after_test' });
      assert.equal(optRes.flowResult?.type, 'form');
      await runtime.abortFlow(String(optRes.flowResult?.flow_id));

      await assert.rejects(
        () => runtime.initFlow({ domain: 'req_dep_test' }),
        (err: unknown) => {
          assert.ok(err instanceof HaFlowWorkerError);
          assert.equal(err.code, 'missing_requirements');
          return true;
        },
      );
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'ha-flow discovery normalizes Zeroconf IPv4/hostname/TXT, SSDP headers/UPnP/scanner, USB hex IDs, and idempotent progress/external polling',
  {
    timeout: 60_000,
    skip: !hasVenvPython,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-disc-'));
    const configDir = join(root, 'config');
    const depsDir = join(root, 'deps');
    const compDir = join(configDir, 'custom_components', 'disc_probe');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, '__init__.py'), '');
    writeFileSync(
      join(compDir, 'manifest.json'),
      JSON.stringify({
        domain: 'disc_probe',
        name: 'Discovery Probe',
        version: '1.0.0',
        config_flow: true,
      }),
    );
    writeFileSync(
      join(compDir, 'config_flow.py'),
      [
        'import asyncio',
        'from homeassistant import config_entries',
        'from homeassistant.components import ssdp',
        'class DiscProbeFlow(config_entries.ConfigFlow, domain="disc_probe"):',
        '  VERSION = 1',
        '  def __init__(self):',
        '    self._task = None',
        '    self._ext_calls = 0',
        '  async def async_step_zeroconf(self, info):',
        '    assert info.ip_address.version == 4, f"expected IPv4, got {info.ip_address}"',
        '    assert info.hostname == "Sonos-AABBCC.local.", f"bad hostname {info.hostname}"',
        '    assert info.properties["sf"] == "1" and info.properties["flag"] == "true"',
        '    return self.async_show_form(step_id="confirm")',
        '  async def async_step_ssdp(self, info):',
        '    assert info.ssdp_headers["LOCATION"] == "http://192.168.1.77:1400/xml/device_description.xml"',
        '    assert info.ssdp_headers["_host"] == "192.168.1.77"',
        '    assert info.upnp["UDN"] == "uuid:RINCON_AABBCC1400"',
        '    assert info.upnp["friendlyName"] == "Living Sonos"',
        '    assert info.upnp["presentationURL"] == "http://192.168.1.77:1400/"',
        '    cached = await ssdp.async_get_discovery_info_by_st(self.hass, "urn:schemas-upnp-org:device:ZonePlayer:1")',
        '    assert len(cached) == 1',
        '    return self.async_show_form(step_id="confirm")',
        '  async def async_step_usb(self, info):',
        '    assert info.vid == "10C4" and info.pid == "EA60"',
        '    return self.async_show_form(step_id="confirm")',
        '  async def async_step_dhcp(self, info):',
        '    assert info.hostname == "esp-living" and info.macaddress == "aabbccddeeff"',
        '    return self.async_show_form(step_id="confirm")',
        '  async def async_step_user(self, user_input=None):',
        '    self._ext_calls += 1',
        '    if self._ext_calls > 1 and user_input is None:',
        '      return self.async_abort(reason="reentered_external_on_poll")',
        '    if user_input is not None:',
        '      return self.async_external_step_done(next_step_id="progress_wait")',
        '    return self.async_external_step(step_id="user", url="https://example.com/auth")',
        '  async def async_step_progress_wait(self, user_input=None):',
        '    if self._task is None:',
        '      self._task = self.hass.async_create_task(asyncio.sleep(0.15))',
        '    if not self._task.done():',
        '      return self.async_show_progress(step_id="progress_wait", progress_action="working", progress_task=self._task)',
        '    return self.async_show_progress_done(next_step_id="finish")',
        '  async def async_step_finish(self, user_input=None):',
        '    return self.async_create_entry(title="Probe Done", data={"ok": True})',
        '  async def async_step_confirm(self, user_input=None):',
        '    return self.async_show_form(step_id="confirm")',
      ].join('\n'),
    );

    const runtime = new HaFlowRuntime({
      configDir,
      depsDir,
      autoInstallReqs: false,
      setupOnCreate: false,
    });

    try {
      const cases = [
        {
          protocol: 'zeroconf',
          discoveryKey: 'zc-1',
          info: {
            ipAddress: 'fe80::1',
            ipAddresses: ['fe80::1', '2001:db8::1', '192.168.1.55'],
            hostname: '192.168.1.55',
            name: 'Sonos-AABBCC._sonos._tcp.local.',
            type: '_sonos._tcp.local.',
            properties: { sf: 1, flag: true },
          },
        },
        {
          protocol: 'ssdp',
          discoveryKey: 'ssdp-1',
          info: {
            name: 'Living Sonos',
            ssdpLocation: 'http://192.168.1.77:1400/xml/device_description.xml',
            ssdpSt: 'urn:schemas-upnp-org:device:ZonePlayer:1',
            ssdpUsn: 'uuid:RINCON_AABBCC1400::urn:schemas-upnp-org:device:ZonePlayer:1',
            upnp: {},
          },
        },
        {
          protocol: 'usb',
          discoveryKey: 'usb-1',
          info: { device: '/dev/ttyUSB0', vid: '0x10c4', pid: 'ea60' },
        },
        {
          protocol: 'dhcp',
          discoveryKey: 'dhcp-1',
          info: { ip: '192.168.1.88', hostname: 'esp-living.local.', mac: 'AA:BB:CC-DD.EE.FF' },
        },
      ];
      for (const c of cases) {
        const res = await runtime.triggerDiscovery({ domain: 'disc_probe', ...c });
        assert.equal(res.outcome, 'form');
        await runtime.abortFlow(String(res.flowResult?.flow_id));
      }

      // External step polling must not re-enter step handler with None
      const extInit = await runtime.initFlow({ domain: 'disc_probe' });
      const fid = String(extInit.flowResult?.flow_id);
      assert.equal(extInit.flowResult?.type, 'external');
      assert.equal((await runtime.getFlow(fid)).flowResult?.type, 'external');

      // Advance external -> progress_wait -> poll getFlow -> create_entry -> cached create_entry
      const progStep = await runtime.configureFlow({ flowId: fid, userInput: { code: 'ok' } });
      assert.equal(progStep.flowResult?.type, 'progress');
      await new Promise((r) => setTimeout(r, 250));
      const doneStep = await runtime.getFlow(fid);
      assert.equal(doneStep.flowResult?.type, 'create_entry');
      assert.equal(doneStep.entry?.title, 'Probe Done');
      assert.equal((await runtime.getFlow(fid)).flowResult?.type, 'create_entry');
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('HacsVirtualizer supports fan, humidifier, valve, alarm_control_panel, number, text, camera, and input helpers', async () => {
  const calls: string[] = [];
  const virtualizer = new HacsVirtualizer(undefined, async (p) => {
    calls.push(`${p.domain}.${p.service}`);
  });
  const add = (
    entityId: string,
    domain: string,
    state: string,
    deviceId: string,
    attributes: Record<string, unknown>,
  ) =>
    virtualizer.handleEntityAdded({
      entityId,
      domain,
      name: entityId,
      state,
      deviceId,
      attributes,
    });

  add('fan.bedroom', 'fan', 'on', 'dev-fan', {
    percentage: 66,
    preset_modes: ['auto'],
    oscillating: true,
  });
  add('humidifier.nursery', 'humidifier', 'on', 'dev-hum', {
    target_humidity: 55,
    available_modes: ['baby'],
  });
  add('valve.main_water', 'valve', 'open', 'dev-valve', { current_position: 100 });
  add('alarm_control_panel.home', 'alarm_control_panel', 'disarmed', 'dev-alarm', {});
  add('number.sensitivity', 'number', '7', 'dev-num', { min: 1, max: 10, step: 1 });

  assert.equal(virtualizer.getDevice('dev-fan')?.endpoints[0]?.readings.fan_speed?.value, 66);
  assert.equal(virtualizer.getDevice('dev-hum')?.endpoints[0]?.readings.target_humidity?.value, 55);
  assert.equal(virtualizer.getDevice('dev-valve')?.endpoints[0]?.readings.cover?.value, 100);
  assert.equal(
    virtualizer.getDevice('dev-alarm')?.endpoints[0]?.readings.alarm_state?.value,
    'disarmed',
  );
  assert.equal(virtualizer.getDevice('dev-num')?.endpoints[0]?.readings.number?.value, 7);

  await virtualizer.executeCommand('dev-fan', 'fan.bedroom', 'fan_speed', 80);
  await virtualizer.executeCommand('dev-hum', 'humidifier.nursery', 'target_humidity', 60);
  await virtualizer.executeCommand('dev-valve', 'valve.main_water', 'on_off', false);
  await virtualizer.executeCommand(
    'dev-alarm',
    'alarm_control_panel.home',
    'alarm_state',
    'armed_away',
  );
  await virtualizer.executeCommand('dev-num', 'number.sensitivity', 'number', 9);

  assert.deepEqual(calls, [
    'fan.set_percentage',
    'humidifier.set_humidity',
    'valve.close_valve',
    'alarm_control_panel.alarm_arm_away',
    'number.set_value',
  ]);
});
