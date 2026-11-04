/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { EntityManager } from 'typeorm';
import { sessionKey } from '@haus/core/session';
import type {
  IntegrationRef,
  SessionGrant,
  SessionRecord,
  SessionRepository,
  SessionState,
} from '@haus/core/session';
import { SessionEntity, type SessionRow } from './entities/session.js';
import type { Transactions } from './transactions.js';

const states: readonly SessionState[] = [
  'connecting',
  'connected',
  'reauth-required',
  'revoking',
  'revoked',
];
const fields = (resource: IntegrationRef) => ({ home: resource.homeId, integration: resource.id });

function decode(row: SessionRow): SessionRecord {
  const record: SessionRecord = {
    resource: { kind: 'integration', homeId: row.home, id: row.integration },
    owner: { hubId: row.hub, processId: row.process },
    generation: row.generation,
    state: row.state,
  };
  sessionKey(record.resource);
  if (
    !Number.isSafeInteger(row.generation) ||
    row.generation < 1 ||
    !states.includes(row.state) ||
    !row.hub.trim() ||
    !row.process.trim()
  )
    throw Error('invalid_persisted_session');
  return record;
}

export class OrmSessions implements SessionRepository {
  constructor(private readonly transactions: Transactions) {}

  shares(transactions: Transactions): boolean {
    return this.transactions.shares(transactions);
  }

  read(resource: IntegrationRef): Promise<SessionRecord | undefined> {
    return this.transactions.run((manager) => this.current(manager, resource));
  }

  update(
    resource: IntegrationRef,
    transition: (current: SessionRecord | undefined) => SessionRecord,
  ): Promise<SessionRecord> {
    return this.transactions.run(async (manager) => {
      const previous = await this.current(manager, resource);
      const next = structuredClone(transition(previous));
      if (sessionKey(next.resource) !== sessionKey(resource))
        throw Error('session_resource_mismatch');
      const row: SessionRow = {
        ...fields(resource),
        hub: next.owner.hubId,
        process: next.owner.processId,
        generation: next.generation,
        state: next.state,
      };
      decode(row);
      if (previous && next.generation < previous.generation)
        throw Error('session_generation_regression');
      await manager.upsert(SessionEntity, row, ['home', 'integration']);
      return next;
    });
  }

  /** Hold the catalog writer lock throughout a local vault operation; fencing waits for it. */
  guard<T>(
    grant: SessionGrant,
    allowed: readonly SessionState[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.transactions.run(async (manager) => {
      const current = await this.current(manager, grant.resource);
      if (
        !current ||
        current.generation !== grant.generation ||
        current.owner.hubId !== grant.owner.hubId ||
        current.owner.processId !== grant.owner.processId ||
        !allowed.includes(current.state)
      )
        throw Error('integration_owner_unavailable');
      return operation();
    });
  }

  private async current(
    manager: EntityManager,
    resource: IntegrationRef,
  ): Promise<SessionRecord | undefined> {
    sessionKey(resource);
    const row = await manager.findOneBy(SessionEntity, fields(resource));
    return row ? decode(row) : undefined;
  }
}
