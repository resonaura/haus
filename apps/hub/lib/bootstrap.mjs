import { KitsuneCameras } from '@haus/kitsune';
import { cameraSource } from '@haus/media/source';
/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { CameraAvailability } from './camera-availability.mjs';
import { RecentPlayback } from './recent-playback.mjs';
import { WarmStreams } from './warm-streams.mjs';
import { NvrCameraSessions } from './nvr-camera-sessions.mjs';
import { Motion } from './motion.mjs';
import { CameraActivity } from './camera-activity.mjs';
import { HomeKitCameras } from './homekit.mjs';
import { createTalkback } from './talkback.mjs';
import { bridgeSnapshotDiscovery } from './bridge-snapshots.mjs';
import { CameraSnapshots } from './camera-snapshots.mjs';
import { cameraSpotlight } from './camera-spotlight.mjs';
import { cameraOperating } from './camera-operating.mjs';
import { NativeProviders } from './native-providers.mjs';
import { NativeCameraSources } from './native-camera-sources.mjs';
import { NativeEntities } from './native-entities.mjs';
import { NativeMigration } from './native-migration.mjs';
import { nativeMigrationDocuments } from './native-migration-documents.mjs';
import { ActivityMqtt } from './activity-mqtt.mjs';
import { SharedConfig } from './shared-config.mjs';
import { Backups } from './backups.mjs';
import { Cluster } from './cluster.mjs';
import { restoreCatalog } from './catalog-backup.mjs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { HaClient } from './ha-client.mjs';
import { Store, prepareDirectories } from './store.mjs';
import { Recorder } from './recorder.mjs';
import { discoverCameras, isDetectionEvent, detectionKind } from './discovery.mjs';
import { createApi } from './server.mjs';

/** Platform composition lives here; the application lifecycle owns the resulting service. */
export async function bootstrapHub({signal,scope}) {
 signal.throwIfAborted();
const config = await loadConfig();
await prepareDirectories(config);
await restoreCatalog(config.data);
const store = new Store(join(config.data, 'haus.sqlite'), config.media);
scope.defer(()=>store.close());
const ha = new HaClient(config);
scope.defer(()=>ha.stop());
const backups = new Backups(config, store);
scope.defer(()=>backups.stop());
await backups.initialize();
const shared = new SharedConfig(store, () => backups.markChanged());
const cluster = new Cluster(store, backups);
scope.defer(()=>cluster.stop());
const providers = new NativeProviders({ store, onChanged: () => backups.markChanged() });
const nativeSources = new NativeCameraSources({ providers, store });
cluster.enableRecordingCache(config);
let registry = { states: [], entities: [], devices: [], cameras: [] };
let refreshing;
let dirty = false;
const cameraSessions = new NvrCameraSessions({
  config,
  store,
  cluster,
  registry: () => registry,
});
const recorder = new Recorder(config, ha, store, undefined, {
  prepareRemote: (event, options) => cluster.preparePlayback(event, options),
  capture: cameraSessions,
});
const availability = new CameraAvailability();
const recentPlayback = new RecentPlayback(store, recorder, cluster);
const warm = new WarmStreams(ha, recorder, cluster, {
  sessions: cameraSessions,
});
const motion = new Motion({ ha, recorder, cluster, warm, config });
const activity = new CameraActivity({ recorder, motion });
const nativeEntities = new NativeEntities({
  store,
  sources: nativeSources,
  providers,
  registry: () => registry,
  activity,
});
const nativeMigration = new NativeMigration({ store, ha, providers, sources: nativeSources, native: nativeEntities,
  documents: (registry) => nativeMigrationDocuments(ha, registry, () => nativeMigration.closed), onChanged: () => backups.markChanged() });
const talkback = createTalkback({ config });
const legacyBridgeSnapshot = bridgeSnapshotDiscovery(config, () => registry);
const snapshots = new CameraSnapshots({
  config,
  sessions: cameraSessions,
  bridgeSource: async (camera) =>
    nativeSources.snapshot(camera) ?? (await legacyBridgeSnapshot(camera)),
  localCapture: (camera) => homekit.sourceSnapshot(camera),
});
const operating = cameraOperating({ ha, registry: () => registry, native: nativeEntities });
const homekit = await new HomeKitCameras({
  config,
  store,
  cluster,
  sessions: cameraSessions,
  registry: () => registry,
  activity,
  talkback,
  snapshot: (camera) => snapshots.snapshot(camera),
  spotlight: cameraSpotlight({ ha, registry: () => registry, native: nativeEntities }),
  operating,
}).initialize();
cameraSessions.authorizeActivityRecording = (node, value) =>
  motion.autonomous?.authorizes(node, value) === true;
cameraSessions.activityAssignedNode = (camera) => motion.autonomous?.priorNode(camera);
cameraSessions.clearActivityNode = (id) => motion.autonomous?.clearNode(id);
activity.captureNative = (id, kind, source, at) =>
  motion.autonomous?.triggerNative(id, kind, source, at) === true;
const activityMqtt = new ActivityMqtt({
  ha,
  activity,
  registry: () => registry,
  nativeOwned: (id) => nativeEntities.ownsActivity(id),
});
motion.onDetection = (id, event) => activity.software(id, event);
recorder.activitySensors = (camera) => activity.activeSensors(camera);
await motion.initialize();
store.db.exec('CREATE TABLE IF NOT EXISTS kitsune_plugins(vendor TEXT PRIMARY KEY,version TEXT)');
const kitsune = new KitsuneCameras({
  dataDirectory: config.data,
  endpointBase: process.env.HAUS_KITSUNE_ENDPOINT || 'http://127.0.0.1:8099/api/kitsune/hooks',
  publicEndpointBase: process.env.HAUS_KITSUNE_PUBLIC_ENDPOINT,
  ffmpegPath: 'ffmpeg',
  validateSource: cameraSource,
  diagnostic: (event) => console.warn(JSON.stringify(event)),
  emit: () => {},
  changed: () => apply(),
  activity: (id, active) => { if (active) activity.native(id, 'motion', id + '_motion'); },
});
const observeAvailability = () => {
  const at = Date.now();
  for (const camera of registry.cameras) {
    const state = registry.states.find((item) => item.entity_id === camera.id)?.state;
    store.observeAvailability(
      camera.id,
      !ha.connected && !camera.nativeProvider && !camera.independentSource
        ? 'unknown'
        : camera.available
          ? 'online'
          : !state || state === 'unknown'
            ? 'unknown'
            : 'offline',
      at,
    );
  }
};
const apply = () => {
  registry.cameras = discoverCameras(
    registry.states,
    registry.entities,
    registry.devices,
    store.overrides(),
  );
  availability.apply(registry.cameras, registry.states, recorder.buffers);
  registry.cameras = nativeSources.merge(registry, store.overrides());
  registry.cameras.push(...kitsune.cameras(store.overrides(), registry));
  recorder.sync(registry.cameras);
  warm.sync(registry.cameras);
  motion.sync(registry.cameras);
  activity.sync(registry.cameras);
  observeAvailability();
  if (config.recording_enabled)
    for (const camera of registry.cameras) {
      if (camera.available && camera.enabled && !recorder.active.has(camera.id))
        for (const sensor of camera.sensors.filter((item) => item.active)) {
          try {
            activity.native(camera.id, sensor.kind, sensor.id);
          } catch {
            /* Recording budgets can pause new events without blocking discovery. */
          }
        }
    }
};
const refresh = async () => {
  if (refreshing) {
    dirty = true;
    await refreshing;
    return;
  }
  refreshing = (async () => {
    do {
      dirty = false;
      const result = await ha.registry();
      registry = { ...result, cameras: [] };
      apply();
    } while (dirty);
  })().finally(() => {
    refreshing = undefined;
  });
  await refreshing;
};
ha.on('ready', () => {
  activityMqtt.reset();
  void refresh().catch(() => console.warn('Camera discovery will retry after reconnection'));
});
ha.on('status', () => {
  if (!ha.connected) observeAvailability();
});
ha.on('event', (event) => {
  if (event.event_type.endsWith('_registry_updated')) {
    void refresh().catch(() => {});
    return;
  }
  if (event.event_type !== 'state_changed') return;
  const next = event.data.new_state;
  const previous = event.data.old_state;
  const id = event.data.entity_id;
  registry.states = next
    ? registry.states.some((state) => state.entity_id === id)
      ? registry.states.map((state) => (state.entity_id === id ? next : state))
      : [...registry.states, next]
    : registry.states.filter((state) => state.entity_id !== id);
  if (id.startsWith('camera.'))
    availability.apply(registry.cameras, registry.states, recorder.buffers);
  for (const camera of registry.cameras) {
    for (const sensor of camera.sensors)
      if (sensor.id === id) {
        sensor.active = next?.state === 'on';
        sensor.available = Boolean(next && !['unknown', 'unavailable'].includes(next.state));
      }
    if (
      camera.enabled &&
      camera.available &&
      next &&
      isDetectionEvent(previous, next) &&
      camera.sensors.some((sensor) => sensor.id === id)
    ) {
      try {
        activity.native(camera.id, detectionKind(next), id);
      } catch {}
    }
  }
  if (id.startsWith('camera.')) {
    recorder.sync(registry.cameras);
    warm.sync(registry.cameras);
    motion.sync(registry.cameras);
    observeAvailability();
  }
});
const server = createApi({
  kitsune,
  homekit,
  operating,
  providers,
  nativeSources,
  nativeEntities,
  nativeMigration,
  applyProviders: apply,
  snapshots,
  talkback,
  config,
  ha,
  store,
  recorder,
  getRegistry: () => registry,
  refresh,
  cluster,
  backups,
  shared,
  warm,
  motion,
  activity,
  cameraSessions,
});
for (const { vendor, version } of store.db.prepare('SELECT vendor,version FROM kitsune_plugins').all()) {
  void kitsune.enable(vendor, version || undefined).catch(() => console.warn('A Kitsune plugin will need attention before it can reconnect.'));
}
const kitsuneRefresh = setInterval(() => void kitsune.refresh().catch(() => {}), 30000);
await recorder.initialize();
ha.start();
let providerTick = providers
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
      .then(() => cluster.recordingCache.trim())
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
// Distribution can spend several seconds verifying/archive-copying media.  Keep
// the inexpensive admission check independent so an idle capable NVR can take
// the next old clip shortly after it finishes the previous one.  The worker
// itself still admits only one job and rejects pressured or undersized nodes.
const recentPreparation = setInterval(() => void recentPlayback.tick().catch(() => {}), 2000);
const warming = setInterval(() => void warm.tick().catch(() => {}), 4000);
const detection = setInterval(
  () =>
    void motion
      .tick()
      .then(() => {
        activity.tick();
        return activityMqtt.tick();
      })
      .catch(() => {}),
  4000,
);
const availabilityHeartbeat = setInterval(() => {
  if (availability.apply(registry.cameras, registry.states, recorder.buffers)) {
    recorder.sync(registry.cameras);
    warm.sync(registry.cameras);
    motion.sync(registry.cameras);
  }
  observeAvailability();
}, 2000);
let releaseTick;
const providerHeartbeat = setInterval(() => {
  if (!providerTick)
    providerTick = providers
      .tick()
      .then(apply)
      .catch(() => {})
      .finally(() => {
        providerTick = undefined;
      });
  // Explicit presentation cleanup must never delay media/inventory heartbeats.
  if (!releaseTick)
    releaseTick = nativeEntities
      .tick()
      .catch(() => {})
      .finally(() => {
        releaseTick = undefined;
      });
}, 4000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(kitsuneRefresh);
  await kitsune.stop();
  clearInterval(retention);
  clearInterval(providerHeartbeat);
  await nativeMigration.stop();
  await Promise.allSettled([providerTick, releaseTick]);
  clearInterval(warming);
  clearInterval(detection);
  await homekit.stop();
  await snapshots.stop();
  await motion.stop();
  await activityMqtt.stop();
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
  await recorder.stop();
  await cameraSessions.stop();
  store.close();
}

 if (!server.listening) await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 return {close:stop};
}
