/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export { EntityActionQueue } from './command-queue.js';
export { Commands } from './command/index.js';
export type {
  CommandStatus,
  CommandReason,
  CommandScope,
  CommandOutcome,
  CommandEntry,
  CommandJournal,
  CommandRequest,
  CommandProvider,
  CommandPolicy,
} from './command/index.js';
export { HomeRuntime, RuntimeError } from './runtime.js';
export { Home } from './home.js';
export { validateProviderSession } from './event/session.js';
export type { RuntimeTransport, RuntimeObserver, ConnectionState } from './runtime.js';
export { Identities } from './types.js';
export {
  IdentityRegistry,
  identityKey,
  Addresses,
  parseAddress,
  formatAddress,
} from './identity/index.js';
export type { Address, AddressRepository, AddressTransaction } from './identity/index.js';
export {
  SessionOwnership,
  sessionKey,
  OwnedCredentials,
  TokenRefresh,
  RefreshError,
} from './session/index.js';
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
  RefreshCode,
} from './session/index.js';
export type {
  IdentityKind,
  IdentityRef,
  IdentityRepository,
  IdentityTransaction,
  ResourceRef,
} from './identity/index.js';
export type {
  HomeSnapshot,
  HomeAdapter,
  HomeEvent,
  ProviderSession,
  Device,
  Endpoint,
  Capability,
  Reading,
  Command,
  CommandReceipt,
  IdentityStore,
  SourceRef,
  Room,
} from './types.js';
export {
  helperFeatureNames,
  parseHelperCapabilities,
  parseHelperLiveMessage,
  safeHelperDiagnostic,
  supportsHelperFeature,
} from './helper-protocol.js';
export type {
  HelperCapabilities,
  HelperDiagnostic,
  HelperDiagnosticOperation,
  HelperFeature,
  HelperFeatures,
  HelperLiveMessage,
} from './helper-protocol.js';
export {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from './snapshot-envelope.js';
export type { ParseSnapshotEnvelopeOptions, SnapshotEnvelope } from './snapshot-envelope.js';
