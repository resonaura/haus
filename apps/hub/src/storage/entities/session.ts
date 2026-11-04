/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntitySchema } from 'typeorm';
import type { SessionState } from '@haus/core/session';

export interface SessionRow {
  home: string;
  integration: string;
  hub: string;
  process: string;
  generation: number;
  state: SessionState;
}

export const SessionEntity = new EntitySchema<SessionRow>({
  name: 'HausSession',
  tableName: 'haus-sessions',
  columns: {
    home: { type: 'text', primary: true },
    integration: { type: 'text', primary: true },
    hub: { type: 'text' },
    process: { type: 'text' },
    generation: { type: 'integer' },
    state: { type: 'text' },
  },
});
