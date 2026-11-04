/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  CommandEntry,
  CommandJournal,
  CommandOutcome,
  CommandReason,
  CommandStatus,
} from '@haus/core/command';
import { ReceiptEntity, type ReceiptRow } from './entities/receipt.js';
import type { Transactions } from './transactions.js';

const statuses: readonly CommandStatus[] = ['accepted', 'confirmed', 'failed', 'unknown'];
const reasons: readonly CommandReason[] = [
  'dispatch-pending',
  'provider-rejected',
  'transport-lost',
  'owner-changed',
  'permission-denied',
  'timeout',
  'journal-unavailable',
];
const scope = (entry: CommandEntry) => ({
  home: entry.scope.homeId,
  actor: entry.scope.actorId,
  key: entry.scope.idempotencyKey,
});
const selector = (row: ReceiptRow) => ({ home: row.home, actor: row.actor, key: row.key });

function encode(entry: CommandEntry): ReceiptRow {
  const { outcome } = entry;
  if (
    outcome.schema !== 'haus.receipt' ||
    outcome.version !== 1 ||
    !statuses.includes(outcome.status) ||
    (outcome.reason !== undefined && !reasons.includes(outcome.reason)) ||
    !Number.isSafeInteger(outcome.ownerGeneration) ||
    outcome.ownerGeneration < 1
  )
    throw Error('invalid_command_entry');
  for (const value of [
    entry.scope.homeId,
    entry.scope.actorId,
    entry.scope.idempotencyKey,
    entry.fingerprint,
    outcome.commandId,
    outcome.correlationId,
  ])
    if (typeof value !== 'string' || !value.trim() || value.length > 4096)
      throw Error('invalid_command_entry');
  return {
    ...scope(entry),
    fingerprint: entry.fingerprint,
    command: outcome.commandId,
    correlation: outcome.correlationId,
    generation: outcome.ownerGeneration,
    status: outcome.status,
    reason: outcome.reason ?? null,
  };
}

function decode(row: ReceiptRow): CommandEntry {
  const entry: CommandEntry = {
    scope: { homeId: row.home, actorId: row.actor, idempotencyKey: row.key },
    fingerprint: row.fingerprint,
    outcome: {
      schema: 'haus.receipt',
      version: 1,
      commandId: row.command,
      correlationId: row.correlation,
      ownerGeneration: row.generation,
      status: row.status,
      ...(row.reason !== null ? { reason: row.reason } : {}),
    },
  };
  encode(entry);
  return entry;
}

export class OrmReceipts implements CommandJournal {
  constructor(private readonly transactions: Transactions) {}

  reserve(
    entry: CommandEntry,
  ): Promise<{ readonly created: boolean; readonly entry: CommandEntry }> {
    const row = encode(entry);
    if (row.status !== 'unknown' || row.reason !== 'dispatch-pending')
      throw Error('invalid_command_reservation');
    return this.transactions.run(async (manager) => {
      const previous = await manager.findOneBy(ReceiptEntity, selector(row));
      if (previous) return { created: false, entry: decode(previous) };
      await manager.insert(ReceiptEntity, row);
      return { created: true, entry: decode(row) };
    });
  }

  settle(entry: CommandEntry): Promise<CommandOutcome> {
    const row = encode(entry);
    return this.transactions.run(async (manager) => {
      const previous = await manager.findOneBy(ReceiptEntity, selector(row));
      if (
        !previous ||
        previous.fingerprint !== row.fingerprint ||
        previous.command !== row.command ||
        previous.generation !== row.generation
      )
        throw Error('command_reservation_mismatch');
      const current = decode(previous);
      if (previous.status !== 'unknown' || previous.reason !== 'dispatch-pending')
        return current.outcome;
      await manager.update(ReceiptEntity, selector(row), row);
      return decode(row).outcome;
    });
  }
}
