/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { RoomMoveRepository, RoomMovePersistenceState } from './types.js';

export class InMemoryRoomMoveRepository implements RoomMoveRepository {
  private readonly states = new Map<string, RoomMovePersistenceState>();
  private failNextSaveError?: Error;

  injectNextSaveFailure(error: Error): void {
    this.failNextSaveError = error;
  }

  async load(homeId: string): Promise<RoomMovePersistenceState | undefined> {
    const state = this.states.get(homeId);
    return state ? structuredClone(state) : undefined;
  }

  private checkFailure(): void {
    if (this.failNextSaveError) {
      const err = this.failNextSaveError;
      this.failNextSaveError = undefined;
      throw err;
    }
  }

  async save(state: RoomMovePersistenceState): Promise<void> {
    this.checkFailure();
    this.states.set(state.homeId, JSON.parse(JSON.stringify(state)) as RoomMovePersistenceState);
  }

  async saveDeviceRegistration(state: RoomMovePersistenceState, deviceId: string): Promise<void> {
    const saved = this.states.get(state.homeId);
    if (!saved) return this.save(state);
    this.checkFailure();
    const device = state.devices[deviceId];
    if (!device) throw Error('device_registration_missing');
    const copy = JSON.parse(JSON.stringify(device)) as typeof device;
    const ids = [deviceId, ...device.endpoints.map((endpoint) => endpoint.id)];
    const addresses = ids.map((id) => [id, state.primaryAddresses[id]] as const);
    if (addresses.some(([, address]) => !address)) throw Error('device_address_missing');
    // Build every potentially throwing copy before publishing the registration.
    const room = state.rooms[device.roomId ?? device.areaId ?? 'default'];
    const roomCopy = room ? structuredClone(room) : undefined;
    saved.devices[deviceId] = copy;
    saved.revision = state.revision;
    if (roomCopy) saved.rooms[roomCopy.id] = roomCopy;
    for (const [id, address] of addresses) {
      saved.primaryAddresses[id] = address;
      saved.aliasToCanonical[address] = state.aliasToCanonical[address];
    }
  }
}
