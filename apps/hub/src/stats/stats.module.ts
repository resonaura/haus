/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Module, type DynamicModule } from '@nestjs/common';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';
import { StatsStore } from './stats.store.js';
import { StatsEngine } from './stats.engine.js';
import { StatsCollector } from './stats.collector.js';
import { STATS_COLLECTOR, STATS_ENGINE, STATS_SERVICE, STATS_STORE } from './tokens.js';

export interface StatsModuleOptions {
  readonly dbPath?: string;
  readonly store?: StatsStore;
  readonly engine?: StatsEngine;
  readonly service?: StatsService;
}

@Module({
  controllers: [StatsController],
  providers: [
    {
      provide: STATS_STORE,
      useFactory: () => {
        const dbPath = join(process.env.HAUS_DATA_DIR ?? tmpdir(), 'hub-stats.sqlite');
        return new StatsStore(dbPath);
      },
    },
    {
      provide: STATS_ENGINE,
      inject: [STATS_STORE],
      useFactory: (store: StatsStore) => {
        const engine = new StatsEngine(store);
        engine.start();
        return engine;
      },
    },
    {
      provide: STATS_COLLECTOR,
      inject: [STATS_ENGINE],
      useFactory: (engine: StatsEngine) => new StatsCollector(engine),
    },
    {
      provide: StatsService,
      inject: [STATS_STORE, STATS_ENGINE],
      useFactory: (store: StatsStore, engine: StatsEngine) => new StatsService(store, engine),
    },
    {
      provide: STATS_SERVICE,
      inject: [StatsService],
      useExisting: StatsService,
    },
  ],
  exports: [STATS_STORE, STATS_ENGINE, STATS_COLLECTOR, STATS_SERVICE, StatsService],
})
export class StatsModule {
  public static forRoot(options: StatsModuleOptions = {}): DynamicModule {
    const store =
      options.store ??
      new StatsStore(
        options.dbPath ?? join(process.env.HAUS_DATA_DIR ?? tmpdir(), 'hub-stats.sqlite'),
      );
    const engine = options.engine ?? new StatsEngine(store);
    const collector = new StatsCollector(engine);
    const service = options.service ?? new StatsService(store, engine);

    return {
      module: StatsModule,
      controllers: [StatsController],
      providers: [
        { provide: STATS_STORE, useValue: store },
        { provide: STATS_ENGINE, useValue: engine },
        { provide: STATS_COLLECTOR, useValue: collector },
        { provide: StatsService, useValue: service },
        { provide: STATS_SERVICE, useValue: service },
      ],
      exports: [STATS_STORE, STATS_ENGINE, STATS_COLLECTOR, STATS_SERVICE, StatsService],
    };
  }
}
