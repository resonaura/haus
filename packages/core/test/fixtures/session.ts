/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { sessionKey } from '../../src/session/ownership.js';
import type { IntegrationRef, SessionRecord, SessionRepository } from '../../src/session/types.js';

export class SessionDatabase implements SessionRepository {
  private readonly records = new Map<string, SessionRecord>();

  read(resource: IntegrationRef): SessionRecord | undefined {
    const record = this.records.get(sessionKey(resource));
    return record ? structuredClone(record) : undefined;
  }

  update(
    resource: IntegrationRef,
    transition: (current: SessionRecord | undefined) => SessionRecord,
  ): SessionRecord {
    const next = transition(this.read(resource));
    this.records.set(sessionKey(resource), structuredClone(next));
    return structuredClone(next);
  }
}
