/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';

export interface PinnedBridgeIdentity {
  readonly bridgeId: string;
  readonly pinnedHubId: string;
  readonly macAddress: string;
  readonly setupId: string;
  readonly configVersion: number;
  readonly pairingKeyFingerprint: string;
  readonly isAdvertising: boolean;
}

export type TransferState =
  'initiated' | 'target_prepared' | 'source_teardown' | 'completed' | 'failed' | 'rolled_back';

export interface HomeKitTransferIntent {
  readonly transferId: string;
  readonly bridgeId: string;
  readonly sourceHubId: string;
  readonly targetHubId: string;
  readonly pairingKeyFingerprint: string;
  readonly requiresRePairing: boolean;
  readonly userWarning: string;
  readonly state: TransferState;
  readonly checksum: string;
}

export class HomeKitTransferError extends Error {
  constructor(message: string) {
    super(`[HomeKitTransferError] ${message}`);
    this.name = 'HomeKitTransferError';
  }
}

export class HomeKitTransferManager {
  private readonly pinnedBridges = new Map<string, PinnedBridgeIdentity>();
  private readonly activeTransfers = new Map<string, HomeKitTransferIntent>();

  registerPinnedBridge(identity: PinnedBridgeIdentity): void {
    this.pinnedBridges.set(identity.bridgeId, identity);
  }

  getPinnedBridge(bridgeId: string): PinnedBridgeIdentity | undefined {
    return this.pinnedBridges.get(bridgeId);
  }

  canAdvertiseOnHub(bridgeId: string, hubId: string): boolean {
    const bridge = this.pinnedBridges.get(bridgeId);
    if (!bridge) return false;

    // Strict rule: bridge can advertise ONLY on its pinned hub host!
    return bridge.pinnedHubId === hubId && bridge.isAdvertising;
  }

  initiateTransfer(
    bridgeId: string,
    targetHubId: string,
    options?: { preservePairing?: boolean },
  ): HomeKitTransferIntent {
    const bridge = this.pinnedBridges.get(bridgeId);
    if (!bridge) {
      throw new HomeKitTransferError(`Bridge "${bridgeId}" not found in pinned registry.`);
    }

    if (bridge.pinnedHubId === targetHubId) {
      throw new HomeKitTransferError(
        `Bridge "${bridgeId}" is already pinned to target hub "${targetHubId}".`,
      );
    }

    const preservePairing = options?.preservePairing ?? true;
    const transferId = `hk_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const checksum = createHash('sha256')
      .update(
        `${bridge.bridgeId}:${bridge.macAddress}:${bridge.pairingKeyFingerprint}:${bridge.configVersion}`,
      )
      .digest('hex');

    const userWarning = preservePairing
      ? `Moving HomeKit bridge to hub "${targetHubId}". Pairing keys and accessories preserved; Apple Home connection maintained.`
      : `Moving HomeKit bridge to hub "${targetHubId}" with new keys. Devices in Apple Home will require re-pairing.`;

    const intent: HomeKitTransferIntent = {
      transferId,
      bridgeId,
      sourceHubId: bridge.pinnedHubId,
      targetHubId,
      pairingKeyFingerprint: bridge.pairingKeyFingerprint,
      requiresRePairing: !preservePairing,
      userWarning,
      state: 'initiated',
      checksum,
    };

    this.activeTransfers.set(transferId, intent);
    return intent;
  }

  prepareTarget(transferId: string): void {
    const intent = this.activeTransfers.get(transferId);
    if (!intent || intent.state !== 'initiated') {
      throw new HomeKitTransferError(
        `Cannot prepare target: invalid transfer state for "${transferId}".`,
      );
    }

    // Target is provisioned with keys, but DOES NOT advertise yet
    this.activeTransfers.set(transferId, {
      ...intent,
      state: 'target_prepared',
    });
  }

  teardownSource(transferId: string): void {
    const intent = this.activeTransfers.get(transferId);
    if (!intent || intent.state !== 'target_prepared') {
      throw new HomeKitTransferError(`Cannot teardown source: target must be prepared first.`);
    }

    const bridge = this.pinnedBridges.get(intent.bridgeId);
    if (bridge) {
      // Source ceases advertising and releases HAP socket
      this.pinnedBridges.set(intent.bridgeId, {
        ...bridge,
        isAdvertising: false,
      });
    }

    this.activeTransfers.set(transferId, {
      ...intent,
      state: 'source_teardown',
    });
  }

  activateTarget(transferId: string): PinnedBridgeIdentity {
    const intent = this.activeTransfers.get(transferId);
    if (!intent || intent.state !== 'source_teardown') {
      throw new HomeKitTransferError(`Cannot activate target: source must be torn down first.`);
    }

    const bridge = this.pinnedBridges.get(intent.bridgeId);
    if (!bridge) {
      throw new HomeKitTransferError(`Bridge identity lost during transfer.`);
    }

    const nextConfigVersion = bridge.configVersion + 1;
    const transferredBridge: PinnedBridgeIdentity = {
      ...bridge,
      pinnedHubId: intent.targetHubId,
      configVersion: nextConfigVersion,
      isAdvertising: true,
    };

    this.pinnedBridges.set(intent.bridgeId, transferredBridge);
    this.activeTransfers.set(transferId, {
      ...intent,
      state: 'completed',
    });

    return transferredBridge;
  }

  rollback(transferId: string, _reason?: string): PinnedBridgeIdentity {
    const intent = this.activeTransfers.get(transferId);
    if (!intent) {
      throw new HomeKitTransferError(`Transfer "${transferId}" not found.`);
    }

    const bridge = this.pinnedBridges.get(intent.bridgeId);
    if (!bridge) {
      throw new HomeKitTransferError(`Bridge "${intent.bridgeId}" not found.`);
    }

    // Restore source to active advertising on original hub
    const restoredBridge: PinnedBridgeIdentity = {
      ...bridge,
      pinnedHubId: intent.sourceHubId,
      isAdvertising: true,
    };

    this.pinnedBridges.set(intent.bridgeId, restoredBridge);
    this.activeTransfers.set(transferId, {
      ...intent,
      state: 'rolled_back',
    });

    return restoredBridge;
  }
}
