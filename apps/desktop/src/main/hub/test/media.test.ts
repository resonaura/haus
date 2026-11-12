/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { parseDevices } from '../types.js';
import { buildView } from '../entities.js';

it('uses the explicit archive camera identity and each endpoint availability', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'native-camera',
        name: 'Outdoor',
        availability: 'online',
        connectivity: { protocol: 'local_ip' },
        category: 'cameras',
        endpoints: [
          {
            id: 'video',
            mediaId: 'camera.preserved_archive',
            availability: 'offline',
            capabilities: [{ id: 'video', kind: 'complex', operations: [] }],
          },
          {
            id: 'status',
            availability: 'online',
            capabilities: [{ id: 'on_off', kind: 'binary', operations: ['set'] }],
          },
        ],
      },
    ],
  });
  const view = buildView(devices, { status: { on_off: true } });
  expect(view.states.find((state) => state.entity_id === 'camera.preserved_archive')?.state).toBe(
    'unavailable',
  );
  expect(view.states.find((state) => state.entity_id.startsWith('switch.'))?.state).toBe('on');
  const malformed = parseDevices({
    devices: [{ id: 'x', endpoints: [{ id: 'y', mediaId: 'https://private/secret' }] }],
  });
  expect(malformed[0]?.endpoints[0]?.mediaId).toBeUndefined();
});

it('does not expose private transport sensor URLs to renderer state', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'camera',
        category: 'cameras',
        endpoints: [
          { id: 'stream', capabilities: [{ id: 'value', kind: 'string', operations: [] }] },
        ],
      },
    ],
  });
  const view = buildView(devices, { stream: { value: 'rtsp://user:secret@192.168.1.10/live' } });
  expect(view.states[0]?.state).toBe('unknown');
  expect(JSON.stringify(view.states)).not.toContain('secret');
});
