/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicIidManager,
  InMemoryIidStore,
  encodeHomeKitSetupUri,
  decodeHomeKitSetupUri,
  normalizeHomeKitPin,
  calculateTxtRecordByteLength,
  guardHomeKitTxtRecord,
  computeTopologyHash,
  HAPBridge,
  HAPClient,
  HAPStandalone,
  HAPassThrough,
  HomeKitCategory,
} from '../dist/index.js';

test('DeterministicIidManager allocates stable monotonic IIDs across restarts', async () => {
  const store = new InMemoryIidStore();
  const manager = new DeterministicIidManager(store);

  const iid1 = await manager.allocateIid('acc-1', 'service:light');
  const iid2 = await manager.allocateIid('acc-1', 'char:on');
  const iid3 = await manager.allocateIid('acc-1', 'char:brightness');

  assert.equal(iid1, 1);
  assert.equal(iid2, 2);
  assert.equal(iid3, 3);

  // Re-allocating the same item returns the identical IID
  const reIid2 = await manager.allocateIid('acc-1', 'char:on');
  assert.equal(reIid2, 2);

  // Independent accessory starts fresh
  const acc2Iid1 = await manager.allocateIid('acc-2', 'service:switch');
  assert.equal(acc2Iid1, 1);
});

test('HomeKit setup URI encoding and decoding roundtrip', () => {
  assert.equal(normalizeHomeKitPin('12345678'), '123-45-678');
  assert.equal(normalizeHomeKitPin('123-45-678'), '123-45-678');
  assert.equal(normalizeHomeKitPin('invalid'), null);

  const original = {
    pin: '031-45-154',
    setupId: 'HAUS',
    category: HomeKitCategory.BRIDGE,
  };

  const uri = encodeHomeKitSetupUri(original);
  assert.ok(uri.startsWith('X-HM://'));
  assert.ok(uri.endsWith('HAUS'));

  const decoded = decodeHomeKitSetupUri(uri);
  assert.equal(decoded.pin, original.pin);
  assert.equal(decoded.setupId, original.setupId);
  assert.equal(decoded.category, original.category);
});

test('mDNS TXT record size guard enforces 380-byte hard cap and topology hashing', () => {
  const normalRecord = {
    md: 'Haus Hub Bridge',
    pv: '1.1',
    id: '00:11:22:33:44:55',
    'c#': 1,
    's#': 1,
    sf: 1,
    ff: 0,
    ci: HomeKitCategory.BRIDGE,
  };

  const len = calculateTxtRecordByteLength(normalRecord);
  assert.ok(len < 380);
  const guardedNormal = guardHomeKitTxtRecord(normalRecord);
  assert.equal(guardedNormal.md, 'Haus Hub Bridge');

  // Excessively long model name that would violate the 380-byte limit
  const hugeMd = 'A'.repeat(400);
  const bloatedRecord = {
    ...normalRecord,
    md: hugeMd,
  };

  assert.ok(calculateTxtRecordByteLength(bloatedRecord) > 380);
  const guardedBloated = guardHomeKitTxtRecord(bloatedRecord);
  const guardedLen = calculateTxtRecordByteLength(guardedBloated);
  assert.ok(guardedLen <= 380);
  assert.ok(guardedBloated.md.includes('~'));

  // Topology hashing
  const topo1 = [
    { id: 'light-1', services: [{ type: 'Lightbulb', characteristics: ['On', 'Brightness'] }] },
  ];
  const topo2 = [
    { id: 'light-1', services: [{ type: 'Lightbulb', characteristics: ['On', 'Brightness'] }] },
  ];
  const topo3 = [
    {
      id: 'light-1',
      services: [{ type: 'Lightbulb', characteristics: ['On', 'Brightness', 'ColorTemp'] }],
    },
  ];

  assert.equal(computeTopologyHash(topo1), computeTopologyHash(topo2));
  assert.notEqual(computeTopologyHash(topo1), computeTopologyHash(topo3));
});

test('HAPBridge manages multi-accessory bridging and command dispatch', async () => {
  const dispatched = [];
  const bridge = new HAPBridge(
    {
      name: 'Haus Main',
      pin: '123-45-678',
      setupId: 'HAU1',
      username: 'AA:BB:CC:DD:EE:01',
    },
    {
      onCommand: async (cmd) => {
        dispatched.push(cmd);
        return true;
      },
    },
  );

  assert.ok(bridge.setupUri.startsWith('X-HM://'));
  const txt = bridge.getTxtRecord();
  assert.equal(txt.ci, HomeKitCategory.BRIDGE);

  const lightDevice = {
    id: 'light-living-room',
    source: { instanceId: 'zigbee', externalId: '0x123' },
    name: 'Living Room Ceiling',
    category: 'lighting',
    connectivity: { protocol: 'zigbee' },
    availability: 'online',
    endpoints: [],
  };

  const summary = await bridge.addDevice(lightDevice);
  assert.equal(summary.category, HomeKitCategory.LIGHTBULB);
  assert.equal(summary.serviceType, 'Lightbulb');
  assert.equal(bridge.getBridgedDevices().length, 1);

  // Characteristic write dispatch
  const success = await bridge.handleCharacteristicWrite(
    'light-living-room',
    'ep-1',
    'on_off',
    true,
  );
  assert.equal(success, true);
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    deviceId: 'light-living-room',
    endpointId: 'ep-1',
    capability: 'on_off',
    value: true,
  });

  assert.equal(bridge.removeDevice('light-living-room'), true);
  assert.equal(bridge.getBridgedDevices().length, 0);
});

test('HAPClient pairs accessories and decomposes batch characteristic updates', async () => {
  const client = new HAPClient();

  client.registerDiscovered({
    id: '11:22:33:44:55:66',
    name: 'Eve Energy Plug',
    address: '192.168.1.180',
    port: 51827,
    category: HomeKitCategory.OUTLET,
    paired: false,
    configNumber: 1,
  });

  assert.equal(client.getDiscovered().length, 1);

  const device = await client.pairAccessory('11:22:33:44:55:66', { pin: '456-78-901' });
  assert.ok(device);
  assert.equal(device.name, 'Eve Energy Plug');
  assert.equal(device.connectivity.protocol, 'homekit');
  assert.equal(client.getPairedDevices().length, 1);

  // Batch update decomposition with partial failure
  const batchResponse = await client.executeBatchUpdate(
    {
      characteristics: [
        { aid: 1, iid: 10, value: true },
        { aid: 1, iid: 11, value: 50 },
      ],
    },
    async (aid, iid) => {
      // simulate iid 11 failing, iid 10 succeeding
      return iid === 10;
    },
  );

  assert.deepEqual(batchResponse.characteristics, [
    { aid: 1, iid: 10, status: 0 },
    { aid: 1, iid: 11, status: -70402 },
  ]);

  assert.equal(client.unpairAccessory('11:22:33:44:55:66'), true);
  assert.equal(client.getPairedDevices().length, 0);
});

test('HAPStandalone registers dedicated accessories and generates setup URIs', () => {
  const standalone = new HAPStandalone();

  const uri = standalone.register({
    id: 'cam-front-door',
    name: 'Front Door Camera',
    category: HomeKitCategory.IP_CAMERA,
    pin: '234-56-789',
    setupId: 'CAM1',
    username: 'CC:DD:EE:FF:00:11',
  });

  assert.ok(uri.startsWith('X-HM://'));
  assert.equal(standalone.getSetupUri('cam-front-door'), uri);

  const txt = standalone.getTxtRecord('cam-front-door');
  assert.ok(txt);
  assert.equal(txt.ci, HomeKitCategory.IP_CAMERA);
  assert.equal(txt.md, 'Front Door Camera');

  assert.equal(standalone.isRunning('cam-front-door'), false);
  standalone.start('cam-front-door');
  assert.equal(standalone.isRunning('cam-front-door'), true);
  standalone.stop('cam-front-door');
  assert.equal(standalone.isRunning('cam-front-door'), false);
});

test('HAPassThrough manages proxy sessions and intercepts characteristic updates', () => {
  const passthrough = new HAPassThrough();
  const intercepted = [];

  const cleanup = passthrough.onCharacteristicUpdate((update) => {
    intercepted.push(update);
  });

  const session = passthrough.openSession('sess-100', 'acc-switch-1', '192.168.1.150');
  assert.equal(session.state, 'handshake');

  assert.equal(passthrough.activateSession('sess-100'), true);
  assert.equal(passthrough.getSession('sess-100')?.state, 'active');

  // Intercept write payload
  passthrough.interceptWritePayload('sess-100', {
    characteristics: [{ aid: 1, iid: 12, value: true }],
  });

  assert.equal(intercepted.length, 1);
  assert.deepEqual(intercepted[0], { aid: 1, iid: 12, value: true });

  cleanup();
  assert.equal(passthrough.closeSession('sess-100'), true);
  assert.equal(passthrough.getSession('sess-100'), undefined);
});
