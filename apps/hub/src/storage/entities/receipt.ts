/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { CommandStatus, CommandReason } from '@haus/core/command';

export interface ReceiptRow {
  home: string;
  actor: string;
  key: string;
  fingerprint: string;
  command: string;
  correlation: string;
  generation: number;
  status: CommandStatus;
  reason: CommandReason | null;
}

export const ReceiptEntity = new EntitySchema<ReceiptRow>({
  name: 'HausReceipt',
  tableName: 'haus-receipts',
  columns: {
    home: { type: 'text', primary: true },
    actor: { type: 'text', primary: true },
    key: { type: 'text', name: 'idempotency-key', primary: true },
    fingerprint: { type: 'text' },
    command: { type: 'text', name: 'command-id' },
    correlation: { type: 'text', name: 'correlation-id' },
    generation: { type: 'integer', name: 'owner-generation' },
    status: { type: 'text' },
    reason: { type: 'text', nullable: true },
  },
});
