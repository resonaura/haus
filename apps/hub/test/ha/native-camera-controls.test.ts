/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { BridgeCommand, LightState } from '@haus/bridge/protocol';
import { NativeEntities, type NativePhysicalCamera } from '@haus/ha/node/native-entities';
import { cameraOperating, cameraSpotlight } from '@haus/hub/camera';

const isSetCommand = (value: unknown): value is Extract<BridgeCommand, { action: 'set' }> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('action' in value))
    return false;
  if (value.action !== 'set' || !('value' in value)) return false;
  const next = value.value;
  return (
    typeof next === 'boolean' ||
    typeof next === 'number' ||
    typeof next === 'string' ||
    (!!next && typeof next === 'object' && !Array.isArray(next))
  );
};

const isLightState = (value: unknown): value is LightState => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('on' in value))
    return false;
  if (typeof value.on !== 'boolean') return false;
  const optional = new Set(['brightness', 'colorTemperature', 'hue', 'saturation']);
  return Object.entries(value).every(
    ([key, item]) =>
      key === 'on' ||
      (optional.has(key) && typeof item === 'number' && Number.isFinite(item)),
  );
};

test('native camera controls read provider state and project one canonical Activity entity', async () => {
  let active = false;
  const camera = { id: 'camera.outdoor', name: 'Outdoor', nativeProvider: { bridgeId: 'bridge' } };
  const physical: NativePhysicalCamera = {
    id: 'physical',
    manufacturer: 'Aqara',
    model: 'Camera',
    available: true,
    entities: [
      {
        id: 'night_vision',
        name: 'Night vision',
        domain: 'select',
        role: 'nightVision',
        options: ['off', 'auto', 'on'],
        homekit: { enabledValue: 'auto', disabledValue: 'off' },
        writable: true,
        available: true,
        state: 'auto',
        updatedAt: 0,
      },
      {
        id: 'spotlight',
        name: 'Spotlight',
        domain: 'light',
        role: 'spotlight',
        writable: true,
        brightness: true,
        available: true,
        state: { on: true, brightness: 50 },
        updatedAt: 0,
      },
      {
        id: 'physical_motion',
        name: 'Motion',
        domain: 'binary_sensor',
        role: 'motion',
        available: true,
        state: false,
        updatedAt: 0,
      },
    ],
  };
  const native = new NativeEntities({
    sources: {
      rows: () => [{ bridgeId: 'bridge', physicalId: 'physical', value: { cameraId: camera.id } }],
    },
    providers: {
      inventory: () => ({ reachable: true, provider: 'aqara', cameras: [physical] }),
      command: async (_bridgeId, _physicalId, entityId, raw) => {
        if (!isSetCommand(raw)) throw Error('unexpected_native_command');
        const entity = physical.entities?.find((item) => item.id === entityId);
        if (!entity) throw Error('native_entity_missing');
        if (entity.domain === 'light' && typeof raw.value === 'object') {
          const current = entity.state;
          if (!isLightState(current))
            throw Error('invalid_light_fixture_state');
          entity.state = { ...current, ...raw.value };
        } else if (entity.domain === 'select' && typeof raw.value === 'string') {
          entity.state = raw.value;
        } else {
          throw Error('unexpected_native_value');
        }
      },
      refresh: async () => {},
    },
    registry: () => ({ cameras: [camera] }),
    activity: { status: () => ({ available: true, active, source: 'native' }) },
  });
  const operating = cameraOperating({ registry: () => ({ cameras: [camera] }), ha: {}, native });
  const nightVision = operating.read(camera.id).nightVision;
  assert.ok(nightVision?.available);

  await operating.write(camera.id, 'nightVision', nightVision.id, false);
  assert.equal(operating.read(camera.id).nightVision?.value, false);
  await operating.write(camera.id, 'nightVision', nightVision.id, true);
  assert.equal(operating.read(camera.id).nightVision?.value, true);

  const spotlight = cameraSpotlight({ registry: () => ({ cameras: [camera] }), ha: {}, native });
  const initialSpotlight = spotlight.read(camera.id);
  assert.ok(initialSpotlight);
  assert.equal(initialSpotlight?.brightness, 50);
  await spotlight.write(camera.id, initialSpotlight.id, { brightness: 30 });
  assert.equal(spotlight.read(camera.id)?.brightness, 30);
  assert.equal(spotlight.read(camera.id)?.on, true);

  const projected = () => {
    const device = native.devices().find((item) => item.cameraId === camera.id);
    assert.ok(device);
    return device.entities;
  };
  const motion = () => projected().filter((entity) => entity.role === 'motion');
  assert.deepEqual(motion().map(({ id, state }) => ({ id, state })), [
    { id: 'haus_activity', state: false },
  ]);
  active = true;
  assert.deepEqual(motion().map(({ id, state }) => ({ id, state })), [
    { id: 'haus_activity', state: true },
  ]);
});
