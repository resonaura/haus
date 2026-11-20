/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import {
  AtomicRoomMoveCoordinator,
  InMemoryRoomMoveRepository,
  onOffCapability,
  type HausDevice,
  type RoomMoveRepository,
} from '../../src/index.js';

function device(id: string, name = id, roomId = 'living-room'): HausDevice {
  return {
    id,
    name,
    roomId,
    category: 'lighting',
    availability: 'online',
    source: { instanceId: 'fixture', externalId: id },
    endpoints: [
      { id: id + '-main', name: 'Main', category: 'lighting', capabilities: [onOffCapability] },
    ],
  };
}

describe('incremental room identity registration', () => {
  it('does not rewrite unchanged aliases or rules while retaining real save failures', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home', repo);
    const scene = { id: 'scene', name: 'Evening', members: [] };
    await coordinator.registerDevice(device('lamp'));
    await coordinator.registerAlias('old-lamp', 'lamp');
    await coordinator.putScene(scene);
    repo.injectNextSaveFailure(Error('storage_failure'));
    await coordinator.registerAlias('old-lamp', 'lamp');
    await coordinator.putScene(structuredClone(scene));
    await expect(coordinator.putScene({ ...scene, name: 'Changed' })).rejects.toThrow(
      'storage_failure',
    );
    expect((await repo.load('home'))?.scenes.scene.name).toBe('Evening');
  });

  it('produces the same complete snapshot as full saves across registration, rename and room changes', async () => {
    const fastRepo = new InMemoryRoomMoveRepository();
    const slowRepo = new InMemoryRoomMoveRepository();
    const legacy: RoomMoveRepository = {
      load: (id) => slowRepo.load(id),
      save: (state) => slowRepo.save(state),
    };
    const fast = new AtomicRoomMoveCoordinator('home', fastRepo);
    const slow = new AtomicRoomMoveCoordinator('home', legacy);
    for (const coordinator of [fast, slow]) {
      await coordinator.registerRoom({ id: 'living-room', name: 'Living Room' });
      await coordinator.putScene({ id: 'scene', name: 'Evening', members: [] });
      await coordinator.registerDevice(device('retained'));
      await coordinator.registerAlias('legacy-lamp', 'lamp');
    }
    const updates = [
      device('lamp'),
      device('lamp', 'Reading Lamp'),
      device('lamp', 'Reading Lamp', 'office'),
    ];
    for (const update of updates) {
      await fast.registerDevice(update);
      await slow.registerDevice(update);
      expect(await fastRepo.load('home')).toEqual(await slowRepo.load('home'));
    }
    expect(fast.resolveAddressOrId('legacy-lamp')).toBe('lamp');
  });

  it('keeps both stored and active identities unchanged if registration fails', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home', repo);
    await coordinator.registerDevice(device('lamp'));
    const before = await repo.load('home');
    repo.injectNextSaveFailure(Error('storage_failure'));
    await expect(coordinator.registerDevice(device('lamp', 'Renamed', 'office'))).rejects.toThrow(
      'storage_failure',
    );
    expect(await repo.load('home')).toEqual(before);
    expect(coordinator.getDevice('lamp')?.name).toBe('lamp');
    await coordinator.registerDevice(device('lamp', 'Renamed', 'office'));
    expect(coordinator.getDevice('lamp')?.name).toBe('Renamed');
  });

  it('isolates the registration snapshot from caller and reader mutations', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home', repo);
    await coordinator.registerDevice(device('other'));
    const input = device('lamp');
    const returned = await coordinator.registerDevice(input);
    input.endpoints[0].name = 'Changed input';
    returned.name = 'Changed result';
    const loaded = await repo.load('home');
    expect(loaded?.devices.lamp.name).toBe('lamp');
    expect(loaded?.devices.lamp.endpoints[0].name).toBe('Main');
    if (loaded) loaded.devices.lamp.name = 'Changed reader';
    expect((await repo.load('home'))?.devices.lamp.name).toBe('lamp');
  });
});
