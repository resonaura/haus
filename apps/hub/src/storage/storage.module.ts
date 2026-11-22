/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DataSource } from 'typeorm';
import { HUB_DATA_DIRECTORY } from '../cluster/crypto/master-key.js';
import { isPostgresUrl, resolveCatalogTarget } from './dialect.js';
import { CatalogLifetime } from './lifetime.js';
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
  dataDirectory?: string;
}

@Module({})
export class StorageModule implements OnModuleDestroy {
  constructor(@Inject(CatalogLifetime) private readonly lifetime: CatalogLifetime) {}

  static forRoot(options: StorageModuleOptions): DynamicModule {
    const resolvedTarget =
      options.databasePath === ':memory:' || isPostgresUrl(options.databasePath)
        ? options.databasePath
        : resolveCatalogTarget(options.databasePath);
    const dataDirectory =
      options.dataDirectory ??
      (isPostgresUrl(options.databasePath)
        ? (process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data')
        : dirname(options.databasePath));

    const sourceProvider = {
      provide: CATALOG_SOURCE,
      useFactory: async (): Promise<DataSource> => {
        if (!isPostgresUrl(resolvedTarget)) {
          await mkdir(dirname(resolvedTarget), { recursive: true, mode: 0o700 });
        } else {
          await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
        }
        return openCatalog(resolvedTarget);
      },
    };

    const transactionsProvider = {
      provide: CATALOG_TRANSACTIONS,
      useFactory: (source: DataSource): Transactions => new Transactions(source),
      inject: [CATALOG_SOURCE],
    };

    const lifetimeProvider = {
      provide: CatalogLifetime,
      useFactory: (source: DataSource, transactions: Transactions) =>
        new CatalogLifetime(source, transactions),
      inject: [CATALOG_SOURCE, CATALOG_TRANSACTIONS],
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

    const dataDirProvider = {
      provide: HUB_DATA_DIRECTORY,
      useValue: dataDirectory,
    };

    return {
      module: StorageModule,
      global: true,
      providers: [
        StorageModule,
        dataDirProvider,
        sourceProvider,
        transactionsProvider,
        lifetimeProvider,
        identitiesProvider,
        addressesProvider,
        sessionsProvider,
        receiptsProvider,
      ],
      exports: [
        HUB_DATA_DIRECTORY,
        CATALOG_SOURCE,
        CATALOG_TRANSACTIONS,
        CatalogLifetime,
        OrmIdentities,
        OrmAddresses,
        OrmSessions,
        OrmReceipts,
      ],
    };
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.lifetime.close();
    } catch {
      // Nest logs hook errors; private adapter causes stay on the explicit close promise.
      throw Error('catalog_shutdown_failed');
    }
  }
}
