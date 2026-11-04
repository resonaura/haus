/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { sessionKey } from '../../src/session/ownership.js';
import type { IntegrationRef, SessionRecord, SessionRepository } from '../../src/session/types.js';

export class SessionDatabase implements SessionRepository {
  private readonly records = new Map<string, SessionRecord>();
  private queue = Promise.resolve();

  read(resource: IntegrationRef): Promise<SessionRecord | undefined> {
    return this.run(() => this.current(resource));
  }

  update(
    resource: IntegrationRef,
    transition: (current: SessionRecord | undefined) => SessionRecord,
  ): Promise<SessionRecord> {
    return this.run(() => {
      const next = transition(this.current(resource));
      this.records.set(sessionKey(resource), structuredClone(next));
      return structuredClone(next);
    });
  }

  private current(resource: IntegrationRef): SessionRecord | undefined {
    const record = this.records.get(sessionKey(resource));
    return record ? structuredClone(record) : undefined;
  }

  private run<T>(operation: () => T): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
