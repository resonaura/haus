/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  allocateRoomId,
  assertUniqueRoomName,
  formatFallbackRoomName,
  normalizeRoomIcon,
  normalizeRoomName,
  normalizeTargetRoomId,
  UNASSIGNED_ROOM_ID,
  validateExplicitRoomId,
  type AtomicRoomMoveCoordinator,
  type DeviceRegistry,
  type HausAutomationRule,
  type HausDevice,
  type HausScene,
  type HausScript,
  type Room,
  type RoomMoveActor,
  type RoomMoveClientPatch,
  type RoomMoveRequest,
} from '@haus/core';
import type { LiveService } from '../live/types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';

export interface HomeRoomsDeps {
  readonly rooms: Map<string, Room>;
  readonly devices: DeviceRegistry;
  readonly roomCoordinator: AtomicRoomMoveCoordinator;
  readonly persistence: StandaloneHomePersistence;
  readonly scenes: Map<string, HausScene>;
  readonly scripts: Map<string, HausScript>;
  readonly automations: Map<string, HausAutomationRule>;
  readonly onAutomationUpdated: (rule: HausAutomationRule) => void;
  readonly publishDevices: () => void;
  readonly registerAlias: (alias: string, canonicalId: string) => Promise<void>;
  readonly liveService?: LiveService;
  readonly onConfigChanged?: (resourceId: string) => void;
}

export interface RoomDeleteResult {
  readonly deleted: true;
  readonly roomId: string;
  readonly movedDeviceIds: readonly string[];
  readonly updatedSceneIds: readonly string[];
}

function normalizeDeviceLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 120) {
    throw new Error('invalid_device_name');
  }
  return normalized;
}

/** Coordinates room CRUD, atomic device room assignments, and device renames on Standalone Hub. */
export class HomeRoomsManager {
  constructor(private readonly deps: HomeRoomsDeps) {}

  private resolveDeviceId(ref: string): string {
    if (this.deps.devices.getDevice(ref)) return ref;
    return this.deps.roomCoordinator.resolveAddressOrId(ref) ?? ref;
  }

  listRooms(): Room[] {
    return [...this.deps.rooms.values()]
      .filter((room) => room.id !== UNASSIGNED_ROOM_ID)
      .map((room) => ({ ...room }))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id),
      );
  }

  getRoom(roomId: string): Room | undefined {
    const room = this.deps.rooms.get(roomId);
    return room && room.id !== UNASSIGNED_ROOM_ID ? { ...room } : undefined;
  }

  ensureRoomForDevice(device: HausDevice): void {
    const roomId = device.roomId ?? device.areaId;
    if (!roomId || roomId === UNASSIGNED_ROOM_ID || this.deps.rooms.has(roomId)) return;
    const room: Room = { id: roomId, name: formatFallbackRoomName(roomId) };
    this.deps.rooms.set(roomId, room);
    void this.deps.roomCoordinator.registerRoom(room).catch(() => {});
    void this.deps.persistence.save('room', room.id, room).catch(() => {});
    this.deps.onConfigChanged?.(`room:${room.id}`);
    this.deps.liveService?.publish('rooms');
  }

  async createRoom(input: { id?: string; name: string; icon?: string }): Promise<Room> {
    const name = normalizeRoomName(input.name);
    assertUniqueRoomName(name, this.deps.rooms.values());
    const id =
      input.id !== undefined
        ? validateExplicitRoomId(input.id)
        : allocateRoomId(name, new Set(this.deps.rooms.keys()));
    if (this.deps.rooms.has(id)) {
      throw new Error('room_id_exists');
    }
    const icon = normalizeRoomIcon(input.icon);
    const room: Room = { id, name, ...(icon ? { icon } : {}) };
    this.deps.rooms.set(id, room);
    await this.deps.roomCoordinator.registerRoom(room);
    await this.deps.persistence.save('room', id, room);
    this.deps.onConfigChanged?.(`room:${id}`);
    this.deps.liveService?.publish('rooms');
    return { ...room };
  }

  async updateRoom(roomId: string, patch: { name?: string; icon?: string | null }): Promise<Room> {
    if (!roomId || roomId === UNASSIGNED_ROOM_ID) {
      throw new Error('invalid_room_id');
    }
    const existing = this.deps.rooms.get(roomId);
    if (!existing) {
      throw new Error('room_not_found');
    }

    const name = patch.name !== undefined ? normalizeRoomName(patch.name) : existing.name;
    if (patch.name !== undefined) {
      assertUniqueRoomName(name, this.deps.rooms.values(), roomId);
    }

    const icon =
      patch.icon === null || patch.icon === ''
        ? undefined
        : patch.icon !== undefined
          ? normalizeRoomIcon(patch.icon)
          : existing.icon;

    const updated: Room = { id: existing.id, name, ...(icon ? { icon } : {}) };
    this.deps.rooms.set(roomId, updated);
    await this.deps.roomCoordinator.registerRoom(updated);
    await this.deps.persistence.save('room', roomId, updated);
    this.deps.onConfigChanged?.(`room:${roomId}`);
    this.deps.liveService?.publish('rooms');
    return { ...updated };
  }

  async deleteRoom(roomId: string, actor: RoomMoveActor): Promise<RoomDeleteResult> {
    if (!roomId || roomId === UNASSIGNED_ROOM_ID) {
      throw new Error('cannot_delete_reserved_room');
    }
    if (!this.deps.rooms.has(roomId)) {
      throw new Error('room_not_found');
    }

    const affectedDevices = this.deps.devices.getDevicesByArea(roomId);
    const movedDeviceIds: string[] = [];
    for (const dev of affectedDevices) {
      await this.moveDeviceRoom({
        actor,
        deviceId: dev.id,
        targetRoomId: UNASSIGNED_ROOM_ID,
      });
      movedDeviceIds.push(dev.id);
    }

    const updatedSceneIds: string[] = [];
    for (const [sceneId, scene] of this.deps.scenes.entries()) {
      if (scene.roomId !== roomId) continue;
      const { roomId: _removed, ...rest } = scene;
      const nextScene: HausScene = { ...rest };
      this.deps.scenes.set(sceneId, nextScene);
      await this.deps.roomCoordinator.putScene(nextScene);
      await this.deps.persistence.save('scene', sceneId, nextScene);
      updatedSceneIds.push(sceneId);
    }

    this.deps.rooms.delete(roomId);
    await this.deps.persistence.remove('room', roomId);
    this.deps.onConfigChanged?.(`room:${roomId}`);
    this.deps.liveService?.publish('rooms');
    if (movedDeviceIds.length > 0) this.deps.publishDevices();
    if (updatedSceneIds.length > 0) this.deps.liveService?.publish('scenes');

    return {
      deleted: true,
      roomId,
      movedDeviceIds,
      updatedSceneIds,
    };
  }

  async moveDeviceRoom(request: Omit<RoomMoveRequest, 'homeId'>): Promise<RoomMoveClientPatch> {
    const resolvedId = this.resolveDeviceId(request.deviceId);
    const existing = this.deps.devices.getDevice(resolvedId);
    if (existing && !this.deps.roomCoordinator.getDevice(resolvedId)) {
      await this.deps.roomCoordinator.registerDevice(existing);
    }

    const targetRoomId = normalizeTargetRoomId(request.targetRoomId);
    let createdRoom = false;
    if (targetRoomId === UNASSIGNED_ROOM_ID) {
      await this.deps.roomCoordinator.registerRoom({
        id: UNASSIGNED_ROOM_ID,
        name: 'Unassigned',
      });
    } else if (!this.deps.rooms.has(targetRoomId)) {
      const room: Room = {
        id: targetRoomId,
        name: formatFallbackRoomName(targetRoomId),
      };
      this.deps.rooms.set(targetRoomId, room);
      await this.deps.roomCoordinator.registerRoom(room);
      await this.deps.persistence.save('room', room.id, room);
      createdRoom = true;
    } else {
      await this.deps.roomCoordinator.registerRoom(this.deps.rooms.get(targetRoomId)!);
    }

    const patch = await this.deps.roomCoordinator.moveDeviceToRoom({
      ...request,
      deviceId: resolvedId,
      targetRoomId,
      homeId: 'haus-home',
    });

    const updated = this.deps.roomCoordinator.getDevice(resolvedId);
    if (updated) {
      this.deps.devices.registerDevice(updated);
      await this.deps.persistence.save('device', updated.id, updated);
    }

    for (const id of patch.updatedSceneIds) {
      const scene = this.deps.roomCoordinator.getScene(id);
      if (scene) {
        const cleaned =
          targetRoomId === UNASSIGNED_ROOM_ID && scene.roomId === UNASSIGNED_ROOM_ID
            ? (({ roomId: _omit, ...rest }: HausScene) => rest)(scene)
            : scene;
        this.deps.scenes.set(id, cleaned);
        await this.deps.persistence.save('scene', id, cleaned);
      }
    }
    for (const id of patch.updatedScriptIds) {
      const script = this.deps.roomCoordinator.getScript(id);
      if (script) {
        this.deps.scripts.set(id, script);
        await this.deps.persistence.save('script', id, script);
      }
    }
    for (const id of patch.updatedAutomationIds) {
      const rule = this.deps.roomCoordinator.getAutomation(id);
      if (rule) {
        this.deps.automations.set(id, rule);
        this.deps.onAutomationUpdated(rule);
        await this.deps.persistence.save('automation', id, rule);
      }
    }

    if (createdRoom) this.deps.liveService?.publish('rooms');
    if (patch.updatedSceneIds.length > 0) this.deps.liveService?.publish('scenes');
    this.deps.onConfigChanged?.(`room-move:${request.deviceId}`);
    this.deps.publishDevices();
    return patch;
  }

  async updateDevice(
    deviceId: string,
    patch: { name?: string; roomId?: string | null },
    actor: RoomMoveActor,
  ): Promise<HausDevice> {
    const resolvedId = this.resolveDeviceId(deviceId);
    const existing = this.deps.devices.getDevice(resolvedId);
    if (!existing) {
      throw new Error('device_not_found');
    }

    const nextName = patch.name !== undefined ? normalizeDeviceLabel(patch.name) : undefined;
    const hasRoomPatch = patch.roomId !== undefined;
    const targetRoomId = hasRoomPatch ? normalizeTargetRoomId(patch.roomId) : undefined;

    if (
      targetRoomId !== undefined &&
      targetRoomId !== UNASSIGNED_ROOM_ID &&
      !this.deps.rooms.has(targetRoomId)
    ) {
      throw new Error('target_room_not_found');
    }

    if (targetRoomId !== undefined && targetRoomId !== (existing.roomId ?? UNASSIGNED_ROOM_ID)) {
      await this.moveDeviceRoom({ actor, deviceId: resolvedId, targetRoomId });
    }

    if (nextName !== undefined) {
      const latest = this.deps.devices.getDevice(resolvedId) ?? existing;
      const priorCoord = this.deps.roomCoordinator.getDevice(resolvedId);
      const oldAddresses = (priorCoord?.endpoints ?? latest.endpoints).map((ep) => ({
        id: ep.id,
        address: ep.address,
      }));
      const renamed = this.deps.devices.updateDevice(resolvedId, { name: nextName }) ?? {
        ...latest,
        name: nextName,
      };
      const coordUpdated = await this.deps.roomCoordinator.registerDevice(renamed);
      for (const oldEp of oldAddresses) {
        if (!oldEp.address) continue;
        const currentAddr = coordUpdated.endpoints.find((ep) => ep.id === oldEp.id)?.address;
        if (currentAddr !== oldEp.address) {
          await this.deps.registerAlias(oldEp.address, oldEp.id);
        }
      }
      const synced = this.deps.devices.registerDevice({
        ...renamed,
        endpoints: coordUpdated.endpoints,
      });
      await this.deps.persistence.save('device', resolvedId, synced);
    }

    await this.deps.persistence.flush();
    this.deps.onConfigChanged?.(`device:${resolvedId}`);
    this.deps.publishDevices();
    return this.deps.devices.getDevice(resolvedId)!;
  }
}
