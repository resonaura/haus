/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeKitCameras, homekitSettings, recordingProfile } from '../lib/homekit.mjs';

test('each opted-in camera has its own stable HAP identity and canonical motion; privacy cancels older media', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-hap-')),
    db = new DatabaseSync(':memory:');
  const cameras = [
    { id: 'camera.outside', name: 'Outside', available: true },
    { id: 'camera.inside', name: 'Inside', available: true },
  ];
  const settings = { 'camera.outside': { homekit: { enabled: true, processor: 'auto' } } };
  let active = false;
  const homekit = await new HomeKitCameras({
    config: { data: root },
    store: { db, overrides: () => settings },
    registry: () => ({ cameras }),
    cluster: { nodes: () => [] },
    sessions: {},
    activity: { status: () => ({ available: true, active }) },
    talkback: { available: async () => true },
  }).initialize();
  t.after(async () => {
    await homekit.stop();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const entry = await homekit.create(cameras[0]);
  const identity = homekit.identity(cameras[0].id);
  assert.deepEqual(homekit.identity(cameras[0].id), identity);
  assert.notEqual(homekit.identity(cameras[1].id).username, identity.username);
  assert.equal(homekit.status(cameras[1].id).enabled, false);
  assert.match(identity.pincode, /^\d{3}-\d{2}-\d{3}$/);
  active = true;
  await homekit.tick();
  assert.equal(
    entry.motion.getCharacteristic(homekit.hap.Characteristic.MotionDetected).value,
    true,
  );
  assert.equal(
    entry.accessory.services.filter(
      (service) => service.UUID === homekit.hap.Service.MotionSensor.UUID,
    ).length,
    1,
  );
  const commands = [];
  entry.updating = true;
  entry.recordRoute = {
    context: { owner: entry.owner },
    local: { command: async (value) => commands.push(value) },
  };
  const controller = new AbortController();
  entry.recordStreams.set(1, controller);
  entry.controller.recordingManagement.recordingManagementService
    .getCharacteristic(homekit.hap.Characteristic.RecordingAudioActive)
    .updateValue(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.signal.aborted, true);
  assert.ok(
    commands.some(
      (command) =>
        command.action === 'configure' &&
        command.configuration === null &&
        command.generation === entry.generation,
    ),
  );
  entry.recordStreams.clear();
  entry.recordRoute = undefined;
  entry.updating = false;
});

test('HomeKit policy is explicit and recording audio follows the controller configuration', () => {
  assert.deepEqual(homekitSettings({ enabled: false, processor: 'auto' }), {
    enabled: false,
    processor: 'auto',
  });
  assert.throws(
    () => homekitSettings({ enabled: true, processor: 'http://remote' }),
    /invalid_homekit_settings/,
  );
  const profile = recordingProfile(
    {
      prebufferLength: 8000,
      mediaContainerConfiguration: { fragmentLength: 4000 },
      videoCodec: {
        type: 0,
        resolution: [1280, 720, 30],
        parameters: { bitRate: 1000, profile: 1, level: 2 },
      },
      audioCodec: { type: 0, samplerate: 1, bitrate: 32 },
    },
    false,
  );
  assert.equal(profile.audio, false);
  assert.equal(profile.audioRate, 16000);
  assert.equal(profile.prebufferLength, 8000);
});

test('HomeKit stream reconfiguration closes the old talk receiver before attaching the replacement', async () => {
  const bridge = Object.create(HomeKitCameras.prototype),
    signals = [];
  bridge.cameraActive = () => true;
  bridge.hap = { Service: {}, Characteristic: {} };
  bridge.call = async () => {};
  bridge.release = async () => {};
  bridge.talk = async (_entry, _state, signal) => {
    signals.push(signal);
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  };
  const state = { route: {}, request: { sessionID: 'fixture' }, abort: new AbortController() };
  const entry = {
    accessory: { getService: () => undefined },
    talkAvailable: true,
    live: new Map([['fixture', state]]),
  };
  await bridge.stream(entry, { type: 'start', sessionID: 'fixture', video: { width: 640 } });
  await bridge.stream(entry, { type: 'reconfigure', sessionID: 'fixture', video: { width: 1280 } });
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  await bridge.stopLive(entry, 'fixture');
  assert.equal(signals[1].aborted, true);
});
