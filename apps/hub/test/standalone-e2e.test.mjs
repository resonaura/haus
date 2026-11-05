/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootstrapHub } from '../lib/bootstrap.mjs';
import { StandaloneHaClient } from '../lib/ha-client.mjs';
import { HausMqttClient, MqttDiscoveryRegistry, MqttTopicRouter } from '@haus/mqtt';
import {
  MatterController,
  MatterMultiAdminService,
  encodeMatterQrCode,
  generateManualPairingCode,
} from '@haus/matter';
import { ZigbeeCoordinator } from '@haus/zigbee';
import { ThreadController } from '@haus/thread';
import {
  HAPBridge,
  DeterministicIidManager,
  guardHomeKitTxtRecord,
} from '@haus/homekit';
import {
  SupervisorApiServer,
  kitsuneToHausDevice,
  HomebridgeLogInterceptor,
} from '@haus/kitsune';
import {
  resolveAppStartupOrder,
  verifyTierPermissions,
  ContainerTier,
  FakeHostAdapter,
} from '@haus/apps';
import {
  LocalAutomationEngine,
  AutomationHistoryTracker,
  AdapterConcurrencyLimiter,
  DeviceCategory,
  Protocol,
} from '@haus/core';

test('P6.2 End-to-end standalone Hub runtime verification without Home Assistant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-standalone-e2e-'));
  const media = join(root, 'media');
  const data = join(root, 'data');
  await mkdir(media, { recursive: true });
  await mkdir(data, { recursive: true });

  const prevData = process.env.HAUS_DATA;
  const prevMedia = process.env.HAUS_MEDIA;
  const prevPort = process.env.PORT;
  const prevSupToken = process.env.SUPERVISOR_TOKEN;
  const prevHaToken = process.env.HAUS_HA_TOKEN;
  const prevStandalone = process.env.HAUS_STANDALONE;

  process.env.HAUS_DATA = data;
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

  let app;
  try {
    // 1. Boot Hub in 100% standalone mode
    app = await bootstrapHub({
      signal: abortController.signal,
      scope,
    });
    assert.ok(app, 'Hub bootstrap returned valid instance');

    // 2. Verify Zero Home Assistant invariant
    const haClient = new StandaloneHaClient();
    assert.equal(haClient.connected, false, 'Home Assistant is disconnected');
    assert.deepEqual(await haClient.registry(), { states: [], entities: [], devices: [], areas: [] });

    // 3. Native MQTT Broker & Client Discovery (@haus/mqtt)
    const mqttRouter = new MqttTopicRouter();
    const mqttMessages = [];
    mqttRouter.subscribe('haus/light/+/state', (msg) => mqttMessages.push(msg));
    await mqttRouter.dispatch({
      topic: 'haus/light/lr_ceiling/state',
      payload: Buffer.from(JSON.stringify({ state: 'ON', brightness: 200 })),
    });
    assert.equal(mqttMessages.length, 1);

    const mqttRegistry = new MqttDiscoveryRegistry();
    const mqttLightPayload = {
      name: 'Living Room Ceiling',
      unique_id: 'mqtt_lr_ceiling_01',
      state_topic: 'haus/light/lr_ceiling/state',
      command_topic: 'haus/light/lr_ceiling/set',
      brightness: true,
      brightness_state_topic: 'haus/light/lr_ceiling/brightness',
      device: {
        identifiers: ['lr_ceiling_mac_01'],
        name: 'Living Room Light',
        manufacturer: 'Shelly',
        model: 'Plus 1',
      },
    };
    const parsedMqtt = mqttRegistry.handleDiscoveryMessage(
      'homeassistant/light/lr_ceiling/config',
      JSON.stringify(mqttLightPayload),
    );
    assert.ok(parsedMqtt, 'MQTT device payload parsed successfully');
    assert.equal(parsedMqtt.kind, 'light');
    assert.equal(parsedMqtt.objectId, 'lr_ceiling');

    // 4. Native Matter Commissioning & Codes (@haus/matter)
    let matterSubscriber;
    const matterTransport = {
      commission: async () => ({ nodeId: 'node-code-1', fabricIndex: 1 }),
      sendCommand: async () => ({ status: 'success' }),
      readAttribute: async () => true,
      writeAttribute: async () => undefined,
      subscribe: (cb) => {
        matterSubscriber = cb;
        return () => { matterSubscriber = undefined; };
      },
    };
    const matterController = new MatterController(matterTransport);
    const qrCode = encodeMatterQrCode({
      passcode: 20202021,
      discriminator: 3840,
      vendorId: 0xfff1,
      productId: 0x8001,
    });
    assert.ok(qrCode.startsWith('MT:'), 'Generated valid Matter QR code');

    const manualCode = generateManualPairingCode(3840, 20202021);
    assert.match(manualCode, /^\d{5}-\d{6}$/, 'Generated valid formatted 11-digit Matter manual code');

    const multiAdmin = new MatterMultiAdminService();
    const window = await multiAdmin.openCommissioningWindow({
      nodeId: 'node-bulb-01',
      durationSeconds: 300,
      discriminator: 1234,
      passcode: 34567890,
    });
    assert.equal(window.passcode, 34567890, 'Generated secure commissioning window passcode');
    assert.ok(window.qrPairingCode.startsWith('MT:'), 'Commissioning window payload is valid');
    assert.match(window.manualPairingCode, /^\d{5}-\d{6}$/);

    // 5. Native Zigbee Coordinator (@haus/zigbee)
    const zigbeeTransport = {
      start: async () => undefined,
      stop: async () => undefined,
      permitJoin: async () => undefined,
      sendCommand: async () => ({ status: 'SUCCESS' }),
      readAttribute: async () => 1,
      subscribe: () => () => {},
    };
    const zigbee = new ZigbeeCoordinator(zigbeeTransport);
    await zigbee.start({ serialPort: '/dev/ttyUSB0', channel: 25 });
    assert.equal(zigbee.running, true);
    await zigbee.permitJoin(60);
    await zigbee.stop();

    // 6. Native Thread Network (@haus/thread)
    const threadDataset = {
      networkName: 'HausThread',
      channel: 25,
      panId: 0x3c4d,
      extendedPanId: '1111222233334444',
      networkKey: '00112233445566778899aabbccddeeff',
      meshLocalPrefix: 'fd00:7d03:7d03::/64',
    };
    let activeThreadDataset = threadDataset;
    const threadTransport = {
      setActiveDataset: async (ds) => { activeThreadDataset = ds; },
      getActiveDataset: async () => activeThreadDataset,
      attach: async () => {},
      detach: async () => {},
      getState: async () => 'leader',
      getNeighbors: async () => [],
      commission: async () => {},
    };
    const thread = new ThreadController(threadTransport);
    await thread.formNetwork(threadDataset);
    const retrievedDs = await thread.getActiveDataset();
    assert.equal(retrievedDs.networkName, 'HausThread');
    assert.equal(retrievedDs.panId, 0x3c4d);

    // 7. HomeKit Bridge with Deterministic IIDs & TXT bounds (@haus/homekit)
    const iidManager = new DeterministicIidManager();
    const hapBridge = new HAPBridge(
      {
        name: 'Haus Standalone Bridge',
        pin: '031-45-154',
        setupId: 'HAUS',
        username: '00:11:22:33:44:55',
        port: 51828,
      },
      { iidManager },
    );
    await hapBridge.start();
    assert.equal(hapBridge.isRunning, true, 'HAP Bridge is running');
    const setupUri = hapBridge.setupUri;
    assert.ok(setupUri.startsWith('X-HM://'), 'Generated valid setup URI');
    const txtRecord = hapBridge.getTxtRecord();
    assert.ok(txtRecord['c#'], 'TXT record contains configuration number');
    await hapBridge.stop();
    assert.equal(hapBridge.isRunning, false, 'HAP Bridge cleanly stopped');

    // 8. Kitsune Universal Virtualization (@haus/kitsune)
    const supervisorApi = new SupervisorApiServer({
      mqtt: {
        host: '127.0.0.1',
        port: 18883,
        username: 'haus_addon',
        password: 'secure_password',
        ssl: false,
        protocol: '3.1.1',
      },
    });
    supervisorApi.registerAddon({
      slug: 'zigbee2mqtt',
      name: 'Zigbee2MQTT',
      version: '1.40.0',
      token: 'test-supervisor-token',
      options: { serial: { port: '/dev/ttyUSB0' } },
    });
    let responseBody = '';
    const mockRes = {
      statusCode: 0,
      setHeader: () => {},
      end: (data) => { responseBody = data; },
    };
    const handled = await supervisorApi.handleRequest(
      {
        url: '/services/mqtt',
        method: 'GET',
        headers: { authorization: 'Bearer test-supervisor-token' },
      },
      mockRes,
    );
    assert.equal(handled, true, 'Supervisor API handled /services/mqtt request');
    const mqttData = JSON.parse(responseBody);
    assert.equal(mqttData.result, 'ok');
    assert.equal(mqttData.data.host, '127.0.0.1');
    assert.equal(mqttData.data.port, 18883);

    const scryptedDevice = kitsuneToHausDevice(
      {
        id: 'scrypted_cam_front',
        nativeId: 'front-door',
        name: 'Front Door Camera',
        interfaces: ['VideoCamera', 'MotionSensor', 'OnOff'],
        state: { online: true, motionDetected: true, on: true },
      },
      'scrypted-onvif',
    );
    assert.equal(scryptedDevice.category, 'security');
    assert.equal(scryptedDevice.endpoints.length >= 2, true);

    const hbInterceptor = new HomebridgeLogInterceptor('homebridge-ring');
    const pinCard = hbInterceptor.processLine('Please pair with PIN 123-45-678 or scan the QR code');
    assert.ok(pinCard, 'Homebridge PIN parsed from stdout log');
    assert.equal(pinCard.pin, '123-45-678');

    // 9. Container Apps DAG and Security Permissions (@haus/apps)
    const startupResult = resolveAppStartupOrder([
      {
        id: 'zigbee2mqtt',
        name: 'Zigbee2MQTT',
        version: '1.0.0',
        image: 'koenkk/zigbee2mqtt:latest',
        architectures: ['amd64', 'arm64'],
        services: ['mqtt:need'],
      },
      {
        id: 'haus-mqtt',
        name: 'Haus MQTT Broker',
        version: '1.0.0',
        image: 'eclipse-mosquitto:2.0',
        architectures: ['amd64', 'arm64'],
        services: ['mqtt:provide'],
      },
    ]);
    assert.deepEqual(
      startupResult.orderedApps.map((a) => a.id),
      ['haus-mqtt', 'zigbee2mqtt'],
      'App startup DAG correctly orders native MQTT before dependent consumers',
    );

    const hostAdapter = new FakeHostAdapter();
    const manifest = {
      id: 'simple-app',
      name: 'Simple App',
      version: '1.0.0',
      image: 'haus/simple:latest',
      architectures: ['amd64', 'arm64'],
      mounts: [{ target: 'data', containerPath: '/data', readOnly: false }],
    };
    const tierPerm = await verifyTierPermissions(manifest, ['mount:data'], hostAdapter);
    assert.equal(tierPerm.compatible, true, 'Standard sandboxed container tier allowed');
    assert.equal(tierPerm.tier, ContainerTier.Ordinary);

    const escapeManifest = {
      id: 'escape-app',
      name: 'Escape App',
      version: '1.0.0',
      image: 'haus/escape:latest',
      architectures: ['amd64', 'arm64'],
      mounts: [{ target: '/var/run/docker.sock', containerPath: '/var/run/docker.sock' }],
    };
    const escapePerm = await verifyTierPermissions(escapeManifest, [], hostAdapter);
    assert.equal(escapePerm.compatible, false, 'Docker daemon socket strictly denied');

    // 10. Event-Local Execution Engine & Automation Execution (@haus/core/automation)
    const executedCommands = [];
    const env = {
      getEndpointState: () => false,
      executeDeviceCommand: async (endpointId, capability, command, args) => {
        executedCommands.push({ endpointId, capability, command, args });
      },
      activateScene: async () => {},
      callScript: async () => {},
      sendNotification: async () => {},
      now: () => new Date(),
    };
    const engine = new LocalAutomationEngine(env);
    const historyTracker = new AutomationHistoryTracker(100);

    engine.registerRule({
      schemaVersion: 1,
      id: 'auto_motion_light',
      name: 'Turn on light on motion',
      enabled: true,
      mode: 'single',
      triggers: [
        {
          type: 'state',
          endpointId: 'sensor:motion:living_room',
          to: 'on',
        },
      ],
      conditions: [],
      actions: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'light:ceiling:living_room',
              capability: 'on_off',
              command: 'turn_on',
            },
          },
        },
      ],
    });

    const dispatchResults = await engine.dispatch({
      type: 'state',
      endpointId: 'sensor:motion:living_room',
      to: 'on',
      from: 'off',
    });
    assert.equal(dispatchResults.length, 1, 'Rule was triggered');
    assert.equal(executedCommands.length, 1, 'Device command was dispatched');
    assert.equal(executedCommands[0].endpointId, 'light:ceiling:living_room');
    assert.equal(executedCommands[0].command, 'turn_on');

    // Verify 5-stage latency tracking and secret redaction
    const nowIso = new Date().toISOString();
    historyTracker.record({
      executionId: 'exec_001',
      ruleId: 'auto_motion_light',
      ruleName: 'Turn on light on motion',
      triggeredAt: nowIso,
      completedAt: nowIso,
      status: 'success',
      triggerType: 'state',
      latency: {
        eventReceipt: { durationMs: 0.1, timestamp: nowIso },
        conditionEvaluation: { durationMs: 0.05, timestamp: nowIso },
        commandDispatch: { durationMs: 0.2, timestamp: nowIso },
        providerConfirmation: { durationMs: 0.3, timestamp: nowIso },
        totalPhysicalResponse: { durationMs: 0.65, timestamp: nowIso },
      },
      actions: [
        {
          endpointId: 'light:ceiling:living_room',
          capability: 'on_off',
          command: 'turn_on',
          status: 'completed',
          durationMs: 0.5,
          parameters: { token: 'secret-auth-key-1234', kelvin: 4000 },
        },
      ],
    });

    const queried = historyTracker.query({ ruleId: 'auto_motion_light' });
    assert.equal(queried.length, 1);
    assert.equal(queried[0].latency.totalPhysicalResponse.durationMs, 0.65);
    // Verify sensitive secret was redacted in parameters
    assert.equal(queried[0].actions[0].parameters.token, '[REDACTED]');
    assert.equal(queried[0].actions[0].parameters.kelvin, 4000);

  } catch (err) {
    console.error('TEST ERROR:', err);
    throw err;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch {}
    }
    for (const fn of defers.reverse()) {
      try {
        await fn();
      } catch {}
    }
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
