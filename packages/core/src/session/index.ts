/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export { SessionOwnership, sessionKey } from './ownership.js';
export { OwnedCredentials } from './credentials.js';
export { TokenRefresh, RefreshError } from './refresh.js';
export type { RefreshCode } from './refresh.js';
export type {
  IntegrationRef,
  SessionOwner,
  SessionState,
  SessionGrant,
  SessionRecord,
  SessionRepository,
  CredentialVault,
  RefreshVault,
  RefreshStart,
  RefreshResult,
  RefreshProvider,
} from './types.js';
