/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type NativeProviderRequest =
  | { operation: 'list' }
  | { operation: 'discover' }
  | { operation: 'connect'; bridgeId: string }
  | { operation: 'preview'; bridgeId: string }
  | { operation: 'enroll'; url: string; code: string; allowHttp: boolean }
  | { operation: 'import'; bridgeId: string; cameras: string[] }
  | { operation: 'remove'; bridgeId: string }
  | { operation: 'handoverStatus' }
  | { operation: 'handover'; bridgeId: string }
  | { operation: 'migrationStatus'; bridgeId: string }
  | { operation: 'migrationReview'; bridgeId: string }
  | { operation: 'migrationApply'; bridgeId: string; revision: string; retire: string[] }
  | { operation: 'migrationUndo'; bridgeId: string; revision: string }
  | { operation: 'loginState'; bridgeId: string }
  | { operation: 'loginQrStart'; bridgeId: string; region?: string }
  | { operation: 'loginQrPoll'; bridgeId: string; token: string };
