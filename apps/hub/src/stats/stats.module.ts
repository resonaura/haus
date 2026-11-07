/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Module, type DynamicModule, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';
import { StatsStore } from './stats.store.js';
import { openStatsSource } from './stats.source.js';
import { StatsEngine } from './stats.engine.js';
import { StatsCollector } from './stats.collector.js';
import {
  STATS_COLLECTOR,
  STATS_ENGINE,
  STATS_SERVICE,
  STATS_SOURCE,
  STATS_STORE,
} from './tokens.js';

function defaultStatsPath(): string {
  return join(process.env.HAUS_DATA_DIR ?? tmpdir(), 'hub-stats.sqlite');
}

class StatsRuntime implements OnModuleDestroy {
  constructor(
    private readonly engine: StatsEngine,
    private readonly store: StatsStore,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.engine.stop();
    await this.store.close();
  }
}

export interface StatsModuleOptions {
  readonly dbPath?: string;
  readonly store?: StatsStore;
  readonly engine?: StatsEngine;
  readonly service?: StatsService;
}

@Module({})
export class StatsModule {
  public static forRoot(options: StatsModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [];
    const statsExports: Array<symbol | typeof StatsService> = [
      STATS_STORE,
      STATS_ENGINE,
      STATS_COLLECTOR,
      STATS_SERVICE,
      StatsService,
    ];
    if (options.store) {
      providers.push({ provide: STATS_STORE, useValue: options.store });
    } else {
      statsExports.push(STATS_SOURCE);
      providers.push({
        provide: STATS_SOURCE,
        useFactory: () => openStatsSource(options.dbPath ?? defaultStatsPath()),
      });
      providers.push({
        provide: STATS_STORE,
        inject: [STATS_SOURCE],
        useFactory: (source: Awaited<ReturnType<typeof openStatsSource>>) => new StatsStore(source),
      });
    }

    if (options.engine) {
      providers.push({ provide: STATS_ENGINE, useValue: options.engine });
    } else {
      providers.push({
        provide: STATS_ENGINE,
        inject: [STATS_STORE],
        useFactory: async (store: StatsStore) => {
          const engine = new StatsEngine(store);
          await engine.initialize();
          engine.start();
          return engine;
        },
      });
    }

    providers.push({
      provide: STATS_COLLECTOR,
      inject: [STATS_ENGINE],
      useFactory: (engine: StatsEngine) => new StatsCollector(engine),
    });
    const serviceProvider = options.service
      ? { provide: StatsService, useValue: options.service }
      : {
          provide: StatsService,
          inject: [STATS_STORE, STATS_ENGINE],
          useFactory: (store: StatsStore, engine: StatsEngine) => new StatsService(store, engine),
        };
    providers.push(serviceProvider);
    providers.push({ provide: STATS_SERVICE, inject: [StatsService], useExisting: StatsService });
    providers.push({
      provide: StatsRuntime,
      inject: [STATS_ENGINE, STATS_STORE],
      useFactory: (engine: StatsEngine, store: StatsStore) => new StatsRuntime(engine, store),
    });

    return {
      module: StatsModule,
      controllers: [StatsController],
      providers,
      exports: statsExports,
    };
  }
}
