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
