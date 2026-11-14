/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ClientRole } from '@haus/core/pairing';
import type { ClientSession } from '@haus/core/auth';
import { createHash } from 'node:crypto';
import type { ClientSessionRow } from '../storage/standalone/entities.js';

const VALID_ROLES: ReadonlySet<ClientRole> = new Set(['admin', 'member', 'guest', 'node']);

export function hashSessionSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function toSessionRow(session: ClientSession): ClientSessionRow {
  return {
    sessionId: session.sessionId,
    hubId: session.hubId,
    homeId: session.homeId,
    clientId: session.clientId,
    clientRole: session.clientRole,
    clientName: session.clientName,
    tokenHash: session.token,
    refreshTokenHash: session.refreshToken ?? null,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    revoked: session.revoked,
  };
}

export function fromSessionRow(row: ClientSessionRow): ClientSession | undefined {
  if (!VALID_ROLES.has(row.clientRole as ClientRole)) return undefined;
  return {
    sessionId: row.sessionId,
    hubId: row.hubId,
    homeId: row.homeId,
    clientId: row.clientId,
    clientRole: row.clientRole as ClientRole,
    clientName: row.clientName,
    token: row.tokenHash,
    refreshToken: row.refreshTokenHash ?? undefined,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revoked: Boolean(row.revoked),
  };
}
