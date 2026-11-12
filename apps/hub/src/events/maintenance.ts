/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { Cluster } from '../cluster/cluster.js';
import type { LoadedHubConfig } from '../runtime/appliance-config.js';
import { RetentionCatalog } from '../storage/retention/catalog.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { RecentPlayback } from './playback.js';
import { Recorder } from './recorder/recorder.js';
import { RecordingStore } from './recording.store.js';
import { RECORDING_BACKUPS, RECORDING_CLUSTER, RECORDING_CONFIG } from './tokens.js';

type Config = Pick<LoadedHubConfig, 'retention_days' | 'max_storage_gb'> &
  Parameters<Cluster['enableRecordingCache']>[0];

export interface MaintenanceStore {
  prune(options: { retention_days: number; max_storage_gb?: number }): Promise<number>;
}
export interface MaintenanceCluster {
  recordingCache?: { trim(): Promise<unknown> } | undefined;
  tick(): Promise<void> | undefined;
}
export interface MaintenanceBackups {
  tick(): Promise<void>;
}
export interface MaintenanceRecent {
  tick(): Promise<unknown> | undefined;
}
export interface MaintenanceConfig {
  retention_days: number;
  max_storage_gb?: number;
}

/** Retention catalog, replica cache and recent-playback preparation over the shared catalog. */
export function maintenanceProviders(): Provider[] {
  return [
    {
      provide: RetentionCatalog,
      inject: [CATALOG_TRANSACTIONS],
      useFactory: (transactions: Transactions): RetentionCatalog =>
        new RetentionCatalog(transactions),
    },
    {
      provide: RecentPlayback,
      inject: [RecordingStore, Recorder, RECORDING_CLUSTER, RetentionCatalog, RECORDING_CONFIG],
      useFactory: (
        store: RecordingStore,
        recorder: Recorder,
        cluster: Cluster,
        catalog: RetentionCatalog,
        config: Config,
      ): RecentPlayback => {
        cluster.enableRecordingCache(config, catalog);
        return new RecentPlayback(store, recorder, cluster, { catalog });
      },
    },
    RecordingMaintenance,
  ];
}

/** Legacy scheduler cadence; every loop is single-flight and ignores a stopped owner. */
@Injectable()
export class RecordingMaintenance implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    @Inject(RecordingStore) private readonly store: MaintenanceStore,
    @Inject(RECORDING_CLUSTER) private readonly cluster: MaintenanceCluster,
    @Inject(RECORDING_BACKUPS) private readonly backups: MaintenanceBackups,
    @Inject(RecentPlayback) private readonly recent: MaintenanceRecent,
    @Inject(RECORDING_CONFIG) private readonly config: MaintenanceConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.every('retention', 60_000, async () => {
      await this.store.prune(this.config);
      await this.cluster.recordingCache?.trim();
    });
    this.every('backups', 15_000, () => this.backups.tick());
    this.every('distribution', 10_000, async () => {
      await this.cluster.tick();
      await this.recent.tick();
    });
    this.every('recent', 2_000, () => this.recent.tick());
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  private every(name: string, ms: number, work: () => Promise<unknown> | undefined): void {
    const timer = setInterval(() => {
      if (this.running.has(name)) return;
      this.running.add(name);
      void Promise.resolve()
        .then(work)
        .catch(() => {})
        .finally(() => this.running.delete(name));
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }
}
