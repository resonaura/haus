/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import { SharedConfigEntity } from '../storage/entities/domains.js';
import type { Transactions } from '../storage/transactions.js';
import type { IPreferencesService } from './preferences.controller.js';
import type { PreferencesResponseDto } from './preferences.dto.js';
import { LIVE_SERVICE } from '../live/tokens.js';
import type { LiveService } from '../live/types.js';
import { ClusterTransferManager, CLUSTER_TRANSFER_MANAGER } from '../cluster/transfer.js';

const ALLOWED_PREFERENCE_KEYS = new Set([
  'homeName',
  'favorites',
  'hiddenApp',
  'hiddenHome',
  'unhiddenApp',
  'deviceOrder',
  'autoGroupLights',
  'disabledLightGroups',
  'roomIcons',
  'serverDevices',
  'mqttExportDevices',
]);

@Injectable()
export class DefaultPreferencesService implements IPreferencesService {
  private revision = '0';
  private value: Record<string, unknown> = {};
  private updatedAt = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    @Optional()
    @Inject(CATALOG_TRANSACTIONS)
    private readonly transactions?: Transactions,
    @Optional()
    @Inject(LIVE_SERVICE)
    private readonly liveService?: LiveService,
    @Optional()
    @Inject(CLUSTER_TRANSFER_MANAGER)
    private readonly transferManager?: ClusterTransferManager,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async get(): Promise<PreferencesResponseDto> {
    if (!this.transactions) return this.current();
    return this.transactions.run(async (manager) => {
      const row = await manager.findOneBy(SharedConfigEntity, { id: 1 });
      return row
        ? {
            revision: row.revision,
            value: JSON.parse(row.value) as Record<string, unknown>,
            updatedAt: row.updatedAt,
          }
        : this.current();
    });
  }

  async patch(
    baseRevision: string,
    patch: Record<string, unknown>,
  ): Promise<PreferencesResponseDto & { conflict?: boolean }> {
    this.transferManager?.assertNotFenced();
    this.validate(patch);
    if (!this.transactions) {
      const current = this.current();
      if (current.revision !== baseRevision) return { conflict: true, ...current };
      const next = this.next(current, patch);
      this.accept(next);
      return next;
    }

    const result = await this.transactions.run<PreferencesResponseDto & { conflict?: boolean }>(
      async (manager) => {
        const row = await manager.findOneBy(SharedConfigEntity, { id: 1 });
        const current = row
          ? {
              revision: row.revision,
              value: JSON.parse(row.value) as Record<string, unknown>,
              updatedAt: row.updatedAt,
            }
          : this.current();
        if (current.revision !== baseRevision) return { conflict: true as const, ...current };
        const next = this.next(current, patch);
        await manager.upsert(
          SharedConfigEntity,
          {
            id: 1,
            revision: next.revision,
            value: JSON.stringify(next.value),
            updatedAt: next.updatedAt,
          },
          ['id'],
        );
        return next;
      },
    );
    if (result.conflict !== true) this.accept(result);
    return result;
  }

  private validate(patch: Record<string, unknown>): void {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => !ALLOWED_PREFERENCE_KEYS.has(key)) ||
      Buffer.byteLength(JSON.stringify(patch)) > 500000
    ) {
      throw new Error('invalid_shared_config');
    }
    if ('mqttExportDevices' in patch && !validMqttExportDeviceIds(patch.mqttExportDevices))
      throw new Error('invalid_shared_config');
  }

  private current(): PreferencesResponseDto {
    return { revision: this.revision, value: { ...this.value }, updatedAt: this.updatedAt };
  }

  private next(
    current: PreferencesResponseDto,
    patch: Record<string, unknown>,
  ): PreferencesResponseDto {
    return {
      revision: randomUUID(),
      value: { ...current.value, ...patch },
      updatedAt: Date.now(),
    };
  }

  private accept(next: PreferencesResponseDto): void {
    this.revision = next.revision;
    this.value = next.value;
    this.updatedAt = next.updatedAt;
    this.liveService?.setRevision(next.revision);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        process.emitWarning(error instanceof Error ? error : String(error));
      }
    }
  }
}

function validMqttExportDeviceIds(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 10000) return false;
  const ids: readonly unknown[] = value;
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 512) return false;
    unique.add(id);
  }
  return unique.size === ids.length;
}
