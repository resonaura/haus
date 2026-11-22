/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import {
  HaFlowWorkerError,
  type HaEntitySnapshot,
  type HaRuntimeEntity,
  type HaRuntimeEvent,
} from '@haus/kitsune';
import { HaIntegrationEntities } from '../../src/commissioning/ha-flow/entities.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';

it('recovers immediately after worker restart and dispatches low sequence numbers from the new session', async () => {
  const home = new StandaloneHomeService();
  const dispatched = vi.spyOn(home, 'dispatchAutomationEvent');
  let eventListener: ((event: HaRuntimeEvent) => void) | undefined;
  let exitListener: ((reason: string) => void) | undefined;
  let currentSession = 'session-1';
  let currentSequence = 4;

  const button: HaRuntimeEntity = {
    entityId: 'event.bedroom_wall_switch_button_1',
    entryId: 'hue-entry',
    integration: 'hue',
    uniqueId: 'btn-1',
    name: 'Button 1',
    domain: 'event',
    state: 'unknown',
    attributes: { event_types: ['initial_press', 'short_release'] },
    deviceId: 'wall-switch',
    deviceName: 'Bedroom Wall Switch',
  };

  const runtime = {
    isRunning: () => true,
    setupEntry: vi.fn(async () => ({ ok: true, state: 'loaded' })),
    entitySnapshot: vi.fn(
      async (): Promise<HaEntitySnapshot> => ({
        sessionId: currentSession,
        entities: [button],
        events: [],
        sequence: currentSequence,
        entries: [{ entryId: 'hue-entry', state: 'loaded' }],
      }),
    ),
    entityCommand: vi.fn(async () => ({ ok: true })),
    unloadEntry: vi.fn(async () => ({ ok: true })),
    onEvent: (listener: (event: HaRuntimeEvent) => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    },
    onWorkerExit: (listener: (reason: string) => void) => {
      exitListener = listener;
      return () => {
        exitListener = undefined;
      };
    },
  };

  const entities = new HaIntegrationEntities(home);
  try {
    entities.sync(runtime, [{ entryId: 'hue-entry', domain: 'hue', title: 'Hue', data: {} }]);
    await vi.waitFor(() => expect(home.listDevices()).toHaveLength(1));

    // Session 1 reaches sequence 5.
    eventListener?.({
      sessionId: 'session-1',
      sequence: 5,
      entityId: button.entityId,
      entryId: 'hue-entry',
      eventType: 'initial_press',
      at: new Date().toISOString(),
    });
    await vi.waitFor(() => expect(dispatched).toHaveBeenCalledTimes(1));
    dispatched.mockClear();

    // Simulate worker crash and restart into session-2 starting back at sequence 1.
    currentSession = 'session-2';
    currentSequence = 1;
    exitListener?.('1');

    // Immediate button press from new session at sequence 1 must dispatch (not be dropped by old seq=5).
    eventListener?.({
      sessionId: 'session-2',
      sequence: 1,
      entityId: button.entityId,
      entryId: 'hue-entry',
      eventType: 'initial_press',
      at: new Date().toISOString(),
      data: { steps: 15, duration: 200 },
    });

    await vi.waitFor(() =>
      expect(dispatched).toHaveBeenCalledWith({
        type: 'event',
        eventType: 'initial_press',
        endpointId: button.entityId,
        data: { steps: 15, duration: 200 },
      }),
    );
    // Worker exit must also trigger automatic setup re-run within the fast recheck window (~1.5s), not 60s.
    await vi.waitFor(() => expect(runtime.setupEntry).toHaveBeenCalledTimes(2), { timeout: 3_500 });
  } finally {
    await entities.close();
  }
}, 10_000);

it('does not replay historical button events or flap offline on transient snapshot timeout while worker is alive', async () => {
  const home = new StandaloneHomeService();
  const dispatched = vi.spyOn(home, 'dispatchAutomationEvent');
  let eventListener: ((event: HaRuntimeEvent) => void) | undefined;

  const button: HaRuntimeEntity = {
    entityId: 'event.bedroom_wall_switch_button_2',
    entryId: 'hue-entry',
    integration: 'hue',
    uniqueId: 'btn-2',
    name: 'Button 2',
    domain: 'event',
    state: 'unknown',
    attributes: { event_types: ['initial_press'] },
    deviceId: 'wall-switch',
    deviceName: 'Bedroom Wall Switch',
  };

  const historicEvent: HaRuntimeEvent = {
    sessionId: 'session-a',
    sequence: 1,
    entityId: button.entityId,
    entryId: 'hue-entry',
    eventType: 'initial_press',
    at: new Date().toISOString(),
  };

  let failOnce = false;
  const runtime = {
    isRunning: () => true,
    setupEntry: vi.fn(async () => ({ ok: true, state: 'loaded' })),
    entitySnapshot: vi.fn(async (since = 0): Promise<HaEntitySnapshot> => {
      if (failOnce) {
        failOnce = false;
        throw new HaFlowWorkerError("HA flow command 'entity_snapshot' timed out after 15000ms", {
          code: 'request_timeout',
        });
      }
      return {
        sessionId: 'session-a',
        entities: [button],
        events: historicEvent.sequence > since ? [historicEvent] : [],
        sequence: 1,
        entries: [{ entryId: 'hue-entry', state: 'loaded' }],
      };
    }),
    entityCommand: vi.fn(async () => ({ ok: true })),
    unloadEntry: vi.fn(async () => ({ ok: true })),
    onEvent: (listener: (event: HaRuntimeEvent) => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    },
  };

  const entities = new HaIntegrationEntities(home);
  try {
    entities.sync(runtime, [{ entryId: 'hue-entry', domain: 'hue', title: 'Hue', data: {} }]);
    await vi.waitFor(() => expect(home.listDevices()).toHaveLength(1));

    // Process event sequence 1 once.
    eventListener?.(historicEvent);
    await vi.waitFor(() => expect(dispatched).toHaveBeenCalledTimes(1));
    dispatched.mockClear();

    // Trigger a transient request_timeout while worker stays alive.
    failOnce = true;
    entities.sync(runtime, [{ entryId: 'hue-entry', domain: 'hue', title: 'Hue', data: {} }]);
    await vi.waitFor(() => expect(runtime.entitySnapshot).toHaveBeenCalledTimes(3), {
      timeout: 3_500,
    });

    // Device stays online and historic event 1 is NOT replayed.
    expect(home.listDevices()[0]?.availability).toBe('online');
    expect(dispatched).not.toHaveBeenCalled();
  } finally {
    await entities.close();
  }
}, 10_000);

it('isolates multi-button endpoints on the same device so a slow automation on pin 1 does not block pin 2', async () => {
  const home = new StandaloneHomeService();
  let stateListener: ((entities: readonly HaRuntimeEntity[]) => void) | undefined;
  let releaseSlow: (() => void) | undefined;
  const slowStarted = new Promise<void>((resolve) => {
    home.registerCommandHandler('virtual', async () => {
      resolve();
      await new Promise<void>((done) => {
        releaseSlow = done;
      });
    });
  });

  home.registerDevice({
    id: 'dev:slow-lamp',
    name: 'Slow Lamp',
    roomId: 'unassigned',
    category: 'lighting',
    availability: 'online',
    connectivity: { protocol: 'virtual' },
    source: { instanceId: 'virtual', externalId: 'slow-lamp' },
    sourceRefs: [{ protocol: 'virtual', externalId: 'slow-lamp' }],
    endpoints: [
      {
        id: 'slow.lamp',
        name: 'Slow Lamp',
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
    id: 'rule.pin1_slow',
    name: 'Pin 1 Slow',
    enabled: true,
    triggers: [{ type: 'state', endpointId: 'binary_sensor.foxyswitch_pin_1', to: 'on' }],
    actions: [
      {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: { endpointId: 'slow.lamp', capability: 'on_off', command: 'turn_on' },
        },
      },
    ],
  });

  const pin1: HaRuntimeEntity = {
    entityId: 'binary_sensor.foxyswitch_pin_1',
    entryId: 'esp-entry',
    integration: 'esphome',
    uniqueId: 'pin-1',
    name: 'Pin 1',
    domain: 'binary_sensor',
    state: 'off',
    attributes: {},
    deviceId: 'foxyswitch',
    deviceName: 'FoxySwitch',
  };
  const pin2: HaRuntimeEntity = {
    entityId: 'binary_sensor.foxyswitch_pin_2',
    entryId: 'esp-entry',
    integration: 'esphome',
    uniqueId: 'pin-2',
    name: 'Pin 2',
    domain: 'binary_sensor',
    state: 'off',
    attributes: {},
    deviceId: 'foxyswitch',
    deviceName: 'FoxySwitch',
  };

  const runtime = {
    setupEntry: vi.fn(async () => ({ ok: true, state: 'loaded' })),
    entitySnapshot: vi.fn(
      async (): Promise<HaEntitySnapshot> => ({
        sessionId: 'esp-session',
        entities: [pin1, pin2],
        events: [],
        sequence: 0,
        entries: [{ entryId: 'esp-entry', state: 'loaded' }],
      }),
    ),
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
    entities.sync(runtime, [{ entryId: 'esp-entry', domain: 'esphome', title: 'ESP', data: {} }]);
    await vi.waitFor(() =>
      expect(home.getEndpointProperty('binary_sensor.foxyswitch_pin_2', 'on_off')).toBe(false),
    );

    // Press Pin 1 (starts blocked slow automation), then immediately press Pin 2 on the SAME device.
    stateListener?.([{ ...pin1, state: 'on' }]);
    await slowStarted;

    stateListener?.([{ ...pin2, state: 'on' }]);
    await vi.waitFor(
      () => expect(home.getEndpointProperty('binary_sensor.foxyswitch_pin_2', 'on_off')).toBe(true),
      { timeout: 1_000 },
    );
  } finally {
    releaseSlow?.();
    await entities.close();
  }
}, 10_000);
