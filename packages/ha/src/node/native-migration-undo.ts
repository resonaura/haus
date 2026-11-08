/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  preferences,
  sameEntity,
  stable,
  type MigrationPlan,
  type Preferences,
  type RegistryDevice,
  type RegistryEntity,
} from '@haus/bridge/migration';
import type { MigrationHaPort } from './native-migration-documents.js';

export interface UndoMigrationContext {
  ha: MigrationHaPort;
  isClosed(): boolean;
  ownsActivity(cameraId: string): boolean;
  save(
    id: string,
    record: {
      phase: string;
      plan: MigrationPlan;
      error?: string;
      rollbackFailures?: string[];
      at?: number;
    },
  ): Promise<void>;
  rename(
    expected: RegistryEntity,
    from: string,
    to: string,
    patch: Preferences,
    expectedPreferences?: Preferences,
  ): Promise<void>;
  device(
    device: { before: RegistryDevice; preferences: Preferences },
    undo: boolean,
  ): Promise<void>;
  entry(entry: { entry_id: string; disabled_by: string | null }, undo: boolean): Promise<void>;
}

export async function undoMigrationPlan(
  ctx: UndoMigrationContext,
  id: string,
  record: {
    phase: string;
    plan: MigrationPlan;
    error?: string;
    rollbackFailures?: string[];
    at?: number;
  },
  automatic = false,
): Promise<void> {
  if (record.plan.cameraIds.some((cameraId) => ctx.ownsActivity(cameraId))) {
    throw Error('migration_already_committed');
  }
  await ctx.save(id, { ...record, phase: 'undoing' });
  const failures: string[] = [];
  for (const device of [...record.plan.devices].reverse()) {
    try {
      await ctx.device(device, true);
    } catch {
      failures.push('Device preferences');
    }
  }
  for (const move of [...record.plan.moves].reverse()) {
    if (ctx.isClosed()) {
      await ctx.save(id, { ...record, phase: 'interrupted' });
      return;
    }
    try {
      const all = (await ctx.ha.request({
        type: 'config/entity_registry/list',
      })) as RegistryEntity[];
      const native = move.native && all.find((entity) => entity.id === move.native!.id);
      const old = all.find((entity) => entity.id === move.legacy.id);
      if (move.native && native?.entity_id === move.legacy.entity_id) {
        const full = (await ctx.ha.request({
          type: 'config/entity_registry/get',
          entity_id: native.entity_id,
        })) as RegistryEntity;
        if (stable(preferences(full)) !== stable(move.preferences)) {
          throw Error('migration_user_edit');
        }
        await ctx.rename(
          move.native,
          native.entity_id,
          move.native.entity_id,
          preferences(move.native),
          preferences(full),
        );
      } else if (
        move.native &&
        (!sameEntity(native, move.native) || native?.entity_id !== move.native.entity_id)
      ) {
        throw Error('migration_native_changed');
      }
      if (old?.entity_id === move.parked) {
        const full = (await ctx.ha.request({
          type: 'config/entity_registry/get',
          entity_id: old.entity_id,
        })) as RegistryEntity;
        if (
          stable(preferences(full)) !==
          stable({ ...preferences(move.legacy), hidden_by: 'user', disabled_by: 'user' })
        ) {
          throw Error('migration_user_edit');
        }
        await ctx.rename(
          move.legacy,
          move.parked,
          move.legacy.entity_id,
          preferences(move.legacy),
          preferences(full),
        );
      } else if (!sameEntity(old, move.legacy) || old?.entity_id !== move.legacy.entity_id) {
        throw Error('migration_legacy_changed');
      }
    } catch {
      failures.push(move.legacy.entity_id);
    }
  }
  if (!failures.length) {
    for (const entry of record.plan.entries) {
      try {
        await ctx.entry(entry, true);
      } catch {
        failures.push('Camera integration');
      }
    }
  }
  await ctx.save(id, {
    ...record,
    phase: failures.length ? 'needs_attention' : 'undone',
    error: automatic ? 'migration_reverted' : undefined,
    rollbackFailures: [...new Set(failures)],
  });
}
