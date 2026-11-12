/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Module, type DynamicModule } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { BackupCatalog } from '../backup/catalog.js';
import { Backups } from '../backup/backups.js';
import { ClusterCatalog } from '../cluster/catalog.js';
import { Cluster } from '../cluster/cluster.js';
import { CamerasModule } from '../camera/camera.module.js';
import { NvrCameraSessions } from '../camera/sessions/sessions.js';
import { CameraCatalog } from '../storage/cameras/catalog.js';
import { NativeCameraSources } from '../camera/control/sources.js';
import { Recorder } from './recorder/recorder.js';
import { RecordingOwner } from './owner.js';
import {
  RECORDING_BACKUPS,
  RECORDING_CAMERAS,
  RECORDING_CLUSTER,
  RECORDING_CONFIG,
  RECORDING_SESSIONS,
} from './tokens.js';
import { activityProviders } from './activity.js';
import { maintenanceProviders } from './maintenance.js';
import { stopRecordingRuntime } from '../runtime/recording.js';
import { defaults } from '../runtime/appliance-config.js';
import { CatalogLifetime } from '../storage/lifetime.js';
import { CATALOG_TRANSACTIONS } from '../storage/storage.module.js';
import type { Transactions } from '../storage/transactions.js';
import { RecordingStore } from './recording.store.js';

export {
  RECORDING_BACKUPS,
  RECORDING_CAMERAS,
  RECORDING_CLUSTER,
  RECORDING_CONFIG,
  RECORDING_SESSIONS,
};

/**
 * Owns the recording cluster and backup engines on the shared catalog. Both stop before
 * recording stores and the connection close, so late replication cannot touch a closed catalog.
 */
@Module({})
export class RecordingRuntimeModule {
  static forRoot(
    dataDirectory: string,
    mediaDirectory = join(dataDirectory, 'media'),
  ): DynamicModule {
    if (!dataDirectory.trim()) throw Error('invalid_recording_data_directory');
    const data = resolve(dataDirectory);
    const media = resolve(mediaDirectory);
    return {
      module: RecordingRuntimeModule,
      global: true,
      imports: [CamerasModule],
      providers: [
        { provide: RECORDING_CONFIG, useValue: { ...defaults, data, media, standalone: true } },
        {
          provide: RECORDING_BACKUPS,
          inject: [CatalogLifetime, CATALOG_TRANSACTIONS, RecordingStore],
          useFactory: async (
            lifetime: CatalogLifetime,
            transactions: Transactions,
            store: RecordingStore,
          ): Promise<Backups> => {
            const backups = new Backups(
              { data, standalone: true },
              store,
              new BackupCatalog(transactions),
            );
            await backups.initialize();
            lifetime.defer(() => backups.stop());
            return backups;
          },
        },
        {
          provide: RECORDING_CLUSTER,
          inject: [CatalogLifetime, CATALOG_TRANSACTIONS, RecordingStore, RECORDING_BACKUPS],
          useFactory: async (
            lifetime: CatalogLifetime,
            transactions: Transactions,
            store: RecordingStore,
            backups: Backups,
          ): Promise<Cluster> => {
            const cluster = new Cluster(store, backups, {
              catalog: new ClusterCatalog(transactions),
            });
            await cluster.initialize();
            lifetime.defer(() => cluster.stop());
            return cluster;
          },
        },
        {
          provide: RECORDING_CAMERAS,
          inject: [NativeCameraSources],
          useFactory:
            (sources: NativeCameraSources) => (): ReturnType<NativeCameraSources['merge']> =>
              sources.merge({ cameras: [], devices: [], entities: [], states: [] }),
        },
        {
          provide: RECORDING_SESSIONS,
          inject: [
            CatalogLifetime,
            RecordingStore,
            RECORDING_CLUSTER,
            CameraCatalog,
            RECORDING_CAMERAS,
          ],
          useFactory: (
            lifetime: CatalogLifetime,
            store: RecordingStore,
            cluster: Cluster,
            catalog: CameraCatalog,
            cameras: () => ReturnType<NativeCameraSources['merge']>,
          ): NvrCameraSessions => {
            const sessions = new NvrCameraSessions({
              config: { ...defaults },
              store,
              catalog,
              cluster,
              registry: () => ({ cameras: cameras() }),
            });
            lifetime.defer(() => sessions.stop());
            return sessions;
          },
        },
        {
          provide: Recorder,
          inject: [CatalogLifetime, RecordingStore, RECORDING_CLUSTER, RECORDING_SESSIONS],
          useFactory: (
            lifetime: CatalogLifetime,
            store: RecordingStore,
            cluster: Cluster,
            sessions: NvrCameraSessions,
          ): Recorder => {
            const recorder = new Recorder({ ...defaults, data, media }, {}, store, undefined, {
              prepareRemote: (event, options) => cluster.preparePlayback(event, options),
              capture: sessions,
            });
            lifetime.defer(() => stopRecordingRuntime(recorder, sessions));
            return recorder;
          },
        },
        ...activityProviders(),
        ...maintenanceProviders(),
        RecordingOwner,
      ],
      exports: [RECORDING_BACKUPS, RECORDING_CLUSTER, RECORDING_SESSIONS, Recorder],
    };
  }
}
