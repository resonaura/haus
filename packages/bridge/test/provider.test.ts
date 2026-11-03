/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CameraBridgeProvider } from '../src/provider.js';
import {
  entityKeys,
  inventoryRevision,
  validateInventory,
  validateCommand,
  type BridgeInventory,
} from '../src/protocol.js';
import { discoveredCameraBridge } from '../src/discovery.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function inventory(bridge: CameraBridgeProvider): BridgeInventory {
  return {
    version: 2,
    provider: 'aqara',
    bridgeId: bridge.id,
    cameras: [
      {
        id: 'camera-a',
        name: 'Outdoor',
        manufacturer: 'Aqara',
        model: 'G5 Pro',
        identifiers: ['physical:camera-a'],
        available: true,
        stream: { url: 'rtsp://192.168.1.10:8554/camera-a', transport: 'p2p' },
        snapshotPath: '/api/cameras/camera-a/snapshot/last-live',
        entities: [
          {
            id: 'motion',
            name: 'Motion',
            domain: 'binary_sensor',
            available: true,
            state: false,
            updatedAt: 1000,
          },
          {
            id: 'spotlight',
            name: 'Spotlight',
            domain: 'light',
            available: true,
            state: 'off',
            updatedAt: 1000,
            writable: true,
            brightness: true,
          },
        ],
      },
    ],
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'haus-provider-'));
  roots.push(directory);
  let now = 10000;
  const bridge = await new CameraBridgeProvider({
    directory,
    provider: 'aqara',
    name: 'Aqara bridge',
    now: () => now,
  }).initialize();
  const value = inventory(bridge),
    revision = bridge.updateInventory(value),
    controllerId = randomUUID();
  const { code } = bridge.openPairing(),
    client = await bridge.enroll(code, controllerId);
  return {
    bridge,
    value,
    revision,
    controllerId,
    client,
    directory,
    advance: (ms: number) => {
      now += ms;
      bridge.tick();
    },
  };
}

describe('confirmed native camera ownership', () => {
  it('keeps MQTT until every camera and control is acknowledged, and allows the user to retain it', async () => {
    const { bridge, value, revision, client } = await fixture();
    const transitions: boolean[] = [];
    bridge.on('mqtt-publication', (enabled) => transitions.push(enabled));
    expect(bridge.shouldPublishMqtt()).toBe(true);
    await expect(
      bridge.confirmNativeReady(client.clientId, { revision, entities: ['camera:camera-a'] }),
    ).rejects.toThrow('incomplete_bridge_handover');
    expect(bridge.shouldPublishMqtt()).toBe(true);
    expect(
      (await bridge.confirmNativeReady(client.clientId, { revision, entities: entityKeys(value) }))
        .publishMqtt,
    ).toBe(false);
    bridge.setDisableMqttWithHaus(false);
    expect(bridge.shouldPublishMqtt()).toBe(true);
    bridge.setDisableMqttWithHaus(true);
    expect(bridge.shouldPublishMqtt()).toBe(false);
    expect(transitions).toEqual([false, true, false]);
    await bridge.stop();
  });
  it('retains confirmed ownership through reconnects/restart and restores MQTT only on explicit revocation', async () => {
    const { bridge, value, revision, client, directory, advance } = await fixture();
    await bridge.confirmNativeReady(client.clientId, { revision, entities: entityKeys(value) });
    advance(65000);
    expect(bridge.shouldPublishMqtt()).toBe(false);
    expect(bridge.nativeStatus()).toMatchObject({ confirmed: true, reachable: false });
    expect(() => bridge.renew(client.clientId, revision)).toThrow('bridge_handover_required');
    await bridge.confirmNativeReady(client.clientId, { revision, entities: entityKeys(value) });
    const changed = structuredClone(value);
    changed.cameras[0].entities[1].color = true;
    const next = bridge.updateInventory(changed);
    expect(bridge.shouldPublishMqtt()).toBe(false);
    await expect(
      bridge.confirmNativeReady(client.clientId, { revision, entities: entityKeys(value) }),
    ).rejects.toThrow('incomplete_bridge_handover');
    await bridge.confirmNativeReady(client.clientId, {
      revision: next,
      entities: entityKeys(changed),
    });
    await bridge.stop();
    const restarted = await new CameraBridgeProvider({
      directory,
      provider: 'aqara',
      name: 'Aqara bridge',
    }).initialize();
    restarted.updateInventory(changed);
    expect(restarted.authenticate(`Bearer ${client.token}`)).toBe(client.clientId);
    expect(restarted.shouldPublishMqtt()).toBe(false);
    await restarted.confirmNativeReady(client.clientId, {
      revision: next,
      entities: entityKeys(changed),
    });
    await restarted.revoke(client.clientId);
    expect(restarted.shouldPublishMqtt()).toBe(true);
    expect(restarted.authenticate(`Bearer ${client.token}`)).toBeUndefined();
    await restarted.stop();
  });
  it('fences a second controller and expired enrollment codes, and stores no raw token', async () => {
    const { bridge, value, revision, client, directory, advance } = await fixture();
    const secondCode = bridge.openPairing();
    advance(600000);
    await expect(bridge.enroll(secondCode.code, randomUUID())).rejects.toThrow(
      'invalid_bridge_pairing',
    );
    const fresh = bridge.openPairing(),
      controllerId = randomUUID();
    const second = await bridge.enroll(fresh.code, controllerId);
    await expect(bridge.enroll(fresh.code, controllerId)).rejects.toThrow('invalid_bridge_pairing');
    await bridge.confirmNativeReady(client.clientId, { revision, entities: entityKeys(value) });
    await expect(
      bridge.confirmNativeReady(second.clientId, { revision, entities: entityKeys(value) }),
    ).rejects.toThrow('bridge_already_owned');
    const file = join(directory, 'haus-provider.json'),
      saved = await readFile(file, 'utf8');
    expect(saved).not.toContain(client.token);
    expect(saved).not.toContain(second.token);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(bridge.authenticate(`Basic ${client.token}`)).toBeUndefined();
    expect(() => bridge.readInventory(randomUUID())).toThrow('bridge_access_required');
    await bridge.stop();
  });
  it('does not expose mutable retained inventory or treat changed readings as another handover', async () => {
    const { bridge, value, revision, client } = await fixture();
    await bridge.confirmNativeReady(client.clientId, { revision, entities: entityKeys(value) });
    value.cameras[0].entities[0].state = true;
    value.cameras[0].entities[0].updatedAt = 5000;
    expect(bridge.updateInventory(value)).toBe(revision);
    const read = bridge.readInventory(client.clientId);
    read.cameras[0].entities.length = 0;
    expect(bridge.readInventory(client.clientId).cameras[0].entities).toHaveLength(2);
    expect(bridge.shouldPublishMqtt()).toBe(false);
    await bridge.stop();
  });
});

describe('native provider contract', () => {
  it('keeps indicator, automatic night vision and raw infrared as separate capabilities', async () => {
    const { bridge, value } = await fixture();
    const camera = value.cameras[0];
    camera.entities.push({
      id: 'night',
      name: 'Night vision',
      domain: 'select',
      role: 'nightVision',
      available: true,
      state: 'auto',
      updatedAt: 1,
      writable: true,
      options: ['off', 'auto', 'on'],
      homekit: { enabledValue: 'auto', disabledValue: 'off' },
    });
    expect(validateInventory(value).cameras[0].entities.at(-1)?.homekit).toEqual({
      enabledValue: 'auto',
      disabledValue: 'off',
    });
    camera.entities.at(-1)!.role = 'infrared';
    expect(() => validateInventory(value)).toThrow('invalid_bridge_inventory');
    delete camera.entities.at(-1)!.homekit;
    expect(validateInventory(value).cameras[0].entities.at(-1)?.role).toBe('infrared');
    await bridge.stop();
  });
  it('routes only supported advertised controls and validates their ranges before a provider executes them', async () => {
    const { bridge, value } = await fixture(),
      spotlight = value.cameras[0].entities[1];
    expect(
      validateCommand(spotlight, { action: 'set', value: { on: true, brightness: 35 } }),
    ).toEqual({ action: 'set', value: { on: true, brightness: 35 } });
    expect(() =>
      validateCommand(spotlight, { action: 'set', value: { colorTemperature: 4000 } }),
    ).toThrow('invalid_bridge_command');
    expect(() => validateCommand(spotlight, { action: 'set', value: { brightness: 101 } })).toThrow(
      'invalid_bridge_command',
    );
    expect(() =>
      validateCommand(spotlight, {
        action: 'set',
        value: { on: false },
        topic: 'some/arbitrary/topic',
      }),
    ).toThrow('invalid_bridge_command');
    expect(() =>
      validateCommand(value.cameras[0].entities[0], { action: 'set', value: true }),
    ).toThrow('bridge_entity_read_only');
    const number = { ...spotlight, domain: 'number' as const, min: 0, max: 100, step: 5 };
    expect(validateCommand(number, { action: 'set', value: 35 })).toEqual({
      action: 'set',
      value: 35,
    });
    expect(() => validateCommand(number, { action: 'set', value: 36 })).toThrow(
      'invalid_bridge_command',
    );
    value.cameras[0].entities[1].state = { on: true, brightness: 55 };
    expect(validateInventory(value).cameras[0].entities[1].state).toEqual({
      on: true,
      brightness: 55,
    });
    await bridge.stop();
  });
  it('rejects duplicate IDs, placeholder URLs, numeric NaN and unsupported writes', async () => {
    const { bridge, value } = await fixture();
    const duplicate = structuredClone(value);
    duplicate.cameras.push(duplicate.cameras[0]);
    expect(() => validateInventory(duplicate)).toThrow('invalid_bridge_inventory');
    const invalid = structuredClone(value);
    invalid.cameras[0].stream.url = 'http://homeassistant.local/api/camera_proxy/camera.a';
    expect(() => validateInventory(invalid)).toThrow('invalid_bridge_inventory');
    invalid.cameras[0].stream = value.cameras[0].stream;
    invalid.cameras[0].entities[0].state = NaN;
    expect(() => validateInventory(invalid)).toThrow('invalid_bridge_inventory');
    invalid.cameras[0].entities[0].state = true;
    invalid.cameras[0].entities[0].writable = true;
    expect(() => validateInventory(invalid)).toThrow('invalid_bridge_inventory');
    expect(inventoryRevision(value)).toHaveLength(64);
    await bridge.stop();
  });
  it('advertises only a dedicated bounded RTMP/AAC Talkback capability', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'haus-native-talkback-'));
    roots.push(directory);
    const bridge = await new CameraBridgeProvider({
      directory,
      provider: 'aqara',
      name: 'Camera',
    }).initialize();
    const value = inventory(bridge);
    value.cameras[0].talkback = {
      transport: 'rtmp',
      codec: 'aac',
      url: 'rtmp://192.168.1.10:1935/talk/camera-a',
    };
    expect(validateInventory(value).cameras[0].talkback?.codec).toBe('aac');
    for (const url of [
      'http://192.168.1.10/talk/camera-a',
      'rtmp://192.168.1.10/other',
      'rtmp://192.168.1.10/talk/camera-a?token=secret',
    ]) {
      value.cameras[0].talkback.url = url;
      expect(() => validateInventory(value)).toThrow('invalid_bridge_inventory');
    }
    await bridge.stop();
  });
  it('keeps mDNS untrusted, private and credential-free', () => {
    const service = {
      type: 'rsnra-camera',
      protocol: 'tcp' as const,
      port: 8580,
      txt: { profile: '2', bridge_id: randomUUID(), provider: 'rsnra.aqara' },
      addresses: ['203.0.113.20', '192.168.1.10'],
    };
    expect(discoveredCameraBridge(service)).toMatchObject({
      url: 'http://192.168.1.10:8580',
      verified: false,
    });
    expect(
      discoveredCameraBridge({ ...service, addresses: ['127.0.0.1', '203.0.113.20'] }),
    ).toBeUndefined();
    expect(discoveredCameraBridge({ ...service, addresses: ['192.168.1.999'] })).toBeUndefined();
    expect(discoveredCameraBridge({ ...service, addresses: ['fd12:3456::10'] })).toMatchObject({
      url: 'http://[fd12:3456::10]:8580',
      verified: false,
    });
    expect(
      discoveredCameraBridge({ ...service, txt: { ...service.txt, bridge_id: '../../config' } }),
    ).toBeUndefined();
  });
});
