/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { ResourceScope } from '@haus/core/lifecycle';
import type { DataSource } from 'typeorm';
import type { Transactions } from './transactions.js';

export class CatalogLifetime {
  private readonly resources = new ResourceScope();
  private readonly stores = new ResourceScope();
  private closing?: Promise<void>;
  private stateValue: 'open' | 'closing' | 'closed' | 'failed' = 'open';

  constructor(
    readonly source: DataSource,
    readonly transactions: Transactions,
  ) {
    if (!source.isInitialized || transactions.dataSource !== source)
      throw Error('invalid_catalog_lifetime');
  }

  get state(): 'open' | 'closing' | 'closed' | 'failed' {
    return this.stateValue;
  }

  defer(close: () => void | Promise<void>): void {
    if (this.stateValue !== 'open') throw Error('catalog_closing');
    this.resources.defer(close);
  }

  /** Logical stores may close their queues only after asynchronous writers have stopped. */
  deferStore(close: () => void | Promise<void>): void {
    if (this.stateValue !== 'open') throw Error('catalog_closing');
    this.stores.defer(close);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stateValue = 'closing';
    return (this.closing = Promise.resolve().then(() => this.release()));
  }

  private async release(): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.resources.close();
    } catch (error) {
      // A failed writer has not proved quiescence; keep its stores/connection available.
      this.stateValue = 'failed';
      throw new AggregateError([error], 'catalog_shutdown_failed');
    }
    try {
      await this.stores.close();
    } catch (error) {
      failures.push(error);
    }
    let drained = false;
    try {
      await this.transactions.drain();
      drained = true;
    } catch (error) {
      failures.push(error);
    }
    if (drained && this.source.isInitialized) {
      try {
        await this.source.destroy();
      } catch (error) {
        failures.push(error);
      }
    }
    this.stateValue = failures.length ? 'failed' : 'closed';
    if (failures.length) throw new AggregateError(failures, 'catalog_shutdown_failed');
  }
}
