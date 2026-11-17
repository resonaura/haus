/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import { contactCapability, type HausDevice } from '@haus/core';
import { HapEncryptedSession, type HapPairingRecord } from '@haus/homekit';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { HomeKitControllerService } from '../../src/homekit/service.js';

it('keeps the Haus name and room when a paired HomeKit device publishes its topology again', async () => {
  const home = new StandaloneHomeService();
  const controller = new HomeKitControllerService(home);
  const pairing: HapPairingRecord = {
    accessoryId: '11:22:33:44:55:66',
    address: '127.0.0.1',
    port: 12345,
    controllerId: 'fixture-controller',
    controllerLtsk: '00'.repeat(64),
    controllerLtpk: '00'.repeat(32),
    accessoryLtpk: '00'.repeat(32),
  };
  const source: HausDevice = {
    id: 'homekit-fixture-door',
    name: 'Contact Sensor 1',
    source: { instanceId: 'haus-homekit', externalId: 'fixture-serial' },
    category: 'environmental_sensors',
    roomId: 'unassigned',
    availability: 'online',
    connectivity: { protocol: 'homekit' },
    endpoints: [{ id: 'fixture-door', name: 'Door', capabilities: [contactCapability], readings: {} }],
  };
  await home.roomManager.createRoom({ id: 'bedroom', name: 'Bedroom' });
  home.registerDevice({ ...source, availability: 'offline' });
  await home.roomManager.updateDevice(
    source.id,
    { name: 'Bedroom Exterior Door', roomId: 'bedroom' },
    { actorId: 'fixture', role: 'admin' },
  );
  const connect = vi.spyOn(controller.client, 'pairNetworkAccessory').mockResolvedValue({
    pairing,
    session: new HapEncryptedSession(pairing),
    topology: {
      devices: [source],
      initialStates: new Map([['fixture-door', { state: 'closed', contact: true }]]),
      bindings: [],
    },
  });
  try {
    await controller.pairAccessory({ accessoryId: pairing.accessoryId, pin: '111-22-333' });
    expect(home.getDevice(source.id)).toMatchObject({
      name: 'Bedroom Exterior Door',
      roomId: 'bedroom',
      availability: 'online',
      source: source.source,
    });
    await vi.waitFor(() => {
      expect(home.getEndpointState('fixture-door')).toMatchObject({ contact: true });
    });
  } finally {
    connect.mockRestore();
    await controller.onApplicationShutdown();
    await home.onModuleDestroy();
  }
});
