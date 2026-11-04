/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it, vi } from 'vitest';
import { Identities, type Command, type SourceRef } from '@haus/core/types';
import { HaHomeAdapter } from '../src/adapter.js';
import type { Snapshot } from '../src/types.js';
import type { HaTransport } from '../src/ha-client.js';

it('normalizes HA facts into owned identities and maps canonical commands only to advertised services', async () => {
  const records = new Map<string, string>();
  let sequence = 0;
  const key = (source: SourceRef) => JSON.stringify(source);
  const identities = new Identities(
    {
      get: (source) => records.get(key(source)),
      putIfAbsent(source, id) {
        if (!records.has(key(source))) records.set(key(source), id);
        return records.get(key(source))!;
      },
    },
    () => `owned-${++sequence}`,
  );
  const snapshot: Snapshot = {
    states: [
      {
        entity_id: 'light.desk',
        state: 'on',
        attributes: {
          friendly_name: 'Desk',
          brightness: 128,
          supported_color_modes: ['brightness'],
        },
        last_changed: '2026-11-04T00:00:00Z',
      },
    ],
    areas: [{ area_id: 'office', name: 'Office' }],
    devices: [{ id: 'physical', name: 'Desk', area_id: 'office' }],
    entities: [
      {
        entity_id: 'light.desk',
        device_id: 'physical',
        unique_id: 'stable-dimmer',
        platform: 'test',
      },
    ],
    services: { light: { turn_on: {}, turn_off: {} } },
    config: { location_name: 'House' },
    user: { name: 'Test', is_admin: true },
  };
  const request = vi.fn(async () => ({ context: { id: 'receipt' } }));
  const transport = {
    connected: true,
    close: vi.fn(),
    request,
    watchState: () => () => {},
    watchEntities: () => () => {},
  } as unknown as HaTransport;
  const adapter = new HaHomeAdapter({
    id: 'backend',
    homeId: 'house',
    epoch: 'session',
    identities,
    transport,
    read: async () => snapshot,
  });
  const home = await adapter.snapshot();
  expect(home.endpoints).toHaveLength(1);
  expect(JSON.stringify(home)).not.toContain('entity_id');
  expect(JSON.stringify(home)).not.toContain('supported_color_modes');
  const endpoint = home.endpoints[0];
  expect(endpoint.id).toMatch(/^owned-/);
  const command: Command = {
    id: 'intent',
    endpointId: endpoint.id,
    capabilityId: 'level',
    operation: 'set',
    arguments: { value: 50 },
  };
  await expect(adapter.execute(command)).resolves.toEqual({
    status: 'accepted',
    correlationId: 'receipt',
  });
  expect(request).toHaveBeenCalledWith({
    type: 'call_service',
    domain: 'light',
    service: 'turn_on',
    target: { entity_id: 'light.desk' },
    service_data: { brightness: 128 },
  });
  await expect(adapter.execute({ ...command, arguments: { value: 200 } })).rejects.toThrow(
    'invalid_command_value',
  );
  await expect(adapter.execute({ ...command, capabilityId: 'white' })).rejects.toThrow(
    'unsupported_operation',
  );
  expect(request).toHaveBeenCalledTimes(1);
  adapter.close();
});
