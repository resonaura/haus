/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  openCatalog,
  Transactions,
  OrmIdentities,
  OrmAddresses,
  OrmSessions,
  OrmReceipts,
} from './index.js';

export const CATALOG_SOURCE = 'CATALOG_SOURCE';
export const CATALOG_TRANSACTIONS = 'CATALOG_TRANSACTIONS';

export interface StorageModuleOptions {
  databasePath: string;
}

@Module({})
export class StorageModule implements OnModuleDestroy {
  private static activeSource?: DataSource;

  static forRoot(options: StorageModuleOptions): DynamicModule {
    const sourceProvider = {
      provide: CATALOG_SOURCE,
      useFactory: async (): Promise<DataSource> => {
        const source = await openCatalog(options.databasePath);
        StorageModule.activeSource = source;
        return source;
      },
    };

    const transactionsProvider = {
      provide: CATALOG_TRANSACTIONS,
      useFactory: (source: DataSource): Transactions => new Transactions(source),
      inject: [CATALOG_SOURCE],
    };

    const identitiesProvider = {
      provide: OrmIdentities,
      useFactory: (tx: Transactions): OrmIdentities => new OrmIdentities(tx),
      inject: [CATALOG_TRANSACTIONS],
    };

    const addressesProvider = {
      provide: OrmAddresses,
      useFactory: (tx: Transactions): OrmAddresses => new OrmAddresses(tx),
      inject: [CATALOG_TRANSACTIONS],
    };

    const sessionsProvider = {
      provide: OrmSessions,
      useFactory: (tx: Transactions): OrmSessions => new OrmSessions(tx),
      inject: [CATALOG_TRANSACTIONS],
    };

    const receiptsProvider = {
      provide: OrmReceipts,
      useFactory: (tx: Transactions): OrmReceipts => new OrmReceipts(tx),
      inject: [CATALOG_TRANSACTIONS],
    };

    return {
      module: StorageModule,
      global: true,
      providers: [
        sourceProvider,
        transactionsProvider,
        identitiesProvider,
        addressesProvider,
        sessionsProvider,
        receiptsProvider,
      ],
      exports: [
        CATALOG_SOURCE,
        CATALOG_TRANSACTIONS,
        OrmIdentities,
        OrmAddresses,
        OrmSessions,
        OrmReceipts,
      ],
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (StorageModule.activeSource && StorageModule.activeSource.isInitialized) {
      await StorageModule.activeSource.destroy();
      StorageModule.activeSource = undefined;
    }
  }
}
