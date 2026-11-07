/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { EntitySchema } from 'typeorm';

export interface PreparationAttemptRow {
  eventId: string;
  nextAt: number;
}

export const PreparationAttemptEntity = new EntitySchema<PreparationAttemptRow>({
  name: 'PreparationAttempt',
  tableName: 'background_preparation_attempts',
  columns: {
    eventId: { type: 'text', name: 'event_id', primary: true },
    nextAt: { type: 'integer', name: 'next_at' },
  },
});
