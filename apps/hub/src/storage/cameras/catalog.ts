/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Transactions } from '../transactions.js';
import { NativeCatalog } from './native.js';
import { SessionCatalog } from './sessions.js';
import { ActivityCatalog } from './activity.js';

/** Shared TypeORM owner; initialize before constructing synchronous runtime consumers. */
export class CameraCatalog {
  readonly native: NativeCatalog;
  readonly sessions: SessionCatalog;
  readonly activity: ActivityCatalog;
  private initialization?: Promise<void>;
  constructor(transactions: Transactions) {
    this.native = new NativeCatalog(transactions);
    this.sessions = new SessionCatalog(transactions);
    this.activity = new ActivityCatalog(transactions);
  }
  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }
  private async load(): Promise<void> {
    await this.native.initialize();
    await this.sessions.initialize();
    await this.activity.initialize();
  }
}
