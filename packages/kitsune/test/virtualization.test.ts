/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'vitest';
import type { HausDevice, Reading } from '@haus/core';
import {
  kitsuneToHausDevice,
  executeScryptedCommand,
  SupervisorApiServer,
  IngressProxy,
  PythonSidecarHarness,
  HacsVirtualizer,
  HomebridgeVirtualApi,
  HomebridgeLogInterceptor,
  HomebridgeChildBridge,
  MockAccessory,
  HAPServices,
  type DeviceRecord,
  type HacsEntityPayload,
  type HomebridgePairingCard,
} from '../dist/index.js';

test('kitsuneToHausDevice and executeScryptedCommand map Scrypted interfaces to Haus devices', async () => {
  const record: DeviceRecord = {
    id: 'cam1',
    nativeId: 'front-door',
    name: 'Front Door Camera',
    interfaces: ['VideoCamera', 'MotionSensor', 'Intercom', 'OnOff'],
    state: { online: true, motionDetected: true, intercomActive: false, on: true },
  };

  const device = kitsuneToHausDevice(record, 'scrypted-onvif');
  assert.equal(device.id, 'kitsune:scrypted-onvif:front-door');
  assert.equal(device.name, 'Front Door Camera');
  assert.equal(device.category, 'security');
  assert.equal(device.availability, 'online');
  assert.equal(device.endpoints.length, 4);

  const motionEndpoint = device.endpoints.find((ep) => ep.id === 'motion');
  assert.ok(motionEndpoint);
  assert.equal(motionEndpoint.readings.motion?.value, true);

  const calls: Array<{ method: string; args: unknown[]; devId?: string }> = [];
  const mockTarget = {
    call: async <T = unknown>(method: string, args: unknown[] = [], devId?: string): Promise<T> => {
      calls.push({ method, args, devId });
      return { success: true } as T;
    },
  };

  await executeScryptedCommand(mockTarget, 'cam1', 'on_off', true);
  assert.equal(calls[0]?.method, 'turnOn');

  await executeScryptedCommand(mockTarget, 'cam1', 'on_off', false);
  assert.equal(calls[1]?.method, 'turnOff');

  await executeScryptedCommand(mockTarget, 'cam1', 'audio_talkback', true);
  assert.equal(calls[2]?.method, 'startIntercom');

  await executeScryptedCommand(mockTarget, 'cam1', 'camera', null);
  assert.equal(calls[3]?.method, 'refresh');
});

test('SupervisorApiServer handles auth, options, info, MQTT service and discovery', async () => {
  let changedOptions: { slug: string; options: Record<string, unknown> } | null = null;
  const server = new SupervisorApiServer({
    mqtt: {
      host: '127.0.0.1',
      port: 1883,
      ssl: false,
      protocol: '3.1.1',
      username: 'haus-mqtt',
      password: 'password123',
    },
    onOptionsChanged: (slug, options) => {
      changedOptions = { slug, options };
    },
  });

  server.registerAddon({
    slug: 'zigbee2mqtt',
    name: 'Zigbee2MQTT',
    version: '1.40.0',
    token: 'test-supervisor-token',
    options: { pan_id: 6754, channel: 15 },
    ingressPort: 8099,
    ingressPath: '/api/ingress/zigbee2mqtt',
  });

  const httpServer = createServer(async (req, res) => {
    await server.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Missing token
    const resNoAuth = await fetch(`${baseUrl}/addons/self/options`);
    assert.equal(resNoAuth.status, 401);

    // 2. Invalid token
    const resBadAuth = await fetch(`${baseUrl}/addons/self/options`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(resBadAuth.status, 403);

    // 3. GET options
    const resGetOptions = await fetch(`${baseUrl}/addons/self/options`, {
      headers: { Authorization: 'Bearer test-supervisor-token' },
    });
    assert.equal(resGetOptions.status, 200);
    const dataGetOptions = (await resGetOptions.json()) as {
      result: string;
      data: { options: { pan_id: number } };
    };
    assert.equal(dataGetOptions.result, 'ok');
    assert.equal(dataGetOptions.data.options.pan_id, 6754);

    // 4. POST options
    const resPostOptions = await fetch(`${baseUrl}/addons/self/options`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-supervisor-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ options: { channel: 20 } }),
    });
    assert.equal(resPostOptions.status, 200);
    assert.deepEqual(changedOptions, {
      slug: 'zigbee2mqtt',
      options: { pan_id: 6754, channel: 20 },
    });

    // 5. GET addon info
    const resInfo = await fetch(`${baseUrl}/addons/self/info`, {
      headers: { Authorization: 'Bearer test-supervisor-token' },
    });
    const dataInfo = (await resInfo.json()) as {
      result: string;
      data: { slug: string; ingress: boolean; ingress_port: number };
    };
    assert.equal(dataInfo.result, 'ok');
    assert.equal(dataInfo.data.slug, 'zigbee2mqtt');
    assert.equal(dataInfo.data.ingress, true);
    assert.equal(dataInfo.data.ingress_port, 8099);

    // 6. GET /services/mqtt (Native MQTT sharing without HA Mosquitto)
    const resMqtt = await fetch(`${baseUrl}/services/mqtt`, {
      headers: { Authorization: 'Bearer test-supervisor-token' },
    });
    const dataMqtt = (await resMqtt.json()) as {
      result: string;
      data: { host: string; port: number; username: string };
    };
    assert.equal(dataMqtt.result, 'ok');
    assert.equal(dataMqtt.data.host, '127.0.0.1');
    assert.equal(dataMqtt.data.port, 1883);
    assert.equal(dataMqtt.data.username, 'haus-mqtt');

    // 7. POST /discovery and GET /discovery
    const resPostDiscovery = await fetch(`${baseUrl}/discovery`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-supervisor-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ service: 'esphome', config: { host: '192.168.1.50' } }),
    });
    const dataPostDiscovery = (await resPostDiscovery.json()) as {
      result: string;
      data: { uuid: string };
    };
    assert.equal(dataPostDiscovery.result, 'ok');
    const uuid = dataPostDiscovery.data.uuid;
    assert.ok(uuid);

    const resGetDiscovery = await fetch(`${baseUrl}/discovery`, {
      headers: { Authorization: 'Bearer test-supervisor-token' },
    });
    const dataGetDiscovery = (await resGetDiscovery.json()) as {
      result: string;
      data: { discovery: Array<{ uuid: string }> };
    };
    assert.equal(dataGetDiscovery.result, 'ok');
    assert.ok(dataGetDiscovery.data.discovery.some((d) => d.uuid === uuid));
  } finally {
    httpServer.close();
  }
});

test('IngressProxy rewrites subpaths and injects base tag into HTML responses', async () => {
  // Mock container web server returning HTML
  const containerServer = createServer((req, res) => {
    assert.equal(req.headers['x-ingress-path'], '/api/ingress/z2m');
    assert.equal(req.url, '/dashboard');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><head><title>Z2M</title></head><body>Hello</body></html>');
  });

  await new Promise<void>((resolve) => containerServer.listen(0, resolve));
  const containerPort = (containerServer.address() as AddressInfo).port;

  const ingress = new IngressProxy();
  ingress.registerRoute({
    ingressPath: '/api/ingress/z2m',
    targetHost: '127.0.0.1',
    targetPort: containerPort,
  });

  const gatewayServer = createServer((req, res) => {
    const handled = ingress.handleRequest(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end('Not handled');
    }
  });

  await new Promise<void>((resolve) => gatewayServer.listen(0, resolve));
  const gatewayPort = (gatewayServer.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/ingress/z2m/dashboard`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<base href="/api/ingress/z2m/">'));
  } finally {
    gatewayServer.close();
    containerServer.close();
  }
});

test(
  'PythonSidecarHarness boots mock HA environment and handles RPC communication',
  { timeout: 20000 },
  async () => {
    const harness = new PythonSidecarHarness();
    try {
      await harness.start();

      // 1. Setup entry
      const setupRes = (await harness.setupEntry('demo_integration', 'entry_1', {
        host: '192.168.1.10',
      })) as { status?: string };
      assert.equal(setupRes.status, 'ok');

      // 2. Register entity and receive event
      const entityAddedPromise = new Promise<HacsEntityPayload>((resolve) => {
        harness.once('entity_added', resolve);
      });

      await harness.registerEntity({
        entityId: 'light.living_room_lamp',
        domain: 'light',
        name: 'Living Room Lamp',
        state: 'on',
        attributes: { brightness: 255 },
      });

      const addedEvent = await entityAddedPromise;
      assert.equal(addedEvent.entityId, 'light.living_room_lamp');
      assert.equal(addedEvent.state, 'on');

      // 3. Call service
      const serviceRes = (await harness.callService({
        domain: 'homeassistant',
        service: 'turn_off',
        serviceData: { entity_id: 'light.living_room_lamp' },
      })) as { status?: string };
      assert.equal(serviceRes.status, 'ok');

      // 4. Test Bluetooth advertisement injection and callback dispatch
      await harness.testRegisterBleCallback('F8:24:41:C5:7D:98');

      const bleEventPromise = new Promise<{
        address: string;
        name?: string;
        rssi?: number;
        serviceData?: Record<string, string>;
      }>((resolve) => {
        harness.once('ble_advertisement_received', (ev) => resolve(ev as {
          address: string;
          name?: string;
          rssi?: number;
          serviceData?: Record<string, string>;
        }));
      });

      const injectRes = await harness.injectBleAdvertisement({
        address: 'F8:24:41:C5:7D:98',
        name: 'Dimmer Switch 7D98',
        rssi: -55,
        serviceData: {
          '0000fe95-0000-1000-8000-00805f9b34fb': '30585b0501987dc54124f808',
        },
        manufacturerData: {
          0x038f: '01020304',
        },
      });

      assert.equal(injectRes.status, 'ok');
      assert.equal(injectRes.matched, 1);

      const bleEvent = await bleEventPromise;
      assert.equal(bleEvent.address, 'F8:24:41:C5:7D:98');
      assert.equal(bleEvent.name, 'Dimmer Switch 7D98');
      assert.equal(bleEvent.rssi, -55);
      assert.ok(bleEvent.serviceData?.['0000fe95-0000-1000-8000-00805f9b34fb']);
    } finally {
      await harness.stop();
    }
  },
);

test(
  'HacsVirtualizer maps entities into Haus Unified Device Registry and dispatches commands',
  { timeout: 20000 },
  async () => {
    const harness = new PythonSidecarHarness();
    const virtualizer = new HacsVirtualizer(harness);

    const discoveredDevices: HausDevice[] = [];
    virtualizer.on('deviceDiscovered', (device: HausDevice) => {
      discoveredDevices.push(device);
    });

    const stateChanges: Array<{ deviceId: string; readings: Record<string, Reading> }> = [];
    virtualizer.on('deviceStateChanged', (deviceId: string, readings: Record<string, Reading>) => {
      stateChanges.push({ deviceId, readings });
    });

    try {
      await virtualizer.start();

      // Register a light entity via harness
      await harness.registerEntity({
        entityId: 'light.kitchen_strip',
        domain: 'light',
        name: 'Kitchen LED Strip',
        state: 'on',
        attributes: { brightness: 128 },
      });

      assert.equal(discoveredDevices.length, 1);
      const dev = discoveredDevices[0];
      assert.ok(dev);
      assert.equal(dev.name, 'Kitchen LED Strip');
      assert.equal(dev.category, 'lighting');
      assert.equal(dev.endpoints.length, 1);
      assert.equal(dev.endpoints[0]?.readings.on_off?.value, true);
      assert.equal(dev.endpoints[0]?.readings.brightness?.value, 50);

      // Command dispatch
      await virtualizer.executeCommand(dev.id, 'light.kitchen_strip', 'on_off', false);
      // Command succeeded without throwing
    } finally {
      await virtualizer.stop();
    }
  },
);

test('HomebridgeVirtualApi ingests accessories in-memory and routes state changes and commands', async () => {
  const api = new HomebridgeVirtualApi();
  const discovered: HausDevice[] = [];
  api.on('deviceDiscovered', (dev: HausDevice) => discovered.push(dev));

  const stateChanges: Array<{ deviceId: string; readings: Record<string, Reading> }> = [];
  api.on('deviceStateChanged', (deviceId: string, readings: Record<string, Reading>) => {
    stateChanges.push({ deviceId, readings });
  });

  // Create a mock accessory with Lightbulb service
  const acc = new MockAccessory('Bedroom Light', 'uuid-bedroom-1234');
  const lightService = new HAPServices.Lightbulb('Bedroom Light');
  acc.addService(lightService);

  // Ingest accessory directly in-memory
  const device = api.ingestAccessory('homebridge-dummy', acc);
  assert.equal(device.id, 'homebridge:homebridge-dummy:uuid-bedroom-1234');
  assert.equal(device.name, 'Bedroom Light');
  assert.equal(device.category, 'lighting');
  assert.equal(device.endpoints.length, 1);
  const endpoint = device.endpoints[0];
  assert.ok(endpoint);

  // Initial readings
  assert.equal(endpoint.readings.on_off?.value, false);

  // Trigger state change in HAP characteristic
  lightService.getCharacteristic('On').setValue(true);
  assert.equal(stateChanges.length, 1);
  assert.equal(stateChanges[0]?.readings.on_off?.value, true);

  // Execute command from Haus -> updates HAP characteristic
  const handled = api.executeCommand(device.id, endpoint.id, 'brightness', 75);
  assert.equal(handled, true);
  assert.equal(lightService.getCharacteristic('Brightness').getValue(), 75);
});

test('HomebridgeLogInterceptor captures setup PINs and setup URIs to emit pairing cards', () => {
  const interceptor = new HomebridgeLogInterceptor('homebridge-camera-ffmpeg');
  const capturedCards: HomebridgePairingCard[] = [];
  interceptor.on('pairingCard', (card: HomebridgePairingCard) => capturedCards.push(card));

  interceptor.processLine('┌────────────┐');
  interceptor.processLine('│ 031-45-154 │');
  interceptor.processLine('└────────────┘');

  assert.equal(capturedCards.length, 1);
  assert.equal(capturedCards[0]?.pluginName, 'homebridge-camera-ffmpeg');
  assert.equal(capturedCards[0]?.pin, '031-45-154');

  interceptor.processLine('Setup Payload: [X-HM://0023ISYWYABCD]');
  assert.equal(capturedCards.length, 2);
  assert.equal(capturedCards[1]?.setupUri, 'X-HM://0023ISYWYABCD');
});

test('HomebridgeChildBridge runs in isolated child process and captures pairing card from stdout', async () => {
  const bridge = new HomebridgeChildBridge({
    pluginName: 'homebridge-sample',
    config: { name: 'Sample' },
    memoryMb: 64,
  });

  const cards: HomebridgePairingCard[] = [];
  bridge.on('pairingCard', (card: HomebridgePairingCard) => cards.push(card));

  try {
    await bridge.start();

    // Wait for the simulated pairing card output
    const completeCard = await new Promise<HomebridgePairingCard>((resolve) => {
      const check = setInterval(() => {
        const found = cards.find((c) => c.pin === '031-45-154' && Boolean(c.setupUri));
        if (found) {
          clearInterval(check);
          resolve(found);
        }
      }, 50);
    });

    assert.equal(completeCard.pluginName, 'homebridge-sample');
    assert.equal(completeCard.pin, '031-45-154');
    assert.ok(completeCard.setupUri?.startsWith('X-HM://'));
  } finally {
    await bridge.stop();
  }
});
