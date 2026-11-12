/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Room } from '../types.js';
import type { HausDevice, HausEndpoint } from '../device/types.js';
import type { HausAutomationRule, HausScene, HausScript } from '../automation/types.js';
import { InMemoryRoomMoveRepository } from './memory.js';
export { InMemoryRoomMoveRepository } from './memory.js';
import { formatAddress, parseAddress } from './address.js';
import { isValidGlobalDomain } from './domains.js';
import { rewriteAllReferences, slugifySegment } from './rewrites.js';
import type {
  ArchiveRecordingRecord,
  HausDeviceGroup,
  HistoricalEventRecord,
  PendingProviderRoomSync,
  RoomMoveActor,
  RoomMoveClientPatch,
  RoomMovePersistenceState,
  RoomMoveRepository,
  RoomMoveRequest,
} from './types.js';

export type * from './types.js';

export class AtomicRoomMoveCoordinator {
  private state: RoomMovePersistenceState;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(patch: RoomMoveClientPatch) => void>();
  private physicalActionCount = 0;

  constructor(
    readonly homeId: string,
    private readonly repository: RoomMoveRepository = new InMemoryRoomMoveRepository(),
  ) {
    this.state = {
      homeId,
      revision: 1,
      rooms: {},
      devices: {},
      primaryAddresses: {},
      aliasToCanonical: {},
      scenes: {},
      scripts: {},
      automations: {},
      groups: {},
      history: [],
      archives: [],
      pendingProviderSyncs: {},
    };
  }

  async initialize(): Promise<void> {
    const loaded = await this.repository.load(this.homeId);
    if (loaded) {
      this.state = structuredClone(loaded);
    }
  }

  getRevision(): number {
    return this.state.revision;
  }

  getPhysicalActionCount(): number {
    return this.physicalActionCount;
  }

  subscribe(listener: (patch: RoomMoveClientPatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async registerRoom(room: Room): Promise<Room> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.rooms[room.id] = room;
      await this.repository.save(next);
      this.state = next;
      return room;
    });
  }

  async registerDevice(device: HausDevice): Promise<HausDevice> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      const rawRoomId = device.roomId ?? device.areaId ?? 'default';
      if (!next.rooms[rawRoomId]) next.rooms[rawRoomId] = { id: rawRoomId, name: rawRoomId };
      const roomSlug = slugifySegment(rawRoomId);
      const devSlug = slugifySegment(device.name || device.id);
      const devDomain = slugifySegment(device.category || 'generic');
      if (!isValidGlobalDomain(devDomain)) throw new Error('invalid_global_domain');

      let devAddr = formatAddress({ type: devDomain, area: roomSlug, device: devSlug });
      let owner = next.aliasToCanonical[devAddr];
      if (owner && owner !== device.id) {
        devAddr = formatAddress({
          type: devDomain,
          area: roomSlug,
          device: `${devSlug}-${slugifySegment(device.id)}`,
        });
        owner = next.aliasToCanonical[devAddr];
        if (owner && owner !== device.id) throw new Error('identity_address_conflict');
      }
      next.primaryAddresses[device.id] = devAddr;
      next.aliasToCanonical[devAddr] = device.id;

      const updatedEndpoints: HausEndpoint[] = device.endpoints.map((ep) => {
        const epDomain = slugifySegment(
          ep.address?.split('::')[0] ?? ep.category ?? device.category,
        );
        if (!isValidGlobalDomain(epDomain)) throw new Error('invalid_global_domain');
        const parsedExisting = ep.address ? parseAddress(ep.address) : undefined;
        let epAddr = parsedExisting
          ? formatAddress({ ...parsedExisting, area: roomSlug })
          : formatAddress({
              type: epDomain,
              area: roomSlug,
              device: devSlug,
              entity: slugifySegment(ep.id),
            });
        let epOwner = next.aliasToCanonical[epAddr];
        if (epOwner && epOwner !== ep.id) {
          epAddr = formatAddress({
            type: epDomain,
            area: roomSlug,
            device: devSlug,
            entity: `${slugifySegment(ep.id)}-${slugifySegment(device.id)}`,
          });
          epOwner = next.aliasToCanonical[epAddr];
          if (epOwner && epOwner !== ep.id) throw new Error('identity_address_conflict');
        }
        next.primaryAddresses[ep.id] = epAddr;
        next.aliasToCanonical[epAddr] = ep.id;
        return { ...ep, roomId: rawRoomId, address: epAddr };
      });

      const normalized: HausDevice = {
        ...device,
        roomId: rawRoomId,
        areaId: rawRoomId,
        endpoints: updatedEndpoints,
      };
      next.devices[normalized.id] = normalized;
      await this.repository.save(next);
      this.state = next;
      return normalized;
    });
  }

  async putScene(scene: HausScene): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.scenes[scene.id] = scene;
      await this.repository.save(next);
      this.state = next;
    });
  }

  async putScript(script: HausScript): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.scripts[script.id] = script;
      await this.repository.save(next);
      this.state = next;
    });
  }

  async putAutomation(rule: HausAutomationRule): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.automations[rule.id] = rule;
      await this.repository.save(next);
      this.state = next;
    });
  }

  async removeAutomation(ruleId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!(ruleId in this.state.automations)) return;
      const next = structuredClone(this.state);
      delete next.automations[ruleId];
      await this.repository.save(next);
      this.state = next;
    });
  }

  async putGroup(group: HausDeviceGroup): Promise<void> {
    return this.enqueue(async () => {
      if (!isValidGlobalDomain(group.domain)) {
        throw new Error('invalid_global_domain');
      }
      const next = structuredClone(this.state);
      next.groups[group.id] = group;
      await this.repository.save(next);
      this.state = next;
    });
  }

  async recordHistoryEvent(event: HistoricalEventRecord): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.history.push(event);
      await this.repository.save(next);
      this.state = next;
    });
  }

  async recordArchive(archive: ArchiveRecordingRecord): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.archives.push(archive);
      await this.repository.save(next);
      this.state = next;
    });
  }

  private assertPermission(actor: RoomMoveActor, fromRoomId: string, toRoomId: string): void {
    const canWrite =
      actor.role === 'owner' ||
      actor.role === 'admin' ||
      actor.permissions?.includes('home:write') === true ||
      actor.permissions?.includes('rooms:move') === true;
    if (!canWrite) {
      throw new Error('room_move_permission_denied');
    }
    if (actor.allowedRoomIds) {
      if (!actor.allowedRoomIds.includes(fromRoomId) || !actor.allowedRoomIds.includes(toRoomId)) {
        throw new Error('room_move_permission_denied');
      }
    }
  }

  moveDeviceToRoom(request: RoomMoveRequest): Promise<RoomMoveClientPatch> {
    return this.enqueue(async () => {
      if (
        request.expectedRevision !== undefined &&
        request.expectedRevision !== this.state.revision
      ) {
        throw new Error('stale_client_revision');
      }

      const device = this.state.devices[request.deviceId];
      if (!device) {
        throw new Error('device_not_found');
      }
      if (!this.state.rooms[request.targetRoomId]) {
        throw new Error('target_room_not_found');
      }

      const fromRoomId = device.roomId ?? device.areaId ?? 'default';
      const toRoomId = request.targetRoomId;
      this.assertPermission(request.actor, fromRoomId, toRoomId);

      const next = structuredClone(this.state);
      const targetAreaSlug = slugifySegment(toRoomId);
      const baseDeviceSlug = slugifySegment(device.name || device.id);
      const devDomain = slugifySegment(device.category || 'generic');
      const policy = request.collisionPolicy ?? 'reject';

      let chosenDeviceSlug = baseDeviceSlug;
      const candidateDevAddr = formatAddress({
        type: devDomain,
        area: targetAreaSlug,
        device: chosenDeviceSlug,
      });
      const existingDevOwner = next.aliasToCanonical[candidateDevAddr];
      if (existingDevOwner && existingDevOwner !== device.id) {
        if (policy === 'reject') {
          throw new Error('identity_address_conflict');
        }
        let suffix = 2;
        while (suffix < 1000) {
          const suffixedSlug = `${baseDeviceSlug}-${suffix}`;
          const suffixedAddr = formatAddress({
            type: devDomain,
            area: targetAreaSlug,
            device: suffixedSlug,
          });
          const owner = next.aliasToCanonical[suffixedAddr];
          if (!owner || owner === device.id) {
            chosenDeviceSlug = suffixedSlug;
            break;
          }
          suffix++;
        }
      }

      const newDevAddr = formatAddress({
        type: devDomain,
        area: targetAreaSlug,
        device: chosenDeviceSlug,
      });
      const oldDevAddr = next.primaryAddresses[device.id];
      const rewrites = new Map<string, string>();
      if (oldDevAddr && oldDevAddr !== newDevAddr) {
        rewrites.set(oldDevAddr, newDevAddr);
      }
      next.primaryAddresses[device.id] = newDevAddr;
      next.aliasToCanonical[newDevAddr] = device.id;

      const updatedEndpoints: HausEndpoint[] = device.endpoints.map((ep) => {
        const oldEpAddr = ep.address ?? next.primaryAddresses[ep.id];
        const parsedOld = oldEpAddr ? parseAddress(oldEpAddr) : undefined;
        const epType = parsedOld?.type ?? slugifySegment(ep.category ?? device.category);
        const epEntity = parsedOld?.entity ?? slugifySegment(ep.id);
        const newEpAddr = formatAddress({
          type: epType,
          area: targetAreaSlug,
          device: chosenDeviceSlug,
          entity: epEntity,
        });
        const epOwner = next.aliasToCanonical[newEpAddr];
        if (epOwner && epOwner !== ep.id) {
          throw new Error('identity_address_conflict');
        }
        if (oldEpAddr && oldEpAddr !== newEpAddr) {
          rewrites.set(oldEpAddr, newEpAddr);
        }
        next.primaryAddresses[ep.id] = newEpAddr;
        next.aliasToCanonical[newEpAddr] = ep.id;
        return {
          ...ep,
          roomId: toRoomId,
          address: newEpAddr,
        };
      });

      next.devices[device.id] = {
        ...device,
        id: device.id,
        roomId: toRoomId,
        areaId: toRoomId,
        endpoints: updatedEndpoints,
      };

      const { updatedSceneIds, updatedScriptIds, updatedAutomationIds, updatedGroupIds } =
        rewriteAllReferences(
          next.scenes,
          next.scripts,
          next.automations,
          next.groups,
          rewrites,
          device.id,
          fromRoomId,
          toRoomId,
        );

      const providerSyncStatus =
        device.availability === 'offline' ? 'queued_offline' : 'synced_online';
      if (providerSyncStatus === 'queued_offline') {
        next.pendingProviderSyncs[device.id] = {
          deviceId: device.id,
          providerInstanceId: device.source.instanceId,
          targetRoomId: toRoomId,
          queuedAt: new Date().toISOString(),
        };
      } else {
        delete next.pendingProviderSyncs[device.id];
      }

      next.revision = this.state.revision + 1;

      await this.repository.save(next);
      this.state = next;

      const retainedAliases = Object.entries(this.state.aliasToCanonical)
        .filter(
          ([addr, id]) =>
            (id === device.id || device.endpoints.some((ep) => ep.id === id)) &&
            this.state.primaryAddresses[id] !== addr,
        )
        .map(([addr]) => addr);

      const patch: RoomMoveClientPatch = {
        homeId: this.homeId,
        revision: this.state.revision,
        deviceId: device.id,
        canonicalIdPreserved: true,
        physicalCommandsDispatched: 0,
        fromRoomId,
        toRoomId,
        addressRewrites: Object.fromEntries(rewrites.entries()),
        retainedAliases,
        updatedSceneIds,
        updatedAutomationIds,
        updatedScriptIds,
        updatedGroupIds,
        providerSyncStatus,
      };

      for (const listener of this.listeners) {
        listener(patch);
      }
      return patch;
    });
  }

  async reconcileProviderReconnect(providerInstanceId: string): Promise<readonly string[]> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      const syncedDeviceIds: string[] = [];
      for (const [devId, pending] of Object.entries(next.pendingProviderSyncs)) {
        if (pending.providerInstanceId === providerInstanceId) {
          syncedDeviceIds.push(devId);
          delete next.pendingProviderSyncs[devId];
          const dev = next.devices[devId];
          if (dev) {
            next.devices[devId] = { ...dev, availability: 'online' };
          }
        }
      }
      await this.repository.save(next);
      this.state = next;
      return syncedDeviceIds;
    });
  }

  async registerAlias(alias: string, canonicalId: string): Promise<void> {
    return this.enqueue(async () => {
      const next = structuredClone(this.state);
      next.aliasToCanonical[alias] = canonicalId;
      await this.repository.save(next);
      this.state = next;
    });
  }

  resolveAddressOrId(addressOrCanonicalId: string): string | undefined {
    if (this.state.devices[addressOrCanonicalId]) return addressOrCanonicalId;
    for (const dev of Object.values(this.state.devices)) {
      if (dev.endpoints.some((ep) => ep.id === addressOrCanonicalId)) {
        return addressOrCanonicalId;
      }
    }
    return this.state.aliasToCanonical[addressOrCanonicalId];
  }

  getPrimaryAddress(canonicalId: string): string | undefined {
    return this.state.primaryAddresses[canonicalId];
  }

  getDevice(deviceId: string): HausDevice | undefined {
    return this.state.devices[deviceId];
  }

  getScene(sceneId: string): HausScene | undefined {
    return this.state.scenes[sceneId];
  }

  getScript(scriptId: string): HausScript | undefined {
    return this.state.scripts[scriptId];
  }

  getAutomation(ruleId: string): HausAutomationRule | undefined {
    return this.state.automations[ruleId];
  }

  getGroup(groupId: string): HausDeviceGroup | undefined {
    return this.state.groups[groupId];
  }

  getHistoryForCanonicalId(canonicalId: string): readonly HistoricalEventRecord[] {
    return this.state.history.filter(
      (h) =>
        h.canonicalId === canonicalId || this.resolveAddressOrId(h.recordedAddress) === canonicalId,
    );
  }

  getArchivesForCanonicalCamera(canonicalCameraId: string): readonly ArchiveRecordingRecord[] {
    return this.state.archives.filter(
      (a) =>
        a.canonicalCameraId === canonicalCameraId ||
        this.resolveAddressOrId(a.recordedAddress) === canonicalCameraId,
    );
  }

  getPendingProviderSyncs(): readonly PendingProviderRoomSync[] {
    return Object.values(this.state.pendingProviderSyncs);
  }
}
