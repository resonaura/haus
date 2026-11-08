/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Server } from 'node:http';
import type { KitsuneCameras } from '@haus/kitsune';
import type { NativeEntities } from '@haus/ha/node/native-entities';
import type { NativeMigration } from '@haus/ha/node/native-migration';
import type { ActivityMqtt } from '@haus/ha/node/activity-mqtt';
import type {
  DiscoveredCamera,
  DiscoveryDevice,
  DiscoveryEntity,
  DiscoveryState,
} from '@haus/ha/node/discovery';
import type { Backups } from '../backup/index.js';
import type { ServiceCatalog } from '../servers/index.js';
import type { Cluster } from '../cluster/index.js';
import type {
  RecordingStore as TypeOrmRecordingStore,
  RecentPlayback,
  Recorder,
} from '../events/index.js';
import type {
  CameraAvailability,
  WarmStreams,
  NvrCameraSessions,
  Motion,
  CameraActivity,
  CameraSnapshots,
} from '../camera/index.js';
import type { HomeKitCameras } from '../homekit/index.js';
import type { NativeProviders } from '../providers/index.js';
import { stopRecordingRuntime } from './recording.js';

export interface HubRegistryState {
  states: DiscoveryState[];
  entities: DiscoveryEntity[];
  devices: DiscoveryDevice[];
  cameras: DiscoveredCamera[];
  areas?: Array<{ area_id: string; name?: string }>;
}

export async function startHubRuntimeLoops({
  config,
  server,
  serviceCatalog,
  kitsune,
  recorder,
  ha,
  providers,
  apply,
  refresh,
  store,
  cluster,
  backups,
  recentPlayback,
  warm,
  motion,
  activity,
  activityMqtt,
  availability,
  getRegistry,
  observeAvailability,
  nativeEntities,
  nativeMigration,
  homekit,
  snapshots,
  cameraSessions,
  waitApplying,
}: {
  config: { port: number; retention_days: number; max_storage_gb?: number };
  server: Server;
  serviceCatalog: ServiceCatalog;
  kitsune: KitsuneCameras;
  recorder: Recorder;
  ha: { connected: boolean; start(): void; stop(): void };
  providers: NativeProviders;
  apply: () => Promise<void>;
  refresh: () => Promise<void>;
  store: TypeOrmRecordingStore;
  cluster: Cluster;
  backups: Backups;
  recentPlayback: RecentPlayback;
  warm: WarmStreams;
  motion: Motion;
  activity: CameraActivity;
  activityMqtt?: ActivityMqtt;
  availability: CameraAvailability;
  getRegistry: () => HubRegistryState;
  observeAvailability: () => Promise<void>;
  nativeEntities?: NativeEntities;
  nativeMigration?: NativeMigration;
  homekit: HomeKitCameras;
  snapshots: CameraSnapshots;
  cameraSessions: NvrCameraSessions;
  waitApplying: () => Promise<void>;
}): Promise<{ close: () => Promise<void> }> {
  for (const { vendor, version } of serviceCatalog.plugins()) {
    void kitsune
      .enable(vendor, version || undefined)
      .catch(() => console.warn('A Kitsune plugin will need attention before it can reconnect.'));
  }
  const kitsuneRefresh = setInterval(() => void kitsune.refresh().catch(() => {}), 30000);
  await recorder.initialize();
  ha.start();
  let providerTick: Promise<void> | undefined = providers
    .tick()
    .then(apply)
    .catch(() => {})
    .finally(() => {
      providerTick = undefined;
    });
  server.listen(config.port, '0.0.0.0', () =>
    console.log(`Haus is listening on ${config.port}; recordings remain local`),
  );
  const retry = setInterval(() => {
    if (ha.connected) void refresh().catch(() => {});
  }, 60000);
  const retention = setInterval(
    () =>
      void store
        .prune(config)
        .then(() => cluster.recordingCache?.trim())
        .catch(() => {}),
    60000,
  );
  const maintenance = setInterval(() => void backups.tick().catch(() => {}), 15000);
  const distribution = setInterval(
    () =>
      void (async () => {
        await cluster.tick();
        await recentPlayback.tick();
      })().catch(() => {}),
    10000,
  );
  const recentPreparation = setInterval(() => void recentPlayback.tick().catch(() => {}), 2000);
  const warming = setInterval(() => void warm.tick().catch(() => {}), 4000);
  const detection = setInterval(
    () =>
      void motion
        .tick()
        .then(() => {
          activity.tick();
          return activityMqtt?.tick();
        })
        .catch(() => {}),
    4000,
  );
  const availabilityHeartbeat = setInterval(() => {
    const registry = getRegistry();
    if (availability.apply(registry.cameras, registry.states, recorder.buffers)) {
      recorder.sync(registry.cameras);
      warm.sync(registry.cameras);
      motion.sync(registry.cameras);
    }
    void observeAvailability().catch(() =>
      console.warn('Camera availability could not be persisted'),
    );
  }, 2000);
  let releaseTick: Promise<void> | undefined;
  const providerHeartbeat = setInterval(() => {
    if (!providerTick)
      providerTick = providers
        .tick()
        .then(apply)
        .catch(() => {})
        .finally(() => {
          providerTick = undefined;
        });
    if (!releaseTick && nativeEntities)
      releaseTick = nativeEntities
        .tick()
        .catch(() => {})
        .finally(() => {
          releaseTick = undefined;
        });
  }, 4000);

  let stopping = false;
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    clearInterval(kitsuneRefresh);
    await kitsune.stop();
    clearInterval(retention);
    clearInterval(providerHeartbeat);
    await nativeMigration?.stop();
    await Promise.allSettled([providerTick, releaseTick]);
    clearInterval(warming);
    clearInterval(detection);
    await homekit.stop();
    await snapshots.stop();
    await motion.stop();
    await activityMqtt?.stop();
    await warm.stop();
    clearInterval(maintenance);
    clearInterval(distribution);
    clearInterval(recentPreparation);
    await cluster.stop();
    clearInterval(availabilityHeartbeat);
    clearInterval(retry);
    ha.stop();
    server.close();
    server.closeIdleConnections();
    await backups.stop();
    await stopRecordingRuntime(recorder, cameraSessions);
    await waitApplying();
    await store.close();
  }

  if (!server.listening)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  return { close: stop };
}
