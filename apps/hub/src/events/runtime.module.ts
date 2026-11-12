/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Module, type DynamicModule } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { BackupCatalog } from '../backup/catalog.js';
import { Backups } from '../backup/backups.js';
import { ClusterCatalog } from '../cluster/catalog.js';
import { Cluster } from '../cluster/cluster.js';
import { CamerasModule } from '../camera/camera.module.js';
import { CameraAvailability } from '../camera/control/availability.js';
import { WarmStreams } from '../camera/control/warm.js';
import { NvrCameraSessions } from '../camera/sessions/sessions.js';
import { CameraCatalog } from '../storage/cameras/catalog.js';
import { NativeCameraSources } from '../camera/control/sources.js';
import { CameraSnapshots } from '../camera/control/snapshots.js';
import { createTalkback, type Talkback } from '../camera/control/talkback.js';
import { CAMERA_SNAPSHOTS, CAMERA_TALKBACK } from '../camera/tokens.js';
import { NativeCameraControls } from '../camera/control/native.js';
import { cameraSpotlight } from '../camera/control/spotlight.js';
import { cameraOperating } from '../camera/control/operating.js';
import { HomeKitCameras } from '../homekit/cameras.js';
import { StandaloneHaClient } from '../ha/client.js';
import { CameraActivity } from '../camera/control/activity.js';
import type { RecorderCamera } from './recorder/types.js';
import type { BridgeSnapshotSource } from '@haus/media/snapshot';
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
  CAMERA_SNAPSHOTS,
  CAMERA_TALKBACK,
  CameraSnapshots,
  HomeKitCameras,
  NvrCameraSessions,
  WarmStreams,
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
          provide: NvrCameraSessions,
          useExisting: RECORDING_SESSIONS,
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
        {
          provide: CameraSnapshots,
          inject: [CatalogLifetime, RECORDING_CONFIG, RECORDING_SESSIONS, NativeCameraSources],
          useFactory: (
            lifetime: CatalogLifetime,
            config: { data: string },
            sessions: NvrCameraSessions,
            nativeSources: NativeCameraSources,
          ) => {
            const snapshots = new CameraSnapshots({
              config,
              sessions,
              bridgeSource: (camera) =>
                camera.nativeProvider
                  ? (nativeSources.snapshot(
                      camera as { id: string; nativeProvider: { bridgeId: string } },
                    ) as BridgeSnapshotSource | undefined)
                  : undefined,
            });
            lifetime.defer(() => snapshots.stop());
            return snapshots;
          },
        },
        {
          provide: CAMERA_SNAPSHOTS,
          useExisting: CameraSnapshots,
        },
        {
          provide: CAMERA_TALKBACK,
          inject: [CatalogLifetime, RECORDING_CONFIG],
          useFactory: (lifetime: CatalogLifetime, config: { token?: string }) => {
            const talkback = createTalkback({ config: { token: config.token } });
            lifetime.defer(() => talkback.stopAll());
            return talkback;
          },
        },
        {
          provide: HomeKitCameras,
          inject: [
            CatalogLifetime,
            RECORDING_CONFIG,
            RecordingStore,
            RECORDING_CLUSTER,
            RECORDING_SESSIONS,
            RECORDING_CAMERAS,
            CameraActivity,
            CAMERA_TALKBACK,
            CameraSnapshots,
            CATALOG_TRANSACTIONS,
            NativeCameraControls,
            StandaloneHaClient,
          ],
          useFactory: async (
            lifetime: CatalogLifetime,
            config: { data: string; homekit_address?: string },
            store: RecordingStore,
            cluster: Cluster,
            sessions: NvrCameraSessions,
            cameras: () => RecorderCamera[],
            activity: CameraActivity,
            talkback: Talkback,
            snapshots: CameraSnapshots,
            transactions: Transactions,
            nativeControls: NativeCameraControls,
            ha: StandaloneHaClient,
          ): Promise<HomeKitCameras> => {
            const registry = () => ({ cameras: cameras(), devices: [], entities: [], states: [] });
            const homekit = new HomeKitCameras({
              config,
              store,
              cluster: cluster as ConstructorParameters<typeof HomeKitCameras>[0]['cluster'],
              sessions,
              registry: () =>
                registry() as unknown as ReturnType<
                  ConstructorParameters<typeof HomeKitCameras>[0]['registry']
                >,
              activity: activity as ConstructorParameters<typeof HomeKitCameras>[0]['activity'],
              talkback,
              snapshot: (camera) => snapshots.snapshot(camera),
              spotlight: cameraSpotlight({
                ha,
                registry,
                native: nativeControls,
              }) as ConstructorParameters<typeof HomeKitCameras>[0]['spotlight'],
              operating: cameraOperating({
                ha,
                registry,
                native: nativeControls,
              }) as ConstructorParameters<typeof HomeKitCameras>[0]['operating'],
              identityTransactions: transactions,
            });
            await homekit.initialize();
            lifetime.defer(() => homekit.stop());
            return homekit;
          },
        },
        ...activityProviders(),
        ...maintenanceProviders(),
        RecordingOwner,
      ],
      exports: [
        RECORDING_BACKUPS,
        RECORDING_CLUSTER,
        RECORDING_SESSIONS,
        NvrCameraSessions,
        Recorder,
        WarmStreams,
        CameraAvailability,
        CameraSnapshots,
        CAMERA_SNAPSHOTS,
        CAMERA_TALKBACK,
        HomeKitCameras,
        CameraActivity,
        StandaloneHaClient,
      ],
    };
  }
}
