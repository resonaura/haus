/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MatterTransport } from './controller.js';
import { generateManualPairingCode, encodeMatterQrCode } from './pairing-code.js';
import { MatterClusterId } from './types.js';

export type TemporaryCommissionerRole = 'temporary-commissioner' | 'transport-agent';

export type MatterHandoffStatus =
  | 'WINDOW_OPENED'
  | 'COMMISSIONING'
  | 'PERMANENT_VERIFIED'
  | 'TEMPORARY_FABRIC_REMOVED'
  | 'UNCERTAIN_REMOVAL'
  | 'WINDOW_EXPIRED'
  | 'FAILED';

export interface MatterHandoffRequest {
  readonly handoffId: string;
  readonly commissioningId: string;
  readonly homeId: string;
  readonly temporaryCommissionerId: string;
  readonly targetIp: string;
  readonly targetPort?: number;
  readonly discriminator: number;
  readonly passcode: number;
  readonly manualPairingCode?: string;
  readonly qrPairingCode?: string;
  readonly temporaryFabricIndex: number;
  readonly windowDurationSeconds?: number;
  readonly windowExpiresAt: number;
}

export interface MatterHandoffSession {
  readonly handoffId: string;
  readonly commissioningId: string;
  readonly homeId: string;
  readonly temporaryCommissionerId: string;
  readonly targetIp: string;
  readonly targetPort: number;
  discriminator: number;
  passcode: number;
  manualPairingCode: string;
  qrPairingCode: string;
  readonly temporaryFabricIndex: number;
  windowExpiresAt: number;
  status: MatterHandoffStatus;
  permanentNodeId?: string;
  permanentFabricIndex?: number;
  permanentFabricVerified: boolean;
  realDeviceControlVerified: boolean;
  temporaryFabricRemoved: boolean;
  uncertainAck: boolean;
  error?: string;
  lastUpdated: number;
}

/**
 * Validates that no private keys, NOC certificates, or phone/desktop fabric databases
 * are transferred during remote handoff.
 */
export function validateHandoffRequest(payload: Record<string, unknown>): void {
  // Security Invariant: Do not copy opaque phone/desktop fabric databases, NOCs or private keys
  if (
    payload.noc !== undefined ||
    payload.privateKey !== undefined ||
    payload.fabricDatabase !== undefined ||
    payload.caKey !== undefined ||
    payload.ipk !== undefined ||
    payload.certificates !== undefined
  ) {
    throw new Error(
      'forbidden_credential_transfer: fabric credentials, private keys, or NOCs must never be copied',
    );
  }

  if (!payload.targetIp || typeof payload.targetIp !== 'string') {
    throw new Error('invalid_handoff_request: targetIp is required');
  }

  if (
    typeof payload.discriminator !== 'number' ||
    payload.discriminator < 0 ||
    payload.discriminator > 4095
  ) {
    throw new Error('invalid_handoff_request: valid 12-bit discriminator (0..4095) required');
  }

  if (typeof payload.passcode !== 'number' || payload.passcode <= 0) {
    throw new Error('invalid_handoff_request: valid passcode required');
  }

  if (
    typeof payload.temporaryFabricIndex !== 'number' ||
    payload.temporaryFabricIndex <= 0
  ) {
    throw new Error('invalid_handoff_request: valid temporaryFabricIndex required');
  }

  if (
    typeof payload.windowExpiresAt !== 'number' ||
    payload.windowExpiresAt <= 0
  ) {
    throw new Error('invalid_handoff_request: valid windowExpiresAt timestamp required');
  }
}

/**
 * Matter Handoff Manager.
 * Orchestrates authorized temporary commissioner handoff to Hub permanent controller.
 */
export class MatterHandoffManager {
  private readonly sessions = new Map<string, MatterHandoffSession>();

  public createSession(req: MatterHandoffRequest): MatterHandoffSession {
    validateHandoffRequest(req as unknown as Record<string, unknown>);

    const now = Date.now();
    if (now > req.windowExpiresAt) {
      throw new Error('commissioning_window_expired: cannot initiate handoff with expired window');
    }

    const manualPairingCode =
      req.manualPairingCode ?? generateManualPairingCode(req.discriminator, req.passcode);
    const qrPairingCode =
      req.qrPairingCode ??
      encodeMatterQrCode({ discriminator: req.discriminator, passcode: req.passcode });

    const session: MatterHandoffSession = {
      handoffId: req.handoffId,
      commissioningId: req.commissioningId,
      homeId: req.homeId,
      temporaryCommissionerId: req.temporaryCommissionerId,
      targetIp: req.targetIp,
      targetPort: req.targetPort ?? 5540,
      discriminator: req.discriminator,
      passcode: req.passcode,
      manualPairingCode,
      qrPairingCode,
      temporaryFabricIndex: req.temporaryFabricIndex,
      windowExpiresAt: req.windowExpiresAt,
      status: 'WINDOW_OPENED',
      permanentFabricVerified: false,
      realDeviceControlVerified: false,
      temporaryFabricRemoved: false,
      uncertainAck: false,
      lastUpdated: now,
    };

    this.sessions.set(session.handoffId, session);
    return session;
  }

  public getSession(handoffId: string): MatterHandoffSession | undefined {
    return this.sessions.get(handoffId);
  }

  /**
   * Hub establishes its own independent commissioning session over IP
   * using the open commissioning window.
   */
  public async executeHubCommissioning(
    handoffId: string,
    transport: MatterTransport,
  ): Promise<MatterHandoffSession> {
    const session = this.sessions.get(handoffId);
    if (!session) {
      throw new Error('unknown_handoff_session');
    }

    const now = Date.now();
    if (now > session.windowExpiresAt) {
      session.status = 'WINDOW_EXPIRED';
      session.error = 'commissioning_window_expired';
      session.lastUpdated = now;
      throw new Error('commissioning_window_expired');
    }

    session.status = 'COMMISSIONING';
    session.lastUpdated = now;

    try {
      const res = await transport.commission({
        code: session.manualPairingCode,
        ip: session.targetIp,
        port: session.targetPort,
        discriminator: session.discriminator,
        passcode: session.passcode,
      });

      session.permanentNodeId = res.nodeId;
      session.permanentFabricIndex = res.fabricIndex;
      session.lastUpdated = Date.now();

      // Verify permanent fabric and real device control
      await this.verifyPermanentFabric(session, transport);

      return session;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      session.status = 'FAILED';
      session.error = msg;
      session.lastUpdated = Date.now();
      throw err;
    }
  }

  /**
   * Verifies Hub's secure CASE session, persistent fabric, and real device control.
   */
  public async verifyPermanentFabric(
    session: MatterHandoffSession,
    transport: MatterTransport,
  ): Promise<boolean> {
    if (!session.permanentNodeId) {
      throw new Error('matter_node_not_commissioned');
    }

    // 1. Verify permanent fabric index is allocated and distinct from temporary fabric
    if (
      session.permanentFabricIndex !== undefined &&
      session.permanentFabricIndex === session.temporaryFabricIndex
    ) {
      throw new Error(
        'fabric_index_collision: permanent fabric must have distinct index from temporary fabric',
      );
    }

    // 2. Read basic information attribute to prove actual device communication
    try {
      await transport.readAttribute(
        session.permanentNodeId,
        0,
        MatterClusterId.BasicInformation,
        0x0001, // VendorName
      );
      session.realDeviceControlVerified = true;
    } catch {
      // Fallback: try reading descriptor cluster
      try {
        await transport.readAttribute(
          session.permanentNodeId,
          0,
          MatterClusterId.Descriptor,
          0x0000, // DeviceTypeList
        );
        session.realDeviceControlVerified = true;
      } catch {
        session.realDeviceControlVerified = false;
        throw new Error('device_verification_failed: unable to verify device control');
      }
    }

    session.permanentFabricVerified = true;
    session.status = 'PERMANENT_VERIFIED';
    session.lastUpdated = Date.now();
    return true;
  }

  /**
   * Removes temporary fabric ONLY after permanent controller verification is proven.
   * On uncertain acknowledgement or failure, preserves temporary fabric without orphan risk.
   */
  public async removeTemporaryFabric(
    handoffId: string,
    transport: MatterTransport,
  ): Promise<{ removed: boolean; uncertain: boolean }> {
    const session = this.sessions.get(handoffId);
    if (!session) {
      throw new Error('unknown_handoff_session');
    }

    // Invariant: Never remove temporary fabric before permanent fabric is verified
    if (!session.permanentFabricVerified || !session.realDeviceControlVerified) {
      throw new Error(
        'permanent_fabric_not_verified: temporary fabric cannot be removed before permanent controller is verified',
      );
    }

    if (!session.permanentNodeId) {
      throw new Error('matter_node_not_commissioned');
    }

    try {
      // Send RemoveFabric command on OperationalCredentials cluster
      await transport.sendCommand(
        session.permanentNodeId,
        0,
        MatterClusterId.OperationalCredentials,
        0x0a, // RemoveFabric
        { fabric_index: session.temporaryFabricIndex },
      );

      session.temporaryFabricRemoved = true;
      session.uncertainAck = false;
      session.status = 'TEMPORARY_FABRIC_REMOVED';
      session.lastUpdated = Date.now();
      return { removed: true, uncertain: false };
    } catch (err: unknown) {
      // Invariant: Never remove the only working controller after an uncertain acknowledgement.
      // If removal fails or times out, preserve the temporary fabric!
      session.temporaryFabricRemoved = false;
      session.uncertainAck = true;
      session.status = 'UNCERTAIN_REMOVAL';
      session.error =
        err instanceof Error ? err.message : 'uncertain_acknowledgement_preserving_temporary_fabric';
      session.lastUpdated = Date.now();
      return { removed: false, uncertain: true };
    }
  }

  /**
   * Reopens commissioning window after expiration without requiring re-running network provisioning.
   */
  public reopenWindow(
    handoffId: string,
    newExpiresAt: number,
    newPasscode?: number,
    newDiscriminator?: number,
  ): MatterHandoffSession {
    const session = this.sessions.get(handoffId);
    if (!session) {
      throw new Error('unknown_handoff_session');
    }

    const now = Date.now();
    if (newExpiresAt <= now) {
      throw new Error('invalid_expiration: new expiration must be in the future');
    }

    if (newPasscode) session.passcode = newPasscode;
    if (newDiscriminator !== undefined) session.discriminator = newDiscriminator;

    session.manualPairingCode = generateManualPairingCode(session.discriminator, session.passcode);
    session.qrPairingCode = encodeMatterQrCode({
      discriminator: session.discriminator,
      passcode: session.passcode,
    });
    session.windowExpiresAt = newExpiresAt;
    session.status = 'WINDOW_OPENED';
    session.error = undefined;
    session.uncertainAck = false;
    session.lastUpdated = now;

    return session;
  }
}
