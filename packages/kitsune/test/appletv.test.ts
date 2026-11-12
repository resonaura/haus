/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MockAccessory, HAPServices, RemoteKey, VolumeSelector } from '../src/homebridge/hap.js';
import { HomebridgeVirtualApi } from '../src/homebridge/api.js';

test('Apple TV Enhanced: Projects Television, Speaker, and InputSources to unified media HausDevice', () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Bedroom Apple TV', '02:AF:ED:7A:CF:59');

  // 1. Television primary service
  const tvService = acc.addService(new HAPServices.Television('Bedroom Apple TV'));
  tvService.getCharacteristic('Active').setValue(0);
  tvService.getCharacteristic('ActiveIdentifier').setValue(1);
  tvService.getCharacteristic('ConfiguredName').setValue('Bedroom Apple TV');

  // 2. Linked TelevisionSpeaker
  const speakerService = acc.addService(
    new HAPServices.TelevisionSpeaker('Bedroom Apple TV Speaker'),
  );
  speakerService.getCharacteristic('Volume').setValue(45);
  speakerService.getCharacteristic('Mute').setValue(false);
  tvService.addLinkedService(speakerService);

  // 3. InputSource services (household streaming apps)
  const appNames = ['YouTube', 'Netflix', 'Prime Video', 'Music', 'TV'];
  for (let i = 0; i < appNames.length; i++) {
    const is = acc.addService(new HAPServices.InputSource(appNames[i], `input-${i + 1}`));
    is.getCharacteristic('ConfiguredName').setValue(appNames[i]);
    is.getCharacteristic('Identifier').setValue(i + 1);
    tvService.addLinkedService(is);
  }

  const device = api.ingestAccessory('homebridge-appletv-enhanced', acc);

  // Validate unified projection
  assert.equal(device.name, 'Bedroom Apple TV');
  assert.equal(device.category, 'media');
  assert.equal(device.endpoints.length, 1);

  const ep = device.endpoints[0];
  assert.ok(ep);
  assert.equal(ep.name, 'Bedroom Apple TV');

  const capKinds = ep.capabilities.map((c) => c.id);
  assert.ok(capKinds.includes('on_off'));
  assert.ok(capKinds.includes('remote_key'));
  assert.ok(capKinds.includes('media_playback'));
  assert.ok(capKinds.includes('source'));
  assert.ok(capKinds.includes('volume'));
  assert.ok(capKinds.includes('mute'));

  // Validate readings
  assert.equal(ep.readings.on_off?.value, false);
  assert.equal(ep.readings.volume?.value, 45);
  assert.equal(ep.readings.mute?.value, false);
  assert.equal(ep.readings.source?.value, 'YouTube');
  assert.equal(ep.readings.active_identifier?.value, 1);
  assert.deepEqual(ep.readings.source_list?.value, [
    'YouTube',
    'Netflix',
    'Prime Video',
    'Music',
    'TV',
  ]);
});

test('Apple TV Enhanced: Bidirectional Power On/Off via Active characteristic', async () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Bedroom Apple TV', '02:AF:ED:7A:CF:59');
  const tvService = acc.addService(new HAPServices.Television('Bedroom Apple TV'));
  tvService.getCharacteristic('Active').setValue(0);

  let activeValue = 0;
  tvService.getCharacteristic('Active').onSet((val) => {
    activeValue = Number(val);
  });

  const device = api.ingestAccessory('homebridge-appletv-enhanced', acc);
  const ep = device.endpoints[0]!;

  // Turn ON
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'on_off',
    value: true,
  });
  assert.equal(activeValue, 1);
  assert.equal(tvService.getCharacteristic('Active').getValue(), 1);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.on_off?.value, true);

  // Turn OFF
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'on_off',
    value: false,
  });
  assert.equal(activeValue, 0);
  assert.equal(tvService.getCharacteristic('Active').getValue(), 0);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.on_off?.value, false);
});

test('Apple TV Enhanced: Remote Key Dispatch maps strings to HAP RemoteKey codes', async () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Bedroom Apple TV', '02:AF:ED:7A:CF:59');
  const tvService = acc.addService(new HAPServices.Television('Bedroom Apple TV'));

  const receivedKeys: number[] = [];
  tvService.getCharacteristic('RemoteKey').onSet((val) => {
    receivedKeys.push(Number(val));
  });

  const device = api.ingestAccessory('homebridge-appletv-enhanced', acc);
  const ep = device.endpoints[0]!;

  const keySequence = [
    { key: 'select', expected: RemoteKey.SELECT },
    { key: 'menu', expected: RemoteKey.BACK },
    { key: 'back', expected: RemoteKey.BACK },
    { key: 'home', expected: RemoteKey.EXIT },
    { key: 'up', expected: RemoteKey.ARROW_UP },
    { key: 'down', expected: RemoteKey.ARROW_DOWN },
    { key: 'left', expected: RemoteKey.ARROW_LEFT },
    { key: 'right', expected: RemoteKey.ARROW_RIGHT },
    { key: 'play_pause', expected: RemoteKey.PLAY_PAUSE },
    { key: 'rewind', expected: RemoteKey.REWIND },
    { key: 'fast_forward', expected: RemoteKey.FAST_FORWARD },
  ];

  for (const item of keySequence) {
    await api.executeCommand({
      deviceId: device.id,
      endpointId: ep.id,
      capability: 'remote_key',
      value: item.key,
    });
  }

  assert.deepEqual(
    receivedKeys,
    keySequence.map((k) => k.expected),
  );
});

test('Apple TV Enhanced: Input source selection by app name and numeric identifier', async () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Bedroom Apple TV', '02:AF:ED:7A:CF:59');
  const tvService = acc.addService(new HAPServices.Television('Bedroom Apple TV'));
  tvService.getCharacteristic('ActiveIdentifier').setValue(1);

  let activeId = 1;
  tvService.getCharacteristic('ActiveIdentifier').onSet((val) => {
    activeId = Number(val);
  });

  const is1 = acc.addService(new HAPServices.InputSource('YouTube', 'sub-1'));
  is1.getCharacteristic('ConfiguredName').setValue('YouTube');
  is1.getCharacteristic('Identifier').setValue(1);

  const is2 = acc.addService(new HAPServices.InputSource('Netflix', 'sub-2'));
  is2.getCharacteristic('ConfiguredName').setValue('Netflix');
  is2.getCharacteristic('Identifier').setValue(2);

  const is3 = acc.addService(new HAPServices.InputSource('Prime Video', 'sub-3'));
  is3.getCharacteristic('ConfiguredName').setValue('Prime Video');
  is3.getCharacteristic('Identifier').setValue(3);

  const device = api.ingestAccessory('homebridge-appletv-enhanced', acc);
  const ep = device.endpoints[0]!;

  // Select source by name: "Netflix" -> identifier 2
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'source',
    value: 'Netflix',
  });
  assert.equal(activeId, 2);
  assert.equal(tvService.getCharacteristic('ActiveIdentifier').getValue(), 2);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.source?.value, 'Netflix');
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.active_identifier?.value, 2);

  // Select source by name: "Prime Video" -> identifier 3
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'source',
    value: 'Prime Video',
  });
  assert.equal(activeId, 3);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.source?.value, 'Prime Video');

  // Select source by numeric id: 1 -> "YouTube"
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'source',
    value: 1,
  });
  assert.equal(activeId, 1);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.source?.value, 'YouTube');
});

test('Apple TV Enhanced: Volume and Mute actuation on TelevisionSpeaker', async () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Bedroom Apple TV', '02:AF:ED:7A:CF:59');
  acc.addService(new HAPServices.Television('Bedroom Apple TV'));

  const speaker = acc.addService(new HAPServices.TelevisionSpeaker('Apple TV Speaker'));
  speaker.getCharacteristic('Volume').setValue(30);
  speaker.getCharacteristic('Mute').setValue(false);

  let currentVolume = 30;
  let currentMute = false;
  const volumeSteps: number[] = [];

  speaker.getCharacteristic('Volume').onSet((val) => {
    currentVolume = Number(val);
  });
  speaker.getCharacteristic('Mute').onSet((val) => {
    currentMute = Boolean(val);
  });
  speaker.getCharacteristic('VolumeSelector').onSet((val) => {
    volumeSteps.push(Number(val));
  });

  const device = api.ingestAccessory('homebridge-appletv-enhanced', acc);
  const ep = device.endpoints[0]!;

  // 1. Set explicit volume level
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'volume',
    value: 65,
  });
  assert.equal(currentVolume, 65);
  assert.equal(speaker.getCharacteristic('Volume').getValue(), 65);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.volume?.value, 65);

  // 2. Volume increment (volume_up)
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'volume',
    value: 'volume_up',
  });
  assert.equal(volumeSteps[0], VolumeSelector.INCREMENT);

  // 3. Volume decrement (volume_down)
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'volume',
    value: 'volume_down',
  });
  assert.equal(volumeSteps[1], VolumeSelector.DECREMENT);

  // 4. Mute actuation
  await api.executeCommand({
    deviceId: device.id,
    endpointId: ep.id,
    capability: 'mute',
    value: true,
  });
  assert.equal(currentMute, true);
  assert.equal(speaker.getCharacteristic('Mute').getValue(), true);
  assert.equal(api.getDevice(device.id)?.endpoints[0]?.readings.mute?.value, true);
});

test('Apple TV Enhanced: Diagnostics and safety boundaries reject unsupported capabilities', async () => {
  const api = new HomebridgeVirtualApi();
  const acc = new MockAccessory('Bedroom Apple TV', '02:AF:ED:7A:CF:59');
  acc.addService(new HAPServices.Television('Bedroom Apple TV'));

  const device = api.ingestAccessory('homebridge-appletv-enhanced', acc);
  const ep = device.endpoints[0]!;

  // Unsupported capability rejection
  await assert.rejects(async () => {
    await api.executeCommand({
      deviceId: device.id,
      endpointId: ep.id,
      capability: 'siren',
      value: true,
    });
  }, /kitsune_unsupported_capability:siren/);

  const unsupportedRecords = api.getUnsupportedCapabilities();
  assert.ok(
    unsupportedRecords.some(
      (r) => r.capability === 'siren' && r.reason === 'unsupported_hap_capability_command',
    ),
  );
});
