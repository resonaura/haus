/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export {
  InvalidSessionError,
  matchesOAuthState,
  authorize,
  refreshAccessToken,
  revokeSession,
} from '@haus/ha/native/auth-protocol';
export type { AccessToken } from '@haus/ha/native/auth-protocol';
