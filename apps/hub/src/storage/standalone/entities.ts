/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';

export interface ClientSessionRow {
  sessionId: string;
  hubId: string;
  homeId: string;
  clientId: string;
  clientRole: string;
  clientName: string;
  tokenHash: string;
  refreshTokenHash: string | null;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

export interface StandaloneHomeEntryRow {
  kind: string;
  entryId: string;
  value: string;
  updatedAt: number;
}

export const ClientSessionEntity = new EntitySchema<ClientSessionRow>({
  name: 'ClientSession',
  tableName: 'client_sessions',
  columns: {
    sessionId: { type: 'text', primary: true, name: 'session_id' },
    hubId: { type: 'text', name: 'hub_id' },
    homeId: { type: 'text', name: 'home_id' },
    clientId: { type: 'text', name: 'client_id' },
    clientRole: { type: 'text', name: 'client_role' },
    clientName: { type: 'text', name: 'client_name' },
    tokenHash: { type: 'text', name: 'token_hash' },
    refreshTokenHash: { type: 'text', name: 'refresh_token_hash', nullable: true },
    issuedAt: { type: 'integer', name: 'issued_at' },
    expiresAt: { type: 'integer', name: 'expires_at' },
    revoked: { type: 'boolean', default: false },
  },
});

export const StandaloneHomeEntryEntity = new EntitySchema<StandaloneHomeEntryRow>({
  name: 'StandaloneHomeEntry',
  tableName: 'standalone_home_entries',
  columns: {
    kind: { type: 'text', primary: true },
    entryId: { type: 'text', primary: true, name: 'entry_id' },
    value: { type: 'text' },
    updatedAt: { type: 'integer', name: 'updated_at' },
  },
});

export const standaloneEntities = [ClientSessionEntity, StandaloneHomeEntryEntity];
