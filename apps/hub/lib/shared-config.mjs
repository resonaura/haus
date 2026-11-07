/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { DefaultPreferencesService } from '@haus/hub/preferences';

export class SharedConfig {
  constructor(transactions, onChange = () => {}) {
    this.service = new DefaultPreferencesService(transactions);
    this.onChange = onChange;
    this.listeners = new Set();
    this.revision = '0';
    this.ready = this.get();
  }

  async get() {
    const current = await this.service.get();
    this.revision = current.revision;
    return current;
  }

  async patch(baseRevision, patch) {
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

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
