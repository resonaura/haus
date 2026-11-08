/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Transactions } from '../storage/transactions.js';
import type { PreferencesResponseDto } from './preferences.dto.js';
import { DefaultPreferencesService } from './preferences.service.js';

export class SharedConfig {
  service: DefaultPreferencesService;
  onChange: () => void;
  listeners = new Set<() => void>();
  revision = '0';
  ready: Promise<PreferencesResponseDto>;

  constructor(transactions?: Transactions, onChange: () => void = () => {}) {
    this.service = new DefaultPreferencesService(transactions);
    this.onChange = onChange;
    this.ready = this.get();
  }

  async get(): Promise<PreferencesResponseDto> {
    const current = await this.service.get();
    this.revision = current.revision;
    return current;
  }

  async patch(
    baseRevision: string,
    patch: Record<string, unknown>,
  ): Promise<PreferencesResponseDto & { conflict?: boolean }> {
    await this.ready;
    const result = await this.service.patch(baseRevision, patch);
    if (result.conflict) return result;
    this.revision = result.revision;
    this.onChange();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        process.emitWarning(error instanceof Error ? error : String(error));
      }
    }
    return result;
  }

  subscribe(listener: () => void): () => boolean {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
