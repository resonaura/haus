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
export type {
  CredentialCodec,
  Provider,
  ProviderContext,
  ProviderInventory,
  ProviderReply,
} from './provider/index.js';
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
  OWNED_GLOBAL_DOMAINS,
  isOwnedDomain,
  isExtensionDomain,
  isValidGlobalDomain,
  classifyDomain,
  assertValidGlobalDomain,
  parseDomainAddress,
  formatDomainAddress,
  AtomicRoomMoveCoordinator,
  InMemoryRoomMoveRepository,
} from './identity/index.js';
export type {
  Address,
  AddressRepository,
  AddressTransaction,
  OwnedGlobalDomain,
  ExtensionDomain,
  GlobalDomain,
  HausDeviceGroup,
  HistoricalEventRecord,
  ArchiveRecordingRecord,
  PendingProviderRoomSync,
  RoomMoveActor,
  RoomMoveRequest,
  RoomMoveClientPatch,
  RoomMovePersistenceState,
  RoomMoveRepository,
} from './identity/index.js';
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
  HelperLiveTopic,
} from './helper-protocol.js';
export {
  createSnapshotEnvelope,
  parseSnapshotEnvelope,
  snapshotEnvelopeSchema,
  snapshotEnvelopeVersion,
} from './snapshot-envelope.js';
export type { ParseSnapshotEnvelopeOptions, SnapshotEnvelope } from './snapshot-envelope.js';
export {
  HubPairing,
  isLocalHostname,
  isLocalTarget,
  isPrivateIpv4,
  isUniqueLocalIpv6,
  parseDiscoveredHub,
  parseManualHubAddress,
  sanitizeServiceName,
  timingSafeStringEqual,
  validateClientIdentity,
  validateHubIdentity,
  validatePairingGrant,
  verifyDiscoveredCandidate,
} from './pairing/index.js';
export type {
  ClientIdentity,
  ClientRole,
  DiscoveredHub,
  DiscoveredService,
  HubIdentity,
  PairingErrorCode,
  PairingGrant,
  PairingOffer,
  PairingSessionRecord,
  PairingState,
} from './pairing/index.js';
export {
  isSessionExpired,
  toSessionView,
  sanitizeSessionForRenderer,
  validateSessionCredentials,
  issueSessionFromGrant,
  verifySessionToken,
  refreshClientSession,
  revokeClientSession,
} from './auth/index.js';
export type {
  ClientSession,
  ClientSessionView,
  ClientSessionCredentials,
  SessionState as ClientSessionState,
  AuthErrorCode,
  SessionResumeResult,
  SessionRefreshResult,
  TokenGenerator,
} from './auth/index.js';
export * from './device/index.js';
export * from './protocol/index.js';
export * from './auth/keychain.js';
export * from './auth/zero-trust.js';
export * from './pairing/transport.js';
export * from './pairing/time-sync.js';
export * from './automation/index.js';
export * from './cluster/index.js';
export * from './stats/index.js';
export * from './commissioning/index.js';
