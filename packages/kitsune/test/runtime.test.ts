/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { c as tarCreate } from 'tar';
import { onTestFinished, test } from 'vitest';
import { MediaRuntime } from '@haus/media/pipeline';
import {
  createSdk,
  FileStorage,
  PluginInstaller,
  PluginProcess,
  compatibilityGuard,
  selectStreams,
  onboardingSettings,
  vendorCatalog,
  vendorRoute,
  type DeviceRecord,
  type Diagnostic,
  type HostAdapters,
  type KitsuneEvent,
  type StorageBackend,
} from '../dist/index.js';
import { cameraPresentation } from '../dist/haus.js';
import { archivePath, tarFiles, writeArchive, zipFiles } from '../dist/runtime/archives.js';
import type { RuntimeOptions } from '../dist/runtime/host.js';
import { verifyIntegrity } from '../dist/runtime/registry.js';
import {
  bridgeAddon,
  operatingRole,
  requiresProtectedStream,
} from '../dist/vendors/native/index.js';

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'haus-kitsune-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function host(
  storage: StorageBackend,
  events: KitsuneEvent[] = [],
  diagnostics: Diagnostic[] = [],
): HostAdapters {
  return {
    storage,
    emit: (event) => events.push(event),
    diagnostic: (event) => diagnostics.push(event),
    ffmpegPath: 'ffmpeg',
    endpointBase: 'http://127.0.0.1:8099/kitsune',
  };
}

type ChainableFallback = ((...args: unknown[]) => ChainableFallback) & {
  [key: string]: ChainableFallback;
};

test('unknown SDK calls are chainable, await safely and log no arguments', async () => {
  const diagnostics: Diagnostic[] = [];
  const guard = compatibilityGuard('fixture', (event) => diagnostics.push(event));
  const manager = guard<Record<string, ChainableFallback>>({}, 'mediaManager');
  const futureCall = manager.future;
  assert.ok(futureCall);
  const another = futureCall('password-secret').another;
  assert.ok(another?.path);
  assert.equal(await Promise.resolve<unknown>(another.path('token-secret')), undefined);
  assert.equal(await Promise.resolve(manager), manager);
  assert.ok(diagnostics.some((event) => event.target === 'mediaManager.future'));
  assert.ok(!JSON.stringify(diagnostics).includes('secret'));
});

test('scoped storage and reactive state survive SDK recreation without cross-plugin leakage', async () => {
  const directory = await temporary();
  const backend = new FileStorage(directory);
  const events: KitsuneEvent[] = [];
  const first = createSdk('camera-plugin', host(backend, events));
  const camera = new first.sdk.ScryptedDeviceBase('camera-one') as InstanceType<
    typeof first.sdk.ScryptedDeviceBase
  > & { motionDetected?: boolean };
  await first.sdk.deviceManager.onDeviceDiscovered({
    nativeId: 'camera-one',
    name: 'Front',
    interfaces: ['Camera', 'MotionSensor'],
  });
  camera.storage.setItem('auth-token', 'private-fixture');
  camera.motionDetected = true;
  assert.equal(events.at(-1)?.type, 'kitsune:device:state');
  assert.equal(events.at(-1)?.value, true);
  const second = createSdk('camera-plugin', host(backend));
  const restored = new second.sdk.ScryptedDeviceBase('camera-one');
  assert.equal(restored.id, camera.id);
  assert.equal(restored.storage.getItem('auth-token'), 'private-fixture');
  assert.equal(
    new (createSdk('another-plugin', host(backend)).sdk.ScryptedDeviceBase)(
      'camera-one',
    ).storage.getItem('auth-token'),
    null,
  );
  for (const file of await readdir(directory)) {
    assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  }
  first.stop();
  second.stop();
});

test('media/endpoint managers preserve structured source arguments and explicit capabilities', async () => {
  const sdk = createSdk('fixture', host(new FileStorage(await temporary()))).sdk;
  const media = await sdk.mediaManager.createFFmpegMediaObject({
    inputArguments: ['-rtsp_transport', 'tcp', '-i', 'rtsp://192.168.1.2/main'],
  });
  const parsedMedia = JSON.parse(
    (await sdk.mediaManager.convertMediaObjectToBuffer(media, media.mimeType)).toString(),
  ) as { inputArguments: string[] };
  assert.equal(parsedMedia.inputArguments[2], '-i');
  assert.match(await sdk.endpointManager.getLocalEndpoint('camera/one'), /camera%2Fone\/$/);
  await assert.rejects(sdk.endpointManager.getPublicPushEndpoint(), /public_endpoint_unavailable/);
  await assert.rejects(
    sdk.mediaManager.convertMediaObjectToUrl(media, 'image/jpeg'),
    /conversion_unavailable/,
  );
});

test('vendor routing preserves P2P and selects measured HD/main and preview streams', () => {
  assert.deepEqual(vendorRoute('tuya'), { driver: 'native' });
  const dahuaRoute = vendorRoute('dahua');
  assert.equal(dahuaRoute.driver === 'npm' ? dahuaRoute.package : undefined, '@scrypted/amcrest');
  assert.equal(bridgeAddon('abc_aqara-g5pro-mqtt')?.port, 8580);
  assert.equal(
    operatingRole({
      entity_id: 'switch.led',
      platform: 'eufy_security',
      unique_id: 'serial_device_statusLed',
    }),
    'indicator',
  );
  assert.equal(
    requiresProtectedStream(
      { id: 'camera.front', playbackSource: { manufacturer: 'Aqara' } },
      [],
      [],
    ),
    true,
  );
  const streams = selectStreams([
    { id: 'sub', video: { width: 640, height: 360 } },
    { id: 'main', video: { width: 3840, height: 2160 } },
  ]);
  assert.equal(streams.recording?.id, 'main');
  assert.equal(streams.preview?.id, 'sub');
  const rtspPreset = vendorCatalog.find((preset) => preset.id === 'rtsp');
  assert.ok(rtspPreset);
  assert.throws(
    () => onboardingSettings(rtspPreset, { url: 'rtsp://192.168.1.2/main' }, []),
    /requires_review/,
  );
});

test('HA-created camera IDs map back to the exact plugin source without room/name guessing', () => {
  const result = cameraPresentation('camera.kitsune_fixture', {
    states: [
      {
        entity_id: 'camera.front_door',
        attributes: { haus_source_camera: 'camera.kitsune_fixture', haus_native_camera: 1 },
      },
      {
        entity_id: 'camera.unrelated',
        attributes: { haus_source_camera: 'camera.other', haus_native_camera: 1 },
      },
    ],
    entities: [{ entity_id: 'camera.front_door', device_id: 'physical' }],
    devices: [{ id: 'physical', area_id: 'entrance' }],
  });
  assert.deepEqual(result, {
    aliases: ['camera.front_door'],
    deviceIds: ['physical'],
    deviceId: 'physical',
    areaId: 'entrance',
  });
});

test('onboarding respects real multiple settings and rejects readonly or nontext fields', () => {
  const preset = vendorCatalog.find((item) => item.id === 'rtsp');
  assert.ok(preset);
  const input = { url: 'rtsp://192.168.1.2/main' };
  assert.deepEqual(onboardingSettings(preset, input, [{ key: 'rtspUrls', multiple: true }]), [
    { key: 'rtspUrls', value: [input.url] },
  ]);
  for (const setting of [
    { key: 'url', readonly: true },
    { key: 'url', type: 'number' },
  ]) {
    assert.throws(() => onboardingSettings(preset, input, [setting]), /requires_review/);
  }
});

test('archives cannot vendor a forbidden SDK or server runtime dependency', async () => {
  const directory = await temporary();
  for (const name of ['sdk', 'server']) {
    await assert.rejects(
      writeArchive(
        directory,
        new Map([[`package/node_modules/@scrypted/${name}/index.js`, Buffer.from('unused')]]),
        'package/',
      ),
      /forbidden_package/,
    );
  }
  assert.deepEqual(await readdir(directory), []);
});

test('archives and integrity reject traversal, oversized zip and changed packages', () => {
  for (const name of ['../escape', '/absolute', 'C:/windows', 'dir/../../escape', 'x\\y']) {
    assert.throws(() => archivePath(name), /unsafe_archive/);
  }
  assert.throws(
    () => zipFiles(Buffer.from(zipSync({ '../escape': strToU8('bad') }))),
    /unsafe_archive/,
  );
  assert.throws(
    () => verifyIntegrity(Buffer.from('changed'), 'sha512-' + Buffer.alloc(64).toString('base64')),
    /integrity_mismatch/,
  );
});

test('tar installation rejects links without touching targets outside the install directory', async () => {
  const directory = await temporary();
  const archive = join(directory, 'linked.tgz');
  await writeFile(join(directory, 'private.txt'), 'keep');
  await symlink(join(directory, 'private.txt'), join(directory, 'link'));
  await tarCreate({ cwd: directory, gzip: true, file: archive }, ['link']);
  await assert.rejects(tarFiles(await readFile(archive)), /unsupported_archive_entry/);
  assert.equal(await readFile(join(directory, 'private.txt'), 'utf8'), 'keep');
});

test('runtime-only zipped CommonJS plugin installs without SDK and completes device/media/webhook lifecycle', async () => {
  const directory = await temporary();
  const artifact = join(directory, 'artifact');
  await mkdir(join(artifact, 'package'), { recursive: true });
  // Independently authored fixture exercises public interoperability, not copied plugin code.
  const source = `const sdk = require('@scrypted/sdk').default;
class Camera extends sdk.ScryptedDeviceBase {
 constructor() { super('front'); this.online = true; this.motionDetected = true; this.storage.setItem('credential', this.storage.getItem('credential') || 'persistent-fixture'); }
 async getVideoStreamOptions() { return [{ id: 'main', video: { width: 1920, height: 1080 } }, { id: 'sub', video: { width: 640, height: 360 } }]; }
 async getVideoStream() { return sdk.mediaManager.createFFmpegMediaObject({ inputArguments: ['-i', 'rtsp://192.168.1.2/main'] }); }
 async getSettings() { return [{ key: 'credential', value: this.storage.getItem('credential') }]; }
}
class Plugin extends sdk.ScryptedDeviceBase {
 constructor() { super(); this.camera = new Camera(); sdk.deviceManager.onDeviceDiscovered({ nativeId: 'front', name: 'Fixture Camera', type: sdk.ScryptedDeviceType.Camera, interfaces: ['Camera', 'VideoCamera', 'MotionSensor'] }); }
 getDevice() { return this.camera; }
 async getCreateDeviceSettings() { await sdk.systemManager.futureOptionalMethod('not-logged').chain(); return [{ key: 'username' }]; }
 async getSettings() { return [{ key: 'ffmpeg', value: await sdk.mediaManager.getFFmpegPath() }]; }
 onRequest(request, response) { response.send('accepted', { code: 202, headers: { 'content-type': 'text/plain' } }); }
}
module.exports.default = new Plugin();`;
  await writeFile(
    join(artifact, 'package', 'plugin.zip'),
    zipSync({ 'main.nodejs.js': strToU8(source) }),
  );
  const manifest = {
    name: '@fixture/camera',
    version: '1.0.0',
    dependencies: { '@scrypted/sdk': 'file:../../sdk' },
    scrypted: { pluginDependencies: [] },
  };
  await writeFile(join(artifact, 'package', 'package.json'), JSON.stringify(manifest));
  const archiveFile = join(directory, 'package.tgz');
  await tarCreate({ cwd: artifact, gzip: true, file: archiveFile }, ['package']);
  const bytes = await readFile(archiveFile);
  const metadata = {
    ...manifest,
    license: 'GPL-3.0-only',
    dist: {
      tarball: 'https://registry.npmjs.org/@fixture/camera/-/camera-1.0.0.tgz',
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    },
  };
  const requests: string[] = [];
  const fetchRequest: typeof fetch = async (url) => {
    const target = String(url);
    requests.push(target);
    return new Response(
      target.endsWith('.tgz')
        ? new Uint8Array(bytes)
        : JSON.stringify({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': metadata } }),
      { status: 200 },
    );
  };
  const installed = await new PluginInstaller(directory, fetchRequest).install('@fixture/camera');
  const offline = await new PluginInstaller(directory, async () => {
    throw Error('network must not be needed');
  }).install('@fixture/camera', '1.0.0');
  assert.equal(offline.directory, installed.directory);
  assert.ok(installed.directory.startsWith(join(directory, 'kitsune', 'plugins')));
  assert.ok(requests.every((url) => !url.includes('scrypted')));
  const events: KitsuneEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const options: RuntimeOptions = {
    dataDirectory: directory,
    endpointBase: 'http://127.0.0.1:8099/kitsune',
    mediaRuntime: new MediaRuntime({ tools: { ffmpeg: '/opt/haus/media/ffmpeg' } }),
    emit: (event) => events.push(event),
    diagnostic: (event) => diagnostics.push(event),
  };
  const runtime = new PluginProcess(installed, options);
  onTestFinished(() => runtime.stop());
  await runtime.start();
  const createSettings = await runtime.call<Array<{ key: string }>>('getCreateDeviceSettings');
  assert.equal(createSettings[0]?.key, 'username');
  const records = await runtime.call<DeviceRecord[]>('records');
  const record = records.find((item) => item.nativeId === 'front');
  assert.ok(record);
  const rootSettings = await runtime.call<Array<{ value: string }>>('getSettings');
  assert.equal(rootSettings[0]?.value, '/opt/haus/media/ffmpeg');
  const streamSelection = await runtime.call<{ recording?: { id?: string } }>(
    'streams',
    [],
    record.id,
  );
  assert.equal(streamSelection.recording?.id, 'main');
  const media = await runtime.call<{ data: Uint8Array }>('video', [{}], record.id);
  const parsedInput = JSON.parse(Buffer.from(media.data).toString()) as {
    inputArguments: string[];
  };
  assert.equal(parsedInput.inputArguments[1], 'rtsp://192.168.1.2/main');
  const response = await runtime.call<{ code: number }>('webhook', [
    undefined,
    { method: 'POST', url: '/event', headers: {} },
  ]);
  assert.equal(response.code, 202);
  assert.ok(events.some((event) => event.type === 'kitsune:device:discovered'));
  assert.ok(events.some((event) => event.property === 'motionDetected'));
  assert.ok(diagnostics.some((event) => event.event === 'unimplemented_sdk_call'));
  await assert.rejects(runtime.call('turnOn', [], record.id), /call_failed/);
  await runtime.stop();
  const restarted = new PluginProcess(installed, options);
  onTestFinished(() => restarted.stop());
  await restarted.start();
  const restartedSettings = await restarted.call<Array<{ value: string }>>(
    'getSettings',
    [],
    record.id,
  );
  assert.equal(restartedSettings[0]?.value, 'persistent-fixture');
  await restarted.stop();
});
