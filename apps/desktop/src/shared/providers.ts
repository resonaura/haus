/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type NativeProviderRequest =
  | { operation: 'list' }
  | { operation: 'discover' }
  | { operation: 'connect'; bridgeId: string }
  | { operation: 'preview'; bridgeId: string }
  | { operation: 'enroll'; url: string; code: string; allowHttp: boolean }
  | { operation: 'import'; bridgeId: string; cameras: string[] };
