/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { encodeMatterQrCode, generateManualPairingCode } from './pairing-code.js';
import type { MatterShareRequest, MatterSharePayload } from './types.js';

export interface CommissioningWindowParams {
  readonly nodeId: string;
  readonly durationSeconds?: number;
  readonly discriminator?: number;
  readonly passcode?: number;
}

export interface CommissioningWindowInfo {
  readonly nodeId: string;
  readonly passcode: number;
  readonly discriminator: number;
  readonly manualPairingCode: string;
  readonly qrPairingCode: string;
  readonly openedAt: number;
  readonly expiresAt: number;
}

export class MatterMultiAdminService {
  private readonly activeWindows = new Map<string, CommissioningWindowInfo>();

  /**
   * Opens a commissioning window on an existing commissioned Matter node,
   * enabling it to be paired into Apple Home, Google Home, or Amazon Alexa.
   */
  public async openCommissioningWindow(
    params: CommissioningWindowParams,
  ): Promise<CommissioningWindowInfo> {
    const duration = params.durationSeconds ?? 900; // 15 minutes default
    // Generate valid 27-bit passcode (avoiding forbidden values like 0 or 11111111)
    const passcode = params.passcode ?? Math.floor(20000000 + Math.random() * 70000000);
    // Generate valid 12-bit discriminator (0..4095)
    const discriminator = params.discriminator ?? Math.floor(Math.random() * 4096);

    const manualPairingCode = generateManualPairingCode(discriminator, passcode);
    const qrPairingCode = encodeMatterQrCode({ discriminator, passcode });

    const now = Date.now();
    const info: CommissioningWindowInfo = {
      nodeId: params.nodeId,
      passcode,
      discriminator,
      manualPairingCode,
      qrPairingCode,
      openedAt: now,
      expiresAt: now + duration * 1000,
    };

    this.activeWindows.set(params.nodeId, info);
    return info;
  }

  /**
   * Opens an Enhanced Commissioning Method window returning MatterSharePayload.
   */
  public async openShareWindow(request: MatterShareRequest): Promise<MatterSharePayload> {
    const info = await this.openCommissioningWindow({
      nodeId: request.nodeId,
      durationSeconds: request.expiresSeconds,
    });

    return {
      qrPayload: info.qrPairingCode,
      manualPairingCode: info.manualPairingCode,
      discriminator: info.discriminator,
      expiresAt: new Date(info.expiresAt).toISOString(),
    };
  }

  public getActiveWindow(nodeId: string): CommissioningWindowInfo | undefined {
    const info = this.activeWindows.get(nodeId);
    if (!info) return undefined;
    if (Date.now() > info.expiresAt) {
      this.activeWindows.delete(nodeId);
      return undefined;
    }
    return info;
  }

  public closeCommissioningWindow(nodeId: string): boolean {
    return this.activeWindows.delete(nodeId);
  }
}
