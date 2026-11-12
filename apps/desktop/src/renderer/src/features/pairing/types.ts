/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface PendingPairingRequest {
  readonly sessionId: string;
  readonly challengeCode: string;
  readonly createdAt: number;
  readonly expiresAt?: number;
}
