/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HomeKitTransferManager,
  HomeKitTransferError,
} from '../dist/index.js';

test('HomeKit bridge identity remains pinned to designated hub and blocks automatic second advertisement', () => {
  const manager = new HomeKitTransferManager();

  manager.registerPinnedBridge({
    bridgeId: 'bridge_main',
    pinnedHubId: 'hub_primary',
    macAddress: '52:54:00:AB:CD:EF',
    setupId: 'HAUS',
    configVersion: 1,
    pairingKeyFingerprint: 'ed25519_pk_fingerprint_123',
    isAdvertising: true,
  });

  // Authoritative pinned hub can advertise
  assert.equal(manager.canAdvertiseOnHub('bridge_main', 'hub_primary'), true);

  // Secondary hub MUST NOT advertise (no automatic second advertisement during coordinator shift)
  assert.equal(manager.canAdvertiseOnHub('bridge_main', 'hub_secondary'), false);

  // Unknown bridge cannot advertise
  assert.equal(manager.canAdvertiseOnHub('bridge_unknown', 'hub_primary'), false);
});

test('completes deliberate 4-step explicit bridge transfer without duplicate mDNS advertisement', () => {
  const manager = new HomeKitTransferManager();

  manager.registerPinnedBridge({
    bridgeId: 'bridge_living_room',
    pinnedHubId: 'hub_primary',
    macAddress: '52:54:00:11:22:33',
    setupId: 'ROOM',
    configVersion: 1,
    pairingKeyFingerprint: 'key_hash_abc',
    isAdvertising: true,
  });

  // Step 1: Initiate transfer
  const intent = manager.initiateTransfer('bridge_living_room', 'hub_secondary', {
    preservePairing: true,
  });

  assert.equal(intent.state, 'initiated');
  assert.equal(intent.sourceHubId, 'hub_primary');
  assert.equal(intent.targetHubId, 'hub_secondary');
  assert.equal(intent.requiresRePairing, false);
  assert.ok(intent.checksum.length > 0);
  assert.ok(intent.userWarning.includes('hub_secondary'));

  // Step 2: Prepare target (target pre-provisioned, but MUST NOT advertise yet)
  manager.prepareTarget(intent.transferId);
  assert.equal(manager.canAdvertiseOnHub('bridge_living_room', 'hub_secondary'), false);
  assert.equal(manager.canAdvertiseOnHub('bridge_living_room', 'hub_primary'), true);

  // Step 3: Teardown source (source ceases advertising)
  manager.teardownSource(intent.transferId);
  assert.equal(manager.canAdvertiseOnHub('bridge_living_room', 'hub_primary'), false);
  assert.equal(manager.canAdvertiseOnHub('bridge_living_room', 'hub_secondary'), false);

  // Step 4: Activate target (target becomes active with incremented configuration version)
  const activated = manager.activateTarget(intent.transferId);
  assert.equal(activated.pinnedHubId, 'hub_secondary');
  assert.equal(activated.configVersion, 2);
  assert.equal(activated.isAdvertising, true);

  // Now target can advertise, old source cannot
  assert.equal(manager.canAdvertiseOnHub('bridge_living_room', 'hub_secondary'), true);
  assert.equal(manager.canAdvertiseOnHub('bridge_living_room', 'hub_primary'), false);
});

test('rolls back interrupted transfer and restores active source advertising safely', () => {
  const manager = new HomeKitTransferManager();

  manager.registerPinnedBridge({
    bridgeId: 'bridge_critical_nvr',
    pinnedHubId: 'hub_primary',
    macAddress: '52:54:00:99:88:77',
    setupId: 'CNVR',
    configVersion: 1,
    pairingKeyFingerprint: 'nvr_fingerprint_777',
    isAdvertising: true,
  });

  const intent = manager.initiateTransfer('bridge_critical_nvr', 'hub_secondary');
  manager.prepareTarget(intent.transferId);
  manager.teardownSource(intent.transferId);

  // Verify source is temporarily offline
  assert.equal(manager.canAdvertiseOnHub('bridge_critical_nvr', 'hub_primary'), false);

  // Interruption happens (e.g. target socket error) -> Trigger Rollback
  const restored = manager.rollback(intent.transferId, 'Target socket bind failed');

  assert.equal(restored.pinnedHubId, 'hub_primary');
  assert.equal(restored.isAdvertising, true);

  // Source hub is immediately restored and can advertise
  assert.equal(manager.canAdvertiseOnHub('bridge_critical_nvr', 'hub_primary'), true);
  assert.equal(manager.canAdvertiseOnHub('bridge_critical_nvr', 'hub_secondary'), false);
});

test('rejects transfer initiation when bridge is already pinned to target', () => {
  const manager = new HomeKitTransferManager();

  manager.registerPinnedBridge({
    bridgeId: 'bridge_same',
    pinnedHubId: 'hub_primary',
    macAddress: '52:54:00:00:11:22',
    setupId: 'SAME',
    configVersion: 1,
    pairingKeyFingerprint: 'same_hash',
    isAdvertising: true,
  });

  assert.throws(
    () => manager.initiateTransfer('bridge_same', 'hub_primary'),
    HomeKitTransferError,
  );
});
