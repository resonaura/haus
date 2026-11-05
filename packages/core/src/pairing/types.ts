/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type ClientRole = 'admin' | 'member' | 'guest' | 'node';

export interface DiscoveredService {
  readonly type?: string;
  readonly host?: string;
  readonly addresses?: readonly string[];
  readonly port?: number;
  readonly name?: string;
  readonly txt?: Readonly<Record<string, unknown>>;
}

export interface DiscoveredHub {
  readonly id: string;
  readonly hubId: string;
  readonly homeId?: string;
  readonly name: string;
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
  readonly fingerprint?: string;
  readonly source: 'discovery' | 'manual';
}

export interface HubIdentity {
  readonly hubId: string;
  readonly homeId: string;
  readonly name: string;
  readonly fingerprint?: string;
  readonly publicKey?: string;
}

export interface ClientIdentity {
  readonly clientId: string;
  readonly clientName: string;
  readonly role: ClientRole;
  readonly publicKey?: string;
}

export type PairingState =
  'initiated' | 'confirming' | 'paired' | 'expired' | 'cancelled' | 'revoked' | 'rejected';

export type PairingErrorCode =
  | 'invalid_discovery_service'
  | 'invalid_manual_address'
  | 'invalid_hub_identity'
  | 'invalid_client_identity'
  | 'invalid_pairing_code'
  | 'spoofed_hub'
  | 'wrong_home'
  | 'pairing_expired'
  | 'pairing_cancelled'
  | 'pairing_rejected'
  | 'grant_revoked'
  | 'grant_expired'
  | 'invalid_pairing_grant';

export interface PairingOffer {
  readonly sessionId: string;
  readonly hub: HubIdentity;
  readonly expiresAt: number;
  readonly state: PairingState;
}

export interface PairingGrant {
  readonly grantId: string;
  readonly hubId: string;
  readonly homeId: string;
  readonly clientId: string;
  readonly clientRole: ClientRole;
  readonly clientName: string;
  readonly issuedAt: number;
  readonly expiresAt?: number;
  readonly revoked: boolean;
}

export interface PairingSessionRecord {
  readonly sessionId: string;
  readonly hub: HubIdentity;
  readonly client?: ClientIdentity;
  readonly expectedHomeId?: string;
  readonly challengeCode: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly state: PairingState;
}
