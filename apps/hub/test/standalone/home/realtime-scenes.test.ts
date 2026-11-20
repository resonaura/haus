/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HaEntitySnapshot, HaRuntimeEntity, HaRuntimeEvent } from '@haus/kitsune';
import { ExecutionStatus, StepStatus, type HausDevice } from '@haus/core';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { HaIntegrationEntities } from '../../../src/commissioning/ha-flow/entities.js';

function makeLightEntity(idx: number): HaRuntimeEntity {
  return {
    entityId: `light.room_lamp_${idx}`,
    entryId: 'hue-entry-1',
    integration: 'hue',
    uniqueId: `lamp-uid-${idx}`,
    name: `Room Lamp ${idx}`,
    domain: 'light',
    state: 'off',
    attributes: {
      supported_color_modes: ['color_temp', 'xy'],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6535,
      effect_list: ['off', 'candle', 'fire'],
    },
    deviceId: `lamp-dev-${idx}`,
    deviceName: `Room Lamp ${idx}`,
  };
}

describe('Hub real-time events & parallel scene optimizations', () => {
  it('coalesces multi-attribute HA lights into 1 atomic command each and executes scene members in parallel', async () => {
    const home = new StandaloneHomeService();
    const entitiesList: HaRuntimeEntity[] = [
      makeLightEntity(1),
      makeLightEntity(2),
      makeLightEntity(3),
      makeLightEntity(4),
      {
        entityId: 'switch.room_plug_1',
        entryId: 'hue-entry-1',
        integration: 'hue',
        uniqueId: 'plug-uid-1',
        name: 'Room Plug 1',
        domain: 'switch',
        state: 'on',
        attributes: {},
        deviceId: 'plug-dev-1',
        deviceName: 'Room Plug 1',
      },
    ];

    const calls: Array<{ entityId: string; service: string; data: Record<string, unknown> }> = [];
    const runtime = {
      setupEntry: vi.fn(async () => ({ ok: true })),
      entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
        entities: entitiesList,
        events: [],
        sequence: 0,
        entries: [{ entryId: 'hue-entry-1', state: 'loaded' }],
      })),
      entityCommand: vi.fn(
        async (_entryId: string, entityId: string, service: string, data: Record<string, unknown>) => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          calls.push({ entityId, service, data });
          return { ok: true };
        },
      ),
      unloadEntry: vi.fn(async () => ({ ok: true })),
    };

    const bridge = new HaIntegrationEntities(home);
    try {
      bridge.sync(runtime, [{ entryId: 'hue-entry-1', domain: 'hue', title: 'Hue', data: {} }]);
      await vi.waitFor(() => expect(home.devices.listDevices()).toHaveLength(5));

      home.registerScene({
        schemaVersion: 1,
        id: 'scene-bedroom-bright',
        name: 'Bedroom Bright',
        members: [
          {
            endpointId: 'light.room_lamp_1',
            targetState: {
              on_off: true,
              brightness: 255,
              color_temp_kelvin: 6535,
              color: { r: 255, g: 255, b: 251 },
              hs_color: [54.768, 1.6],
              effect: 'off',
            },
          },
          {
            endpointId: 'light.room_lamp_2',
            targetState: {
              on_off: true,
              brightness: 80,
              color_temp: 3200,
            },
          },
          {
            endpointId: 'light.room_lamp_3',
            targetState: {
              on_off: true,
              brightness: 200,
              color: { r: 255, g: 0, b: 0 },
            },
          },
          {
            endpointId: 'light.room_lamp_4',
            targetState: { on_off: false, brightness: 100 },
          },
          {
            endpointId: 'switch.room_plug_1',
            targetState: { on_off: false },
          },
        ],
      });

      const start = performance.now();
      const record = await home.activateScene('scene-bedroom-bright');
      const elapsedMs = performance.now() - start;

      expect(record.status).toBe(ExecutionStatus.Completed);
      expect(record.stepResults.map((r) => r.stepIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(record.stepResults.every((r) => r.status === StepStatus.Completed)).toBe(true);

      // 5 members x 60ms each = 300ms sequential; parallel must finish well under 200ms.
      expect(elapsedMs).toBeLessThan(200);
      // Exactly 1 atomic command per member (5 total, not 15+).
      expect(calls).toHaveLength(5);

      const lamp1 = calls.find((c) => c.entityId === 'light.room_lamp_1');
      expect(lamp1).toEqual({
        entityId: 'light.room_lamp_1',
        service: 'turn_on',
        data: {
          entity_id: 'light.room_lamp_1',
          brightness: 255,
          kelvin: 6535,
          effect: 'off',
        },
      });
      const lamp2 = calls.find((c) => c.entityId === 'light.room_lamp_2');
      expect(lamp2?.data).toEqual({
        entity_id: 'light.room_lamp_2',
        brightness: 204,
        kelvin: 3200,
      });
      const lamp3 = calls.find((c) => c.entityId === 'light.room_lamp_3');
      expect(lamp3?.data).toEqual({
        entity_id: 'light.room_lamp_3',
        brightness: 200,
        hs_color: [0, 100],
      });
      const lamp4 = calls.find((c) => c.entityId === 'light.room_lamp_4');
      expect(lamp4).toEqual({
        entityId: 'light.room_lamp_4',
        service: 'turn_off',
        data: { entity_id: 'light.room_lamp_4' },
      });
    } finally {
      await bridge.close();
      await home.onModuleDestroy();
    }
  });

  it('dispatches pushed HA events immediately without polling and deduplicates against snapshots', async () => {
    const home = new StandaloneHomeService();
    const buttonEntity: HaRuntimeEntity = {
      entityId: 'event.wall_switch_button_1',
      entryId: 'hue-entry-1',
      integration: 'hue',
      uniqueId: 'btn-1',
      name: 'Button 1',
      domain: 'event',
      state: 'unknown',
      attributes: { event_types: ['initial_press'] },
      deviceId: 'switch-1',
      deviceName: 'Wall Switch',
    };

    let pushEvent!: (ev: HaRuntimeEvent) => void;
    let pushStates!: (entities: readonly HaRuntimeEntity[]) => void;
    const eventsInSnapshot: HaRuntimeEvent[] = [];

    const runtime = {
      setupEntry: vi.fn(async () => ({ ok: true })),
      entitySnapshot: vi.fn(async (): Promise<HaEntitySnapshot> => ({
        entities: [buttonEntity],
        events: [...eventsInSnapshot],
        sequence: eventsInSnapshot.at(-1)?.sequence ?? 0,
        entries: [{ entryId: 'hue-entry-1', state: 'loaded' }],
      })),
      entityCommand: vi.fn(async () => ({ ok: true })),
      unloadEntry: vi.fn(async () => ({ ok: true })),
      onEvent: (listener: (ev: HaRuntimeEvent) => void) => {
        pushEvent = listener;
        return () => {};
      },
      onEntityStates: (listener: (entities: readonly HaRuntimeEntity[]) => void) => {
        pushStates = listener;
        return () => {};
      },
    };

    const bridge = new HaIntegrationEntities(home);
    try {
      bridge.sync(runtime, [{ entryId: 'hue-entry-1', domain: 'hue', title: 'Hue', data: {} }]);
      await vi.waitFor(() => expect(home.devices.listDevices()).toHaveLength(1));

      let triggerCount = 0;
      const targetDevice: HausDevice = {
        id: 'dev-target',
        source: { instanceId: 'standalone', externalId: 'dev-target' },
        name: 'Target Light',
        category: 'lighting',
        connectivity: { protocol: 'virtual' },
        availability: 'online',
        endpoints: [
          {
            id: 'ep-target',
            name: 'Target',
            capabilities: [{ id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on'] }],
            readings: {},
          },
        ],
        services: [],
      };
      home.registerDevice(targetDevice);
      home.registerCommandHandler('virtual', async () => {
        triggerCount += 1;
      });
      home.registerAutomation({
        schemaVersion: 1,
        id: 'auto-press',
        name: 'Wall Switch Press',
        enabled: true,
        mode: 'parallel',
        triggers: [{ type: 'event', eventType: 'initial_press', endpointId: 'event.wall_switch_button_1' }],
        conditions: [],
        actions: [
          {
            type: 'action',
            action: {
              kind: 'device_command',
              payload: { endpointId: 'ep-target', capability: 'on_off', command: 'turn_on' },
            },
          },
        ],
      });

      const ev: HaRuntimeEvent = {
        sequence: 1,
        entityId: 'event.wall_switch_button_1',
        entryId: 'hue-entry-1',
        eventType: 'initial_press',
        at: new Date().toISOString(),
      };
      eventsInSnapshot.push(ev);

      const t0 = performance.now();
      pushEvent(ev);
      await vi.waitFor(() => expect(triggerCount).toBe(1), { timeout: 250 });
      expect(performance.now() - t0).toBeLessThan(150);

      // Re-pushing the same sequence or syncing snapshot must not double-trigger.
      pushEvent(ev);
      pushStates([{ ...buttonEntity, state: '2026-11-19T22:00:00Z' }]);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(triggerCount).toBe(1);
    } finally {
      await bridge.close();
      await home.onModuleDestroy();
    }
  });

  it('runs multiple matching automation rules in parallel and avoids self-trigger queue deadlocks', async () => {
    const home = new StandaloneHomeService();
    try {
      home.registerDevice({
        id: 'dev-self',
        source: { instanceId: 'standalone', externalId: 'dev-self' },
        name: 'Self Trigger',
        category: 'power',
        connectivity: { protocol: 'virtual' },
        availability: 'online',
        endpoints: [
          {
            id: 'ep-self',
            name: 'Self',
            capabilities: [
              { id: 'on_off', kind: 'binary', readable: true, operations: ['turn_on', 'turn_off'] },
            ],
            readings: {},
          },
        ],
        services: [],
      });

      const executed: string[] = [];
      home.registerCommandHandler('virtual', async (endpointId, _cap, command) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        executed.push(`${endpointId}:${command}`);
      });

      for (const idx of [1, 2]) {
        home.registerAutomation({
          schemaVersion: 1,
          id: `rule-parallel-${idx}`,
          name: `Parallel Rule ${idx}`,
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'state', endpointId: 'ep-self', property: 'on_off', to: true }],
          conditions: [],
          actions: [
            {
              type: 'action',
              action: {
                kind: 'device_command',
                payload: { endpointId: 'ep-self', capability: 'on_off', command: 'turn_off' },
              },
            },
          ],
        });
      }

      const start = performance.now();
      await home.updateEndpointState('ep-self', { on_off: true }, true);
      const elapsed = performance.now() - start;

      // Both rules fire without deadlocking on ep-self's EntityActionQueue.
      expect(executed).toEqual(['ep-self:turn_off', 'ep-self:turn_off']);
      expect(elapsed).toBeLessThan(250);
    } finally {
      await home.onModuleDestroy();
    }
  });
});
