/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Service, type ResourceScope } from '@haus/core/lifecycle';
import { haIntegrationDefinition } from '@haus/ha/provider';
import { HaRuntimeAdapter, FakeHaRuntime } from '@haus/ha/runtime';
import { KitsuneCameras } from '@haus/kitsune';
import { cameraSource } from '@haus/media/source';
import { defaultMediaRuntime } from '@haus/media/pipeline';
import { NativeEntities } from '@haus/ha/node/native-entities';
import { NativeMigration } from '@haus/ha/node/native-migration';
import { nativeMigrationDocuments } from '@haus/ha/node/native-migration-documents';
import { ActivityMqtt } from '@haus/ha/node/activity-mqtt';
import {
  discoverCameras,
  isDetectionEvent,
  detectionKind,
  type DiscoveredCamera,
  type DiscoveryDevice,
  type DiscoveryEntity,
  type DiscoveryState,
} from '@haus/ha/node/discovery';
import { Host, ControlService } from '../control/index.js';
import { HubAuthService } from '../auth/index.js';
import {
  openCatalog,
  Transactions,
  RetentionCatalog,
  CameraCatalog,
  HaCatalog,
} from '../storage/index.js';
import { BackupCatalog, Backups, restoreCatalog } from '../backup/index.js';
import { ServiceCatalog } from '../servers/index.js';
import { ClusterCatalog, Cluster } from '../cluster/index.js';
import {
  RecordingStore as TypeOrmRecordingStore,
  RecentPlayback,
  Recorder,
} from '../events/index.js';
import {
  CameraAvailability,
  WarmStreams,
  NvrCameraSessions,
  Motion,
  CameraActivity,
  createTalkback,
  bridgeSnapshotDiscovery,
  CameraSnapshots,
  cameraSpotlight,
  cameraOperating,
  NativeCameraSources,
} from '../camera/index.js';
import { HomeKitCameras } from '../homekit/index.js';
import { NativeProviders } from '../providers/index.js';
import { SharedConfig } from '../preferences/index.js';
import { HaClient, StandaloneHaClient } from '../ha/index.js';
import { loadConfig } from './appliance-config.js';
import { createApi, type CreateApiOptions } from './server/index.js';
import { startHubRuntimeLoops, type HubRegistryState } from './schedulers.js';

/** Platform composition lives here; the application lifecycle owns the resulting service. */
export async function bootstrapHub({
  signal,
  scope,
}: {
  signal: AbortSignal;
  scope: ResourceScope;
}): Promise<{ close: () => Promise<void> }> {
  signal.throwIfAborted();
  const config: Awaited<ReturnType<typeof loadConfig>> & { homeId?: string; hubId?: string } =
    await loadConfig();
  await mkdir(config.data, { recursive: true, mode: 0o700 });
  await mkdir(config.media, { recursive: true, mode: 0o750 });
  await restoreCatalog(config.data);
  let controlService: ControlService | undefined;
  try {
    const homeId = config.homeId || 'haus-home';
    const hubId = config.hubId || 'hub-local';
    const host = await Host.open({ homeId, hubId, directory: config.data });
    controlService = new ControlService({ host });
    scope.defer(() => controlService!.close());
    if (config.base && config.token) {
      const haResource = { homeId, kind: 'integration' as const, id: 'home-assistant' };
      controlService.register(haIntegrationDefinition(haResource, config.base));
    }
  } catch {}
  const isStandalone = Boolean(config.standalone || !config.ws || !config.token);
  const authService = new HubAuthService({
    hubId: config.hubId || 'hub-local',
    homeId: config.homeId || 'haus-home',
    hubUrl: `http://127.0.0.1:${config.port || 8099}`,
    apiToken: config.apiToken,
  });
  const ha = isStandalone
    ? new StandaloneHaClient(config)
    : new HaClient({ ws: config.ws!, base: config.base!, token: config.token! });
  scope.defer(() => ha.stop());
  const runtime = isStandalone
    ? new FakeHaRuntime({ connected: true, status: { version: 'standalone' } })
    : new HaRuntimeAdapter({
        client: ha as ConstructorParameters<typeof HaRuntimeAdapter>[0]['client'],
        config: { base: config.base!, ws: config.ws! },
      });
  scope.defer(() => runtime.stop());
  let catalogTransactions = controlService?.host.catalogTransactions;
  if (!catalogTransactions) {
    const preferencesSource = await openCatalog(join(config.data, 'haus.sqlite'));
    catalogTransactions = new Transactions(preferencesSource);
    const ownedTransactions = catalogTransactions;
    scope.defer(async () => {
      await ownedTransactions.drain();
      await preferencesSource.destroy();
    });
  }
  const store = new TypeOrmRecordingStore(
    catalogTransactions.dataSource,
    config.media,
    catalogTransactions,
  );
  scope.defer(() => store.close());
  const backups = new Backups(config, store, new BackupCatalog(catalogTransactions));
  scope.defer(() => backups.stop());
  await backups.initialize();
  const shared = new SharedConfig(catalogTransactions, () => backups.markChanged());
  await shared.ready;
  const serviceCatalog = new ServiceCatalog(catalogTransactions);
  await serviceCatalog.initialize();
  const retentionCatalog = new RetentionCatalog(catalogTransactions);
  const cameraCatalog = new CameraCatalog(catalogTransactions);
  await cameraCatalog.initialize();
  const cluster = new Cluster(store, backups, { catalog: new ClusterCatalog(catalogTransactions) });
  await cluster.initialize();
  scope.defer(() => cluster.stop());
  const providers = new NativeProviders({
    store,
    catalog: cameraCatalog,
    onChanged: () => backups.markChanged(),
  });
  const nativeSources = new NativeCameraSources({ providers, store, catalog: cameraCatalog });
  cluster.enableRecordingCache(config, retentionCatalog);
  let registry: HubRegistryState = { states: [], entities: [], devices: [], cameras: [] };
  let refreshing: Promise<void> | undefined;
  let dirty = false;
  const cameraSessions = new NvrCameraSessions({
    config,
    store,
    catalog: cameraCatalog,
    cluster,
    registry: () => registry,
  });
  const recorder = new Recorder(
    config,
    ha as ConstructorParameters<typeof Recorder>[1],
    store,
    undefined,
    {
      prepareRemote: (event, options) => cluster.preparePlayback(event, options),
      capture: cameraSessions,
    },
  );
  const availability = new CameraAvailability();
  const recentPlayback = new RecentPlayback(store, recorder, cluster, {
    catalog: retentionCatalog,
  });
  const warm = new WarmStreams(
    ha as ConstructorParameters<typeof WarmStreams>[0],
    recorder,
    cluster,
    {
      sessions: cameraSessions,
    },
  );
  const motion = new Motion({
    ha: ha as ConstructorParameters<typeof Motion>[0]['ha'],
    recorder,
    cluster,
    warm,
    config,
  });
  const activity = new CameraActivity({ recorder, motion });
  let haCatalog: HaCatalog | undefined;
  let nativeEntities: NativeEntities | undefined;
  let nativeMigration: NativeMigration | undefined;
  if (!isStandalone) {
    haCatalog = new HaCatalog(catalogTransactions);
    await haCatalog.initialize();
    nativeEntities = new NativeEntities({
      catalog: haCatalog as ConstructorParameters<typeof NativeEntities>[0]['catalog'],
      sources: nativeSources as ConstructorParameters<typeof NativeEntities>[0]['sources'],
      providers: providers as ConstructorParameters<typeof NativeEntities>[0]['providers'],
      registry: () => registry,
      activity: activity as ConstructorParameters<typeof NativeEntities>[0]['activity'],
    });
    nativeMigration = new NativeMigration({
      catalog: haCatalog as ConstructorParameters<typeof NativeMigration>[0]['catalog'],
      ha: ha as ConstructorParameters<typeof NativeMigration>[0]['ha'],
      providers: providers as ConstructorParameters<typeof NativeMigration>[0]['providers'],
      sources: nativeSources as ConstructorParameters<typeof NativeMigration>[0]['sources'],
      native: nativeEntities,
      documents: (reg) =>
        nativeMigrationDocuments(
          ha as Parameters<typeof nativeMigrationDocuments>[0],
          { states: registry.states, entities: reg.entities },
          () => nativeMigration!.closed,
        ),
      onChanged: () => backups.markChanged(),
    });
    await nativeMigration.ready;
  }
  const talkback = createTalkback({ config: { ...config, token: config.token ?? undefined } });
  const legacyBridgeSnapshot = bridgeSnapshotDiscovery(config, () => registry);
  const snapshots = new CameraSnapshots({
    config,
    sessions: cameraSessions,
    bridgeSource: async (camera) =>
      nativeSources.snapshot(camera) ?? (await legacyBridgeSnapshot(camera)),
    localCapture: (camera) =>
      homekit.sourceSnapshot(camera as Parameters<typeof homekit.sourceSnapshot>[0]),
  });
  const operating = isStandalone
    ? undefined
    : cameraOperating({
        ha: ha as Parameters<typeof cameraOperating>[0]['ha'],
        registry: () => registry,
        native: nativeEntities as Parameters<typeof cameraOperating>[0]['native'],
      });
  const homekit = await new HomeKitCameras({
    config,
    store,
    cluster: cluster as ConstructorParameters<typeof HomeKitCameras>[0]['cluster'],
    sessions: cameraSessions,
    registry: () =>
      registry as ReturnType<ConstructorParameters<typeof HomeKitCameras>[0]['registry']>,
    activity: activity as ConstructorParameters<typeof HomeKitCameras>[0]['activity'],
    talkback,
    snapshot: (camera) => snapshots.snapshot(camera),
    spotlight: isStandalone
      ? undefined
      : (cameraSpotlight({
          ha: ha as Parameters<typeof cameraSpotlight>[0]['ha'],
          registry: () => registry,
          native: nativeEntities as Parameters<typeof cameraSpotlight>[0]['native'],
        }) as ConstructorParameters<typeof HomeKitCameras>[0]['spotlight']),
    operating: operating as ConstructorParameters<typeof HomeKitCameras>[0]['operating'],
    identityTransactions: controlService?.host.catalogTransactions,
  }).initialize();
  cameraSessions.authorizeActivityRecording = (node, value) =>
    motion.autonomous?.authorizes(node, value) === true;
  cameraSessions.activityAssignedNode = (camera) => motion.autonomous?.priorNode(camera);
  cameraSessions.clearActivityNode = (id) => motion.autonomous?.clearNode(id);
  activity.captureNative = (id, kind, source, at) =>
    motion.autonomous?.triggerNative(id, kind, source, at) === true;
  const activityMqtt = isStandalone
    ? undefined
    : new ActivityMqtt({
        ha: ha as ConstructorParameters<typeof ActivityMqtt>[0]['ha'],
        activity: activity as ConstructorParameters<typeof ActivityMqtt>[0]['activity'],
        registry: () => registry,
        nativeOwned: (id) => Boolean(nativeEntities?.ownsActivity(id)),
      });
  motion.onDetection = (id, event) => activity.software(id, event);
  recorder.activitySensors = (camera) => activity.activeSensors(camera);
  await motion.initialize();
  const kitsune = new KitsuneCameras({
    dataDirectory: config.data,
    endpointBase: process.env.HAUS_KITSUNE_ENDPOINT || 'http://127.0.0.1:8099/api/kitsune/hooks',
    publicEndpointBase: process.env.HAUS_KITSUNE_PUBLIC_ENDPOINT,
    mediaRuntime: defaultMediaRuntime,
    validateSource: cameraSource as ConstructorParameters<
      typeof KitsuneCameras
    >[0]['validateSource'],
    diagnostic: (event) => console.warn(JSON.stringify(event)),
    emit: () => {},
    changed: () =>
      void apply().catch(() => console.warn('Camera discovery could not be persisted')),
    activity: (id, active) => {
      if (active) activity.native(id, 'motion', id + '_motion');
    },
  });
  const observeAvailability = async () => {
    const at = Date.now();
    for (const camera of registry.cameras) {
      const state = registry.states.find((item) => item.entity_id === camera.id)?.state;
      await store.observeAvailability(
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
  let applying = Promise.resolve();
  const apply = () => {
    const task = applying.then(async () => {
      const overrides = (await store.overrides()) as Record<
        string,
        import('@haus/ha/node/discovery').CameraOverride
      >;
      registry.cameras = discoverCameras(
        registry.states,
        registry.entities,
        registry.devices,
        overrides,
      );
      availability.apply(registry.cameras, registry.states, recorder.buffers);
      registry.cameras = nativeSources.merge(
        registry as Parameters<typeof nativeSources.merge>[0],
        overrides,
      ) as DiscoveredCamera[];
      for (const cam of kitsune.cameras(
        overrides as Parameters<typeof kitsune.cameras>[0],
        registry as Parameters<typeof kitsune.cameras>[1],
      )) {
        registry.cameras.push(cam as DiscoveredCamera);
      }
      recorder.sync(registry.cameras);
      warm.sync(registry.cameras);
      motion.sync(registry.cameras);
      activity.sync(registry.cameras);
      await observeAvailability();
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
    });
    applying = task.catch(() => {});
    return task;
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
        const result = (await ha.registry()) as {
          states: DiscoveryState[];
          entities: DiscoveryEntity[];
          devices: DiscoveryDevice[];
          areas?: Array<{ area_id: string; name?: string }>;
        };
        registry = { ...result, cameras: [] };
        await apply();
      } while (dirty);
    })().finally(() => {
      refreshing = undefined;
    });
    await refreshing;
  };
  ha.on('ready', () => {
    activityMqtt?.reset();
    void refresh().catch(() => console.warn('Camera discovery will retry after reconnection'));
  });
  ha.on('status', () => {
    if (!ha.connected)
      void observeAvailability().catch(() =>
        console.warn('Camera availability could not be persisted'),
      );
  });
  ha.on(
    'event',
    (event: {
      event_type: string;
      data: { entity_id: string; new_state?: DiscoveryState; old_state?: DiscoveryState };
    }) => {
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
            activity.native(camera.id, detectionKind(next)!, id);
          } catch {}
        }
      }
      if (id.startsWith('camera.')) {
        recorder.sync(registry.cameras);
        warm.sync(registry.cameras);
        motion.sync(registry.cameras);
        void observeAvailability().catch(() =>
          console.warn('Camera availability could not be persisted'),
        );
      }
    },
  );
  const apiDependencies: Record<string, unknown> = {
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
    controlService,
    authService,
    serviceCatalog,
    haCatalog,
    runtime,
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
  };
  const server = createApi(apiDependencies as CreateApiOptions);
  return startHubRuntimeLoops({
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
    getRegistry: () => registry,
    observeAvailability,
    nativeEntities,
    nativeMigration,
    homekit,
    snapshots,
    cameraSessions,
    waitApplying: () => applying,
  });
}

export class Hub extends Service {
  constructor() {
    super(bootstrapHub);
  }
}
