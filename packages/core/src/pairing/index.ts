/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export {
  isLocalHostname,
  isLocalTarget,
  isPrivateIpv4,
  isUniqueLocalIpv6,
  parseDiscoveredHub,
  parseManualHubAddress,
  sanitizeServiceName,
} from './discovery.js';

export {
  HubPairing,
  timingSafeStringEqual,
  validateClientIdentity,
  validateHubIdentity,
  validatePairingGrant,
  verifyDiscoveredCandidate,
} from './pairing.js';

export {
  isPrimaryPhysicalInterface,
  encodeBleAdvertisementPayload,
  decodeBleAdvertisementPayload,
  HAUS_BLE_SERVICE_UUID,
  HAUS_BLE_CHAR_AUTH_UUID,
  HAUS_BLE_CHAR_STATUS_UUID,
} from './transport.js';

export { evaluateClockSkew, parseClientTimeHeader, CLIENT_TIME_HEADER } from './time-sync.js';

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
} from './types.js';

export type { NetworkInterfaceCandidate } from './transport.js';
export type { ClockSkewAssessment } from './time-sync.js';
