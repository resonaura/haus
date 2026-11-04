/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  CommandEntry,
  CommandJournal,
  CommandOutcome,
  CommandScope,
} from '../../src/command/types.js';

export class ReceiptDatabase implements CommandJournal {
  private readonly records = new Map<string, CommandEntry>();
  async reserve(entry: CommandEntry) {
    const key = this.key(entry.scope),
      current = this.records.get(key);
    if (current) return { created: false, entry: structuredClone(current) };
    this.records.set(key, structuredClone(entry));
    return { created: true, entry: structuredClone(entry) };
  }

  async settle(entry: CommandEntry): Promise<CommandOutcome> {
    const key = this.key(entry.scope),
      current = this.records.get(key);
    if (
      !current ||
      current.fingerprint !== entry.fingerprint ||
      current.outcome.commandId !== entry.outcome.commandId ||
      current.outcome.ownerGeneration !== entry.outcome.ownerGeneration
    )
      throw Error('journal_conflict');
    if (current.outcome.reason !== 'dispatch-pending') return structuredClone(current.outcome);
    this.records.set(key, structuredClone(entry));
    return structuredClone(entry.outcome);
  }

  private key(scope: CommandScope): string {
    return JSON.stringify([scope.homeId, scope.actorId, scope.idempotencyKey]);
  }
}
