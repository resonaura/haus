/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import type { LightState } from '@haus/bridge/protocol';
import type { NativeProviderCamera, NativeProviderEntity } from '../../src/providers/native.js';
import { cameraOperating } from '../../src/camera/control/operating.js';
import { NativeCameraControls } from '../../src/camera/control/native.js';
import type { NativeCameraSources } from '../../src/camera/control/sources.js';

function fixture(entities: NativeProviderEntity[]) {
  const camera: NativeProviderCamera = {
    id: 'physical-one',
    name: 'Camera',
    available: true,
    stream: { url: 'rtsp://192.168.1.10/live', transport: 'native-rtsp' },
    entities,
  };
  const inventory = {
    bridgeId: 'bridge-one',
    provider: 'fixture',
    revision: 'revision-one',
    cameras: [camera],
    reachable: true,
  };
  const providers = {
    inventory: vi.fn(() => inventory),
    command: vi.fn(
      async (
        _bridgeId: string,
        _physicalId: string,
        entityId: string,
        command: unknown,
        _requestId?: string,
      ) => {
        const entity = entities.find((item) => item.id === entityId);
        if (!command || typeof command !== 'object' || Array.isArray(command))
          return { accepted: true as const };
        const action = Reflect.get(command, 'action');
        const value: unknown = Reflect.get(command, 'value');
        if (
          action === 'set' &&
          entity &&
          (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
        )
          entity.state = value;
        else if (action === 'set' && entity && value && typeof value === 'object' && !Array.isArray(value))
          entity.state = {
            ...(entity.state && typeof entity.state === 'object' ? entity.state : { on: false }),
            ...value,
          };
        return { accepted: true as const };
      },
    ),
    refresh: vi.fn(async () => inventory),
  };
  const sources: Pick<NativeCameraSources, 'rows'> = {
    rows: () => [
      {
        bridgeId: 'bridge-one',
        physicalId: 'physical-one',
        value: { cameraId: 'camera.one', aliases: [], physical: camera },
      },
    ],
  };
  return {
    camera,
    inventory,
    providers,
    sources,
    controls: new NativeCameraControls(providers, sources),
  };
}

describe('NativeCameraControls', () => {
  it('reads and dispatches indicator and night-vision values through the native provider', async () => {
    const { controls, providers } = fixture([
      {
        id: 'indicator',
        name: 'Status light',
        domain: 'switch',
        role: 'indicator',
        available: true,
        writable: true,
        state: false,
        updatedAt: 1,
      },
      {
        id: 'night',
        name: 'Night vision',
        domain: 'select',
        role: 'nightVision',
        homekit: { enabledValue: 'Auto', disabledValue: 'Off' },
        options: ['Auto', 'Off'],
        available: true,
        writable: true,
        state: 'Off',
        updatedAt: 1,
      },
    ]);

    assert.deepEqual(controls.operating('camera.one'), {
      indicator: { id: 'native:indicator', available: true, value: false },
      nightVision: { id: 'native:night', available: true, value: false },
    });
    await controls.writeOperating('camera.one', 'indicator', 'native:indicator', true);
    await controls.writeOperating('camera.one', 'nightVision', 'native:night', true);

    assert.deepEqual(
      providers.command.mock.calls.map(([, physicalId, entityId, command]) => ({
        physicalId,
        entityId,
        command,
      })),
      [
        {
          physicalId: 'physical-one',
          entityId: 'indicator',
          command: { action: 'set', value: true },
        },
        {
          physicalId: 'physical-one',
          entityId: 'night',
          command: { action: 'set', value: 'Auto' },
        },
      ],
    );
    assert.equal(providers.refresh.mock.calls.length, 2);
  });

  it('confirms an operating-state write from provider readback without an HA request', async () => {
    const { controls, providers } = fixture([
      {
        id: 'indicator',
        name: 'Status light',
        domain: 'switch',
        role: 'indicator',
        available: true,
        writable: true,
        state: false,
        updatedAt: 1,
      },
    ]);
    const haRequest = vi.fn(async () => assert.fail('Standalone controls must not call HA'));
    const operating = cameraOperating({
      registry: () => ({ cameras: [{ id: 'camera.one', nativeProvider: 'bridge-one' }] }),
      ha: { connected: false, request: haRequest },
      native: controls,
    });

    await operating.write('camera.one', 'indicator', 'native:indicator', true);

    assert.equal(operating.read('camera.one').indicator?.value, true);
    assert.equal(haRequest.mock.calls.length, 0);
    assert.equal(providers.command.mock.calls.length, 1);
  });

  it('exposes only a unique advertised spotlight and sends its capabilities unchanged', async () => {
    const light: LightState = { on: true, brightness: 42, hue: 220, saturation: 70 };
    const { controls, providers } = fixture([
      {
        id: 'spotlight',
        name: 'Spotlight',
        domain: 'light',
        role: 'spotlight',
        available: true,
        writable: true,
        brightness: true,
        color: true,
        state: light,
        updatedAt: 1,
      },
    ]);

    assert.deepEqual(controls.spotlight('camera.one'), {
      id: 'native:spotlight',
      available: true,
      ...light,
      capabilities: { brightness: true, color: true, colorTemperature: undefined },
    });
    await controls.writeSpotlight('camera.one', 'native:spotlight', { brightness: 68 });
    assert.deepEqual(providers.command.mock.calls[0]?.slice(1, 4), [
      'physical-one',
      'spotlight',
      { action: 'set', value: { brightness: 68 } },
    ]);

    const duplicate = fixture([
      {
        id: 'spotlight-a',
        name: 'Spotlight A',
        domain: 'light',
        role: 'spotlight',
        available: true,
        writable: true,
        state: { on: false },
        updatedAt: 1,
      },
      {
        id: 'spotlight-b',
        name: 'Spotlight B',
        domain: 'light',
        role: 'spotlight',
        available: true,
        writable: true,
        state: { on: false },
        updatedAt: 1,
      },
    ]);
    assert.equal(duplicate.controls.spotlight('camera.one'), undefined);
  });

  it('waits for a delayed provider readback before confirming a spotlight write', async () => {
    const spotlight: NativeProviderEntity = {
      id: 'spotlight',
      name: 'Spotlight',
      domain: 'light',
      role: 'spotlight',
      available: true,
      writable: true,
      brightness: true,
      state: { on: true, brightness: 42 },
      updatedAt: 1,
    };
    const { camera, providers, sources } = fixture([spotlight]);
    providers.command.mockImplementation(async () => {
      setTimeout(() => {
        camera.entities[0]!.state = { on: true, brightness: 68 };
      }, 10);
      return { accepted: true as const };
    });
    const controls = new NativeCameraControls(providers, sources, {
      spotlightReadbackTimeoutMs: 200,
      spotlightReadbackIntervalMs: 5,
    });

    await controls.writeSpotlight('camera.one', 'native:spotlight', { brightness: 68 });

    assert.equal(controls.spotlight('camera.one')?.brightness, 68);
    assert.ok(providers.refresh.mock.calls.length >= 2);
    assert.equal(providers.command.mock.calls.length, 1);
  });

  it('does not report or replay a spotlight write when provider state stays stale', async () => {
    const { providers, sources } = fixture([
      {
        id: 'spotlight',
        name: 'Spotlight',
        domain: 'light',
        role: 'spotlight',
        available: true,
        writable: true,
        brightness: true,
        state: { on: true, brightness: 42 },
        updatedAt: 1,
      },
    ]);
    providers.command.mockResolvedValue({ accepted: true });
    const controls = new NativeCameraControls(providers, sources, {
      spotlightReadbackTimeoutMs: 10,
      spotlightReadbackIntervalMs: 1,
    });

    await assert.rejects(
      controls.writeSpotlight('camera.one', 'native:spotlight', { brightness: 68 }),
      /camera_control_unconfirmed/,
    );
    assert.equal(providers.command.mock.calls.length, 1);
    assert.ok(providers.refresh.mock.calls.length > 1);
  });

  it('surfaces provider refresh failure after a spotlight command', async () => {
    const { providers, sources } = fixture([
      {
        id: 'spotlight',
        name: 'Spotlight',
        domain: 'light',
        role: 'spotlight',
        available: true,
        writable: true,
        brightness: true,
        state: { on: true, brightness: 42 },
        updatedAt: 1,
      },
    ]);
    providers.command.mockResolvedValue({ accepted: true });
    providers.refresh.mockRejectedValue(new Error('bridge_unreachable'));
    const controls = new NativeCameraControls(providers, sources);

    await assert.rejects(
      controls.writeSpotlight('camera.one', 'native:spotlight', { brightness: 68 }),
      /bridge_unreachable/,
    );
    assert.equal(providers.command.mock.calls.length, 1);
  });

  it('retains offline state but refuses physical writes while the provider is unavailable', async () => {
    const { controls, inventory, providers } = fixture([
      {
        id: 'indicator',
        name: 'Status light',
        domain: 'switch',
        role: 'indicator',
        available: true,
        writable: true,
        state: true,
        updatedAt: 1,
      },
    ]);
    inventory.reachable = false;

    assert.deepEqual(controls.operating('camera.one').indicator, {
      id: 'native:indicator',
      available: false,
      value: true,
    });
    await assert.rejects(
      controls.writeOperating('camera.one', 'indicator', 'native:indicator', false),
      /camera_control_unavailable/,
    );
    assert.equal(providers.command.mock.calls.length, 0);
  });
});
