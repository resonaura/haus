/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IPreferencesService } from './preferences.controller.js';
import type { PreferencesResponseDto } from './preferences.dto.js';
import { LIVE_SERVICE } from '../live/tokens.js';
import type { LiveService } from '../live/types.js';

const ALLOWED_PREFERENCE_KEYS = new Set([
  'favorites',
  'hiddenApp',
  'hiddenHome',
  'unhiddenApp',
  'deviceOrder',
  'autoGroupLights',
  'disabledLightGroups',
  'roomIcons',
  'serverDevices',
]);

export interface PreferencesDatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    get(): { revision: string; value: string; updated_at: number } | undefined;
    run(...args: unknown[]): unknown;
  };
}

@Injectable()
export class DefaultPreferencesService implements IPreferencesService {
  private revision = '0';
  private value: Record<string, unknown> = {};
  private updatedAt = 0;
  private readonly listeners = new Set<() => void>();
  private db?: PreferencesDatabaseHandle;

  constructor(
    @Optional()
    @Inject(LIVE_SERVICE)
    private readonly liveService?: LiveService,
  ) {}

  bindDatabase(db: PreferencesDatabaseHandle): void {
    this.db = db;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS shared_config (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
    );
    const row = this.db.prepare('SELECT * FROM shared_config WHERE id=1').get();
    if (row) {
      this.revision = row.revision;
      try {
        this.value = JSON.parse(row.value) as Record<string, unknown>;
      } catch {
        this.value = {};
      }
      this.updatedAt = row.updated_at;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(): PreferencesResponseDto {
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM shared_config WHERE id=1').get();
      if (row) {
        return {
          revision: row.revision,
          value: JSON.parse(row.value) as Record<string, unknown>,
          updatedAt: row.updated_at,
        };
      }
      return { revision: '0', value: {}, updatedAt: 0 };
    }
    return {
      revision: this.revision,
      value: { ...this.value },
      updatedAt: this.updatedAt,
    };
  }

  patch(
    baseRevision: string,
    patch: Record<string, unknown>,
  ): PreferencesResponseDto & { conflict?: boolean } {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => !ALLOWED_PREFERENCE_KEYS.has(key)) ||
      Buffer.byteLength(JSON.stringify(patch)) > 500000
    ) {
      throw new Error('invalid_shared_config');
    }

    const current = this.get();
    if (current.revision !== baseRevision) {
      return { conflict: true, ...current };
    }

    const next: PreferencesResponseDto = {
      revision: randomUUID(),
      value: { ...current.value, ...patch },
      updatedAt: Date.now(),
    };

    if (this.db) {
      this.db
        .prepare(
          'INSERT INTO shared_config(id,revision,value,updated_at)VALUES(1,?,?,?) ON CONFLICT(id)DO UPDATE SET revision=excluded.revision,value=excluded.value,updated_at=excluded.updated_at',
        )
        .run(next.revision, JSON.stringify(next.value), next.updatedAt);
    }

    this.revision = next.revision;
    this.value = next.value;
    this.updatedAt = next.updatedAt;

    if (this.liveService) {
      this.liveService.setRevision(next.revision);
    }

    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }

    return next;
  }
}
