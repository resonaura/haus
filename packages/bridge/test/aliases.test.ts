/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expect, it } from 'vitest';
import { validateInventory } from '../src/protocol.js';

const inventory = {
  version: 2,
  provider: 'aqara',
  bridgeId: '88888888-1111-2222-3333-444444444444',
  cameras: [
    {
      id: 'camera',
      name: 'Camera',
      manufacturer: 'Aqara',
      model: 'G5',
      identifiers: ['physical'],
      available: true,
      mqtt: { uniqueId: 'physical_camera_exact' },
      stream: { url: 'rtsp://192.168.1.10/live', transport: 'p2p' },
      snapshotPath: '/api/cameras/camera/snapshot/last-live',
      entities: [
        {
          id: 'status',
          name: 'Status',
          domain: 'switch',
          available: true,
          state: false,
          updatedAt: 1000,
          mqtt: { uniqueId: 'physical_status_exact' },
        },
      ],
    },
  ],
};

it('preserves exact optional MQTT aliases without accepting invalid metadata or duplicate entity aliases', () => {
  expect(validateInventory(inventory).cameras[0]?.entities[0]?.mqtt).toEqual({
    uniqueId: 'physical_status_exact',
  });
  for (const mqtt of [
    { uniqueId: '' },
    { uniqueId: 'x', topic: 'untrusted' },
    { uniqueId: 42 },
    { uniqueId: 'x\n' },
  ]) {
    const changed = structuredClone(inventory);
    Object.assign(changed.cameras[0] ?? {}, { mqtt });
    expect(() => validateInventory(changed)).toThrow('invalid_bridge_inventory');
  }
  const changed = structuredClone(inventory);
  const camera = changed.cameras[0];
  if (!camera || !camera.entities[0]) throw Error('fixture_camera_missing');
  camera.entities.push({ ...camera.entities[0], id: 'duplicate' });
  expect(() => validateInventory(changed)).toThrow('invalid_bridge_inventory');
});
