/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import type { HaEntitySnapshot, HaFlowRuntime, HaRuntimeEntity } from '@haus/kitsune';
import { HaIntegrationEntities } from '../../src/commissioning/ha-flow/entities.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { sanitizeEntryPayload } from '../../src/commissioning/entry-helpers.js';

it('projects observed integration entities and routes commands to the same entry', async () => {
  const home = new StandaloneHomeService();
  const dispatched = vi.spyOn(home, 'dispatchAutomationEvent');
  const entity: HaRuntimeEntity = {
    entityId: 'light.fixture',
    entryId: 'fixture-entry',
    integration: 'fixture',
    uniqueId: 'lamp-1',
    name: 'Lamp',
    domain: 'light',
    state: 'on',
    attributes: { brightness: 128 },
    deviceId: 'lamp',
    deviceName: 'Room Lamp',
  };
  const runtime = {
    setupEntry: vi.fn(async () => ({ ok: true })),
    entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
      entities: [entity],
      events: [],
      sequence: 0,
      entries: [
        {
          entryId: entity.entryId,
          state: 'loaded',
          config: {
            entryId: entity.entryId,
            domain: 'fixture',
            title: 'Fixture',
            data: { credentials: 'private-owner' },
          },
        },
      ],
    })),
    entityCommand: vi.fn(async () => ({ ok: true })),
    unloadEntry: vi.fn(async () => ({ ok: true })),
  } satisfies Pick<
    HaFlowRuntime,
    'setupEntry' | 'entitySnapshot' | 'entityCommand' | 'unloadEntry'
  >;
  const persist = vi.fn(async () => {});
  const entities = new HaIntegrationEntities(home, undefined, persist);
  try {
    entities.sync(runtime, [
      { entryId: entity.entryId, domain: 'fixture', title: 'Fixture', data: {} },
    ]);
    await vi.waitFor(() => expect(home.listDevices()).toHaveLength(1));
    const device = home.listDevices()[0];
    expect(device?.name).toBe('Room Lamp');
    expect(persist).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ data: { credentials: 'private-owner' } }),
    );
    expect(JSON.stringify(home.listDevices())).not.toContain('private-owner');
    expect(home.getEndpointProperty(entity.entityId, 'on_off')).toBe(true);
    await home.executeDeviceCommand(entity.entityId, 'on_off', 'turn_off');
    expect(runtime.entityCommand).toHaveBeenCalledWith(
      entity.entryId,
      entity.entityId,
      'turn_off',
      { entity_id: entity.entityId },
    );
    expect(home.getEndpointProperty(entity.entityId, 'on_off')).toBe(true);
    entities.sync(runtime, [
      {
        entryId: entity.entryId,
        domain: 'fixture',
        title: 'Fixture',
        data: {},
        disabledBy: 'user',
      },
    ]);
    await vi.waitFor(() => expect(runtime.unloadEntry).toHaveBeenCalledWith(entity.entryId));
    expect(home.getDevice(device?.id ?? '')?.availability).toBe('offline');
    entities.sync(runtime, [
      { entryId: entity.entryId, domain: 'fixture', title: 'Fixture', data: {} },
    ]);
    await vi.waitFor(() => expect(home.getDevice(device?.id ?? '')?.availability).toBe('online'), {
      timeout: 4_000,
    });
    expect(home.listDevices()).toHaveLength(1);
    dispatched.mockClear();
    runtime.entitySnapshot.mockResolvedValue({
      entities: [{ ...entity, state: 'off' }],
      events: [],
      sequence: 0,
    });
    await vi.waitFor(
      () => expect(home.getEndpointProperty(entity.entityId, 'on_off')).toBe(false),
      { timeout: 4_000 },
    );
    expect(dispatched).toHaveBeenCalledExactlyOnceWith({
      type: 'state',
      endpointId: entity.entityId,
      property: 'on_off',
      from: true,
      to: false,
    });
    runtime.entitySnapshot.mockRejectedValueOnce(Error('worker_disconnected'));
    await vi.waitFor(() => expect(home.getDevice(device?.id ?? '')?.availability).toBe('offline'), {
      timeout: 4_000,
    });
    await vi.waitFor(() => expect(home.getDevice(device?.id ?? '')?.availability).toBe('online'), {
      timeout: 4_000,
    });
    expect(home.listDevices()).toHaveLength(1);
  } finally {
    await entities.close();
  }
}, 15_000);

it('keeps imported BLE bind keys and encryption keys out of public entry data', () => {
  expect(
    sanitizeEntryPayload({
      address: '00:00:00:00:00:01',
      bindkey: 'private-bind',
      encryption_key: 'private-api',
    }),
  ).toEqual({ address: '00:00:00:00:00:01' });
});

it('isolates per-device push queues so a slow automation on device A does not block device B', async () => {
  const home = new StandaloneHomeService();
  let stateListener: ((entities: readonly HaRuntimeEntity[]) => void) | undefined;
  let releaseSlowAutomation: (() => void) | undefined;
  const slowStarted = new Promise<void>((resolve) => {
    home.registerCommandHandler('virtual', async () => {
      resolve();
      await new Promise<void>((done) => {
        releaseSlowAutomation = done;
      });
    });
  });

  home.registerDevice({
    id: 'dev:slow',
    name: 'Slow Target',
    roomId: 'unassigned',
    category: 'lighting',
    availability: 'online',
    connectivity: { protocol: 'virtual' },
    source: { instanceId: 'virtual', externalId: 'slow' },
    sourceRefs: [{ protocol: 'virtual', externalId: 'slow' }],
    endpoints: [
      {
        id: 'slow.target',
        name: 'Slow Target',
        category: 'lighting',
        availability: 'online',
        capabilities: [
          { id: 'on_off', kind: 'on_off', readable: true, operations: ['turn_on', 'turn_off'] },
        ],
        readings: {},
      },
    ],
  });

  home.registerAutomation({
    schemaVersion: 1,
    id: 'rule.slow_switch',
    name: 'Slow Switch Rule',
    enabled: true,
    triggers: [{ type: 'state', endpointId: 'binary_sensor.switch_a', to: 'on' }],
    actions: [
      {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: { endpointId: 'slow.target', capability: 'on_off', command: 'turn_on' },
        },
      },
    ],
  });

  const switchA: HaRuntimeEntity = {
    entityId: 'binary_sensor.switch_a',
    entryId: 'entry-a',
    integration: 'esphome',
    uniqueId: 'sw-a',
    name: 'Switch A',
    domain: 'binary_sensor',
    state: 'off',
    attributes: {},
    deviceId: 'dev-a',
    deviceName: 'Switch A',
  };
  const lampB: HaRuntimeEntity = {
    entityId: 'light.lamp_b',
    entryId: 'entry-b',
    integration: 'hue',
    uniqueId: 'lamp-b',
    name: 'Lamp B',
    domain: 'light',
    state: 'off',
    attributes: {},
    deviceId: 'dev-b',
    deviceName: 'Lamp B',
  };

  const runtime = {
    setupEntry: vi.fn(async () => ({ ok: true })),
    entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
      entities: [switchA, lampB],
      events: [],
      sequence: 0,
      entries: [
        { entryId: 'entry-a', state: 'loaded' },
        { entryId: 'entry-b', state: 'loaded' },
      ],
    })),
    entityCommand: vi.fn(async () => ({ ok: true })),
    unloadEntry: vi.fn(async () => ({ ok: true })),
    onEntityStates: (listener: (entities: readonly HaRuntimeEntity[]) => void) => {
      stateListener = listener;
      return () => {
        stateListener = undefined;
      };
    },
  };

  const entities = new HaIntegrationEntities(home);
  try {
    entities.sync(runtime, [
      { entryId: 'entry-a', domain: 'esphome', title: 'ESP', data: {} },
      { entryId: 'entry-b', domain: 'hue', title: 'Hue', data: {} },
    ]);
    await vi.waitFor(() => expect(home.getEndpointProperty('light.lamp_b', 'on_off')).toBe(false));

    // Trigger slow automation on Switch A, then push Lamp B state while Switch A is still running.
    stateListener?.([{ ...switchA, state: 'on' }]);
    await slowStarted;

    stateListener?.([{ ...lampB, state: 'on' }]);
    await vi.waitFor(() => expect(home.getEndpointProperty('light.lamp_b', 'on_off')).toBe(true), {
      timeout: 1_000,
    });
  } finally {
    releaseSlowAutomation?.();
    await entities.close();
  }
}, 10_000);

it('never marks remote-owned HA devices offline on standby and self-heals quiet dimmer availability drift', async () => {
  const standbyHome = new StandaloneHomeService();
  standbyHome.registerDevice({
    id: 'ha:remote-dimmer-entry:dimmer-dev',
    name: 'Living Room Dimmer Switch',
    roomId: 'living_room',
    category: 'generic',
    availability: 'online',
    connectivity: { protocol: 'virtual' },
    source: { instanceId: 'ha:remote-dimmer-entry', externalId: 'dimmer-dev' },
    sourceRefs: [{ protocol: 'vendor', instanceId: 'xiaomi_ble', externalId: 'dimmer-dev' }],
    endpoints: [
      {
        id: 'event.living_room_dimmer_switch_dimmer',
        name: 'Dimmer',
        category: 'generic',
        availability: 'online',
        capabilities: [{ id: 'event', kind: 'event', readable: true, operations: [] }],
        readings: {},
      },
    ],
  });
  const standbyRuntime = {
    setupEntry: vi.fn(async () => ({ ok: true })),
    entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
      entities: [],
      events: [],
      sequence: 0,
      entries: [],
    })),
    entityCommand: vi.fn(async () => ({ ok: true })),
    unloadEntry: vi.fn(async () => ({ ok: true })),
  };
  const standbyEntities = new HaIntegrationEntities(standbyHome);
  try {
    standbyEntities.sync(standbyRuntime, []);
    await vi.waitFor(() => expect(standbyRuntime.entitySnapshot).toHaveBeenCalled());
    expect(standbyHome.getDevice('ha:remote-dimmer-entry:dimmer-dev')?.availability).toBe('online');
  } finally {
    await standbyEntities.close();
  }

  const primaryHome = new StandaloneHomeService();
  const dimmerEntity: HaRuntimeEntity = {
    entityId: 'event.living_room_dimmer_switch_dimmer',
    entryId: 'dimmer-entry',
    integration: 'xiaomi_ble',
    uniqueId: 'F8:24:41:C5:7D:98-dimmer',
    name: 'Dimmer',
    domain: 'event',
    state: 'unknown',
    attributes: { event_types: ['press', 'rotate_left', 'rotate_right'] },
    deviceId: 'dimmer-dev',
    deviceName: 'Living Room Dimmer Switch',
  };
  const primaryRuntime = {
    setupEntry: vi.fn(async () => ({ ok: true })),
    entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
      entities: [dimmerEntity],
      events: [],
      sequence: 0,
      entries: [{ entryId: 'dimmer-entry', state: 'loaded' }],
    })),
    entityCommand: vi.fn(async () => ({ ok: true })),
    unloadEntry: vi.fn(async () => ({ ok: true })),
  };
  const primaryEntities = new HaIntegrationEntities(primaryHome);
  try {
    primaryEntities.sync(primaryRuntime, [
      { entryId: 'dimmer-entry', domain: 'xiaomi_ble', title: 'Dimmer', data: {} },
    ]);
    await vi.waitFor(() =>
      expect(primaryHome.getDevice('ha:dimmer-entry:dimmer-dev')?.availability).toBe('online'),
    );

    // Simulate external snapshot reload overwriting the quiet dimmer as offline.
    const current = primaryHome.getDevice('ha:dimmer-entry:dimmer-dev');
    if (!current) throw new Error('expected dimmer device');
    primaryHome.registerDevice({ ...current, availability: 'offline' });
    expect(primaryHome.getDevice('ha:dimmer-entry:dimmer-dev')?.availability).toBe('offline');

    // Triggering another full snapshot sync must heal availability even with identical entity JSON.
    primaryEntities.sync(primaryRuntime, [
      { entryId: 'dimmer-entry', domain: 'xiaomi_ble', title: 'Dimmer', data: {} },
    ]);
    await vi.waitFor(
      () =>
        expect(primaryHome.getDevice('ha:dimmer-entry:dimmer-dev')?.availability).toBe('online'),
      { timeout: 4_000 },
    );
  } finally {
    await primaryEntities.close();
  }
}, 15_000);
