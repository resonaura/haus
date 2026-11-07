/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  AtomicRoomMoveCoordinator,
  ConditionOperator,
  InMemoryRoomMoveRepository,
  OWNED_GLOBAL_DOMAINS,
  assertValidGlobalDomain,
  classifyDomain,
  formatDomainAddress,
  isExtensionDomain,
  isOwnedDomain,
  isValidGlobalDomain,
  onOffCapability,
  parseDomainAddress,
  type HausAutomationRule,
  type HausDevice,
  type HausScene,
  type HausScript,
  type RoomMoveClientPatch,
} from '../../src/index.js';

describe('Global Domains & Address Validation (P16.3)', () => {
  it('validates owned global domains and vendor x-<vendor>-<domain> extension domains', () => {
    for (const domain of OWNED_GLOBAL_DOMAINS) {
      expect(isOwnedDomain(domain)).toBe(true);
      expect(isValidGlobalDomain(domain)).toBe(true);
      expect(classifyDomain(domain)).toBe('owned');
    }

    for (const ext of ['x-apple-adaptive-lighting', 'x-tuya-mmwave-radar', 'x-scrypted-ptz']) {
      expect(isExtensionDomain(ext)).toBe(true);
      expect(isOwnedDomain(ext)).toBe(false);
      expect(isValidGlobalDomain(ext)).toBe(true);
      expect(classifyDomain(ext)).toBe('extension');
    }

    for (const invalid of ['unknown-domain', 'x-onlyone', 'x-', 'Light', 'bad_domain', '']) {
      expect(isValidGlobalDomain(invalid)).toBe(false);
      expect(classifyDomain(invalid)).toBe('invalid');
      expect(() => assertValidGlobalDomain(invalid)).toThrow('invalid_global_domain');
    }
  });

  it('parses and formats addresses strictly against owned and extension domains', () => {
    const ownedAddr = 'lighting::living-room:floor-lamp:main';
    expect(parseDomainAddress(ownedAddr)).toEqual({
      type: 'lighting',
      area: 'living-room',
      device: 'floor-lamp',
      entity: 'main',
    });
    expect(
      formatDomainAddress({
        type: 'x-aqara-fp2',
        area: 'kitchen',
        device: 'presence-sensor',
        entity: 'zone-1',
      }),
    ).toBe('x-aqara-fp2::kitchen:presence-sensor:zone-1');

    expect(parseDomainAddress('unregistered::living-room:floor-lamp:main')).toBeUndefined();
    expect(() =>
      formatDomainAddress({
        type: 'unregistered',
        area: 'living-room',
        device: 'floor-lamp',
      }),
    ).toThrow('invalid_global_domain');
  });
});

describe('Atomic Room Moves (P16.3)', () => {
  const ownerActor = {
    actorId: 'user-owner',
    role: 'owner' as const,
  };

  function makeLampDevice(
    id = 'dev-lamp-1',
    name = 'Floor Lamp',
    roomId = 'living-room',
    availability: 'online' | 'offline' = 'online',
  ): HausDevice {
    return {
      id,
      source: { instanceId: 'zigbee-main', externalId: `ieee-${id}` },
      name,
      category: 'lighting',
      roomId,
      areaId: roomId,
      connectivity: { protocol: 'zigbee' },
      availability,
      endpoints: [
        {
          id: `${id}-main`,
          name: 'Main Bulb',
          category: 'lighting',
          capabilities: [onOffCapability],
          readings: {},
        },
      ],
    };
  }

  it('atomically updates scenes, automations, scripts, and groups immediately while preserving canonical IDs and retained aliases', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home-1', repo);
    await coordinator.initialize();

    await coordinator.registerRoom({ id: 'living-room', name: 'Living Room' });
    await coordinator.registerRoom({ id: 'bedroom', name: 'Bedroom' });

    const registered = await coordinator.registerDevice(makeLampDevice());
    const oldEpAddr = registered.endpoints[0]!.address!;
    expect(oldEpAddr).toBe('lighting::living-room:floor-lamp:dev-lamp-1-main');

    const scene: HausScene = {
      schemaVersion: 1,
      id: 'scene-evening',
      name: 'Evening Relax',
      roomId: 'living-room',
      members: [
        {
          endpointId: oldEpAddr,
          targetState: { on_off: true, brightness: 40 },
        },
      ],
    };
    await coordinator.putScene(scene);

    const script: HausScript = {
      schemaVersion: 1,
      id: 'script-bedtime',
      name: 'Bedtime Sequence',
      steps: [
        {
          type: 'sequence',
          steps: [
            {
              type: 'condition',
              condition: {
                type: 'state',
                endpointId: oldEpAddr,
                property: 'on_off',
                operator: ConditionOperator.Equals,
                value: true,
              },
            },
            {
              type: 'choose',
              branches: [
                {
                  conditions: [
                    {
                      type: 'state',
                      endpointId: oldEpAddr,
                      property: 'on_off',
                      operator: ConditionOperator.Equals,
                      value: true,
                    },
                  ],
                  steps: [
                    {
                      type: 'action',
                      action: {
                        kind: 'device_command',
                        payload: {
                          endpointId: oldEpAddr,
                          capability: 'on_off',
                          command: 'turn_off',
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    await coordinator.putScript(script);

    const automation: HausAutomationRule = {
      schemaVersion: 1,
      id: 'rule-night-off',
      name: 'Auto Off Lamp',
      enabled: true,
      triggers: [
        {
          type: 'state',
          endpointId: oldEpAddr,
          property: 'on_off',
          to: true,
        },
      ],
      conditions: [
        {
          type: 'and',
          conditions: [
            {
              type: 'state',
              endpointId: oldEpAddr,
              property: 'on_off',
              operator: ConditionOperator.Equals,
              value: true,
            },
          ],
        },
      ],
      actions: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: oldEpAddr,
              capability: 'on_off',
              command: 'turn_off',
            },
          },
        },
      ],
    };
    await coordinator.putAutomation(automation);

    await coordinator.putGroup({
      id: 'group-lamps',
      name: 'Room Lamps',
      domain: 'lighting',
      roomId: 'living-room',
      memberDeviceIds: ['dev-lamp-1'],
      memberAddresses: [oldEpAddr],
    });

    const patches: RoomMoveClientPatch[] = [];
    coordinator.subscribe((p) => patches.push(p));

    const patch = await coordinator.moveDeviceToRoom({
      homeId: 'home-1',
      deviceId: 'dev-lamp-1',
      targetRoomId: 'bedroom',
      actor: ownerActor,
    });

    const newEpAddr = 'lighting::bedroom:floor-lamp:dev-lamp-1-main';
    expect(patch.canonicalIdPreserved).toBe(true);
    expect(patch.physicalCommandsDispatched).toBe(0);
    expect(coordinator.getPhysicalActionCount()).toBe(0);
    expect(patch.fromRoomId).toBe('living-room');
    expect(patch.toRoomId).toBe('bedroom');
    expect(patch.addressRewrites[oldEpAddr]).toBe(newEpAddr);
    expect(patch.retainedAliases).toContain(oldEpAddr);
    expect(patch.updatedSceneIds).toEqual(['scene-evening']);
    expect(patch.updatedScriptIds).toEqual(['script-bedtime']);
    expect(patch.updatedAutomationIds).toEqual(['rule-night-off']);
    expect(patch.updatedGroupIds).toEqual(['group-lamps']);
    expect(patches).toHaveLength(1);

    // Canonical identity is unchanged, and both old alias and new primary address resolve to it
    const movedDevice = coordinator.getDevice('dev-lamp-1')!;
    expect(movedDevice.id).toBe('dev-lamp-1');
    expect(movedDevice.roomId).toBe('bedroom');
    expect(movedDevice.endpoints[0]!.id).toBe('dev-lamp-1-main');
    expect(movedDevice.endpoints[0]!.address).toBe(newEpAddr);
    expect(coordinator.resolveAddressOrId(oldEpAddr)).toBe('dev-lamp-1-main');
    expect(coordinator.resolveAddressOrId(newEpAddr)).toBe('dev-lamp-1-main');

    // Scene, script, automation, and group references updated immediately
    expect(coordinator.getScene('scene-evening')?.members[0]?.endpointId).toBe(newEpAddr);
    expect(coordinator.getScene('scene-evening')?.roomId).toBe('bedroom');
    expect(coordinator.getGroup('group-lamps')?.memberAddresses).toEqual([newEpAddr]);
    expect(coordinator.getGroup('group-lamps')?.roomId).toBe('bedroom');

    const updatedRule = coordinator.getAutomation('rule-night-off')!;
    expect(updatedRule.triggers[0]).toMatchObject({ endpointId: newEpAddr });
    const updatedScript = coordinator.getScript('script-bedtime')!;
    expect(JSON.stringify(updatedScript.steps)).toContain(newEpAddr);
    expect(JSON.stringify(updatedScript.steps)).not.toContain(oldEpAddr);
  });

  it('handles concurrent moves, stale clients, collisions, rollback on failure, and restart recovery', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home-1', repo);
    await coordinator.registerRoom({ id: 'living-room', name: 'Living Room' });
    await coordinator.registerRoom({ id: 'office', name: 'Office' });
    await coordinator.registerRoom({ id: 'bedroom', name: 'Bedroom' });

    await coordinator.registerDevice(makeLampDevice('dev-1', 'Desk Lamp', 'living-room'));
    await coordinator.registerDevice(makeLampDevice('dev-2', 'Desk Lamp', 'office'));

    // Collision in office with reject policy
    await expect(
      coordinator.moveDeviceToRoom({
        homeId: 'home-1',
        deviceId: 'dev-1',
        targetRoomId: 'office',
        actor: ownerActor,
        collisionPolicy: 'reject',
      }),
    ).rejects.toThrow('identity_address_conflict');
    expect(coordinator.getDevice('dev-1')?.roomId).toBe('living-room');

    // Collision in office with auto_suffix policy
    const suffixedPatch = await coordinator.moveDeviceToRoom({
      homeId: 'home-1',
      deviceId: 'dev-1',
      targetRoomId: 'office',
      actor: ownerActor,
      collisionPolicy: 'auto_suffix',
    });
    expect(suffixedPatch.toRoomId).toBe('office');
    expect(coordinator.getDevice('dev-1')?.endpoints[0]?.address).toBe(
      'lighting::office:desk-lamp-2:dev-1-main',
    );

    // Concurrent moves with optimistic revision check: one succeeds, stale client fails
    const revBefore = coordinator.getRevision();
    const [res1, res2] = await Promise.allSettled([
      coordinator.moveDeviceToRoom({
        homeId: 'home-1',
        deviceId: 'dev-1',
        targetRoomId: 'bedroom',
        actor: ownerActor,
        expectedRevision: revBefore,
      }),
      coordinator.moveDeviceToRoom({
        homeId: 'home-1',
        deviceId: 'dev-2',
        targetRoomId: 'bedroom',
        actor: ownerActor,
        expectedRevision: revBefore,
      }),
    ]);
    expect(res1.status).toBe('fulfilled');
    expect(res2.status).toBe('rejected');
    if (res2.status === 'rejected') {
      expect(String(res2.reason)).toContain('stale_client_revision');
    }

    // Rollback on persistence failure leaves state completely intact
    const revBeforeFailure = coordinator.getRevision();
    repo.injectNextSaveFailure(new Error('sqlite_disk_full'));
    await expect(
      coordinator.moveDeviceToRoom({
        homeId: 'home-1',
        deviceId: 'dev-1',
        targetRoomId: 'living-room',
        actor: ownerActor,
      }),
    ).rejects.toThrow('sqlite_disk_full');
    expect(coordinator.getRevision()).toBe(revBeforeFailure);
    expect(coordinator.getDevice('dev-1')?.roomId).toBe('bedroom');

    // Restart recovery from repository preserves all state and aliases
    const restarted = new AtomicRoomMoveCoordinator('home-1', repo);
    await restarted.initialize();
    expect(restarted.getRevision()).toBe(revBeforeFailure);
    expect(restarted.getDevice('dev-1')?.roomId).toBe('bedroom');
    expect(restarted.resolveAddressOrId('lighting::living-room:desk-lamp:dev-1-main')).toBe(
      'dev-1-main',
    );
  });

  it('enforces permissions, supports offline integrations without duplicate actions, and preserves history and archive references', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home-1', repo);
    await coordinator.registerRoom({ id: 'entryway', name: 'Entryway' });
    await coordinator.registerRoom({ id: 'porch', name: 'Porch' });

    const offlineCam: HausDevice = {
      id: 'cam-door-1',
      source: { instanceId: 'kitsune-rtsp', externalId: 'cam-serial-01' },
      name: 'Door Camera',
      category: 'cameras',
      roomId: 'entryway',
      areaId: 'entryway',
      connectivity: { protocol: 'local_ip' },
      availability: 'offline',
      endpoints: [
        {
          id: 'cam-door-1-stream',
          name: 'Main Stream',
          category: 'cameras',
          capabilities: [],
          readings: {},
        },
      ],
    };
    const regCam = await coordinator.registerDevice(offlineCam);
    const initialEpAddr = regCam.endpoints[0]!.address!;

    await coordinator.recordHistoryEvent({
      eventId: 'evt-motion-101',
      canonicalId: 'cam-door-1-stream',
      recordedAddress: initialEpAddr,
      roomIdAtCapture: 'entryway',
      timestamp: '2026-11-07T01:00:00.000Z',
      eventType: 'motion_detected',
    });

    await coordinator.recordArchive({
      recordingId: 'rec-9001',
      canonicalCameraId: 'cam-door-1',
      recordedAddress: 'cameras::entryway:door-camera',
      archiveDigest: 'sha256:4f8b9c1a2e',
      roomIdAtCapture: 'entryway',
      createdAt: '2026-11-07T01:00:02.000Z',
    });

    // Viewer and restricted room actors are denied
    await expect(
      coordinator.moveDeviceToRoom({
        homeId: 'home-1',
        deviceId: 'cam-door-1',
        targetRoomId: 'porch',
        actor: { actorId: 'guest-1', role: 'viewer' },
      }),
    ).rejects.toThrow('room_move_permission_denied');

    await expect(
      coordinator.moveDeviceToRoom({
        homeId: 'home-1',
        deviceId: 'cam-door-1',
        targetRoomId: 'porch',
        actor: {
          actorId: 'scoped-member',
          role: 'member',
          permissions: ['rooms:move'],
          allowedRoomIds: ['entryway'],
        },
      }),
    ).rejects.toThrow('room_move_permission_denied');

    // Authorized move on offline integration queues sync without failing or firing physical actions
    const patch = await coordinator.moveDeviceToRoom({
      homeId: 'home-1',
      deviceId: 'cam-door-1',
      targetRoomId: 'porch',
      actor: ownerActor,
    });
    expect(patch.providerSyncStatus).toBe('queued_offline');
    expect(patch.physicalCommandsDispatched).toBe(0);
    expect(coordinator.getPendingProviderSyncs()).toHaveLength(1);

    // Reconciling provider reconnect clears pending sync with zero duplicate actions
    const reconciled = await coordinator.reconcileProviderReconnect('kitsune-rtsp');
    expect(reconciled).toEqual(['cam-door-1']);
    expect(coordinator.getPendingProviderSyncs()).toHaveLength(0);
    expect(coordinator.getDevice('cam-door-1')?.availability).toBe('online');
    expect(coordinator.getPhysicalActionCount()).toBe(0);

    // History and archive references captured before the move still resolve to canonical IDs
    const history = coordinator.getHistoryForCanonicalId('cam-door-1-stream');
    expect(history).toHaveLength(1);
    expect(history[0]?.eventId).toBe('evt-motion-101');
    expect(coordinator.resolveAddressOrId(history[0]!.recordedAddress)).toBe('cam-door-1-stream');

    const archives = coordinator.getArchivesForCanonicalCamera('cam-door-1');
    expect(archives).toHaveLength(1);
    expect(archives[0]?.archiveDigest).toBe('sha256:4f8b9c1a2e');
    expect(coordinator.resolveAddressOrId(archives[0]!.recordedAddress)).toBe('cam-door-1');
  });
});
