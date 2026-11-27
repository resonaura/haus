/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { OptimisticSessionController, sanitizeHomeLightMemories } from '@haus/core/optimistic';
import type { Preferences } from '@haus/core/preferences';
import { readHaSnapshot } from '@haus/ha/snapshot';
import type { HausAction, Snapshot } from '@haus/ha/types';
import { loadHueSceneArtwork } from '@haus/ha/ui/hue-scenes';
import { RegistryController } from '@haus/ha/ui/registry';
import type { HomeAssistantConnection } from '../../main/connection.js';
import type { DiscoveryTask } from '../../main/discovery.js';
import type { HubConnection } from '../../main/hub/connection.js';
import type { NativeEvent, NativeSession } from '../../shared/native.js';
import {
  applyHaStateDeltaToSnapshot,
  extractHaStateChangedDelta,
  type GpuiHomeState,
  type HaStateChangedDelta,
} from './ha-bridge.js';

export interface GpuiOptimisticBridgeOptions {
  readonly send: (action: HausAction) => Promise<unknown>;
  readonly onProjectedSnapshot: (snapshot: Snapshot | null) => void;
  readonly onNotice: (message: string) => void;
}

/**
 * Owns authoritative server facts, reversible optimistic projection, and light output memory
 * for GPUIX desktop sessions across both Haus Hub and Home Assistant transports.
 */
export class GpuiOptimisticBridge {
  readonly controller: OptimisticSessionController<Snapshot, HausAction>;
  private serverSnapshot: Snapshot | null = null;

  constructor(options: GpuiOptimisticBridgeOptions) {
    this.controller = new OptimisticSessionController({
      getServerSnapshot: () => this.serverSnapshot,
      onInvalidate: () => {
        if (this.serverSnapshot) {
          options.onProjectedSnapshot(this.controller.project(this.serverSnapshot));
        }
      },
      onNotice: options.onNotice,
      send: options.send,
    });
  }

  get confirmed(): Snapshot | null {
    return this.serverSnapshot;
  }

  get pendingCount(): number {
    return this.controller.optimistic.size;
  }

  project(): Snapshot | null {
    return this.controller.project(this.serverSnapshot);
  }

  commitSnapshot(snapshot: Snapshot): Snapshot | null {
    const prev = this.serverSnapshot;
    const sceneIds = new Set(
      snapshot.states
        .filter((state) => state.entity_id.startsWith('scene.'))
        .map((state) => state.entity_id),
    );
    const preservedArtwork = prev?.sceneArtwork
      ? Object.fromEntries(
          Object.entries(prev.sceneArtwork).filter(([id]) => sceneIds.has(id)),
        )
      : undefined;
    const preservedConfigs = prev?.sceneConfigs
      ? Object.fromEntries(
          Object.entries(prev.sceneConfigs).filter(([id]) => sceneIds.has(id)),
        )
      : undefined;
    const merged: Snapshot = {
      ...snapshot,
      ...(preservedArtwork && Object.keys(preservedArtwork).length > 0
        ? { sceneArtwork: { ...preservedArtwork, ...snapshot.sceneArtwork } }
        : {}),
      ...(preservedConfigs && Object.keys(preservedConfigs).length > 0
        ? { sceneConfigs: { ...preservedConfigs, ...snapshot.sceneConfigs } }
        : {}),
    };
    this.serverSnapshot = this.controller.reconcileSnapshot(prev, merged);
    return this.project();
  }

  patchExtras(patch: Pick<Snapshot, 'sceneArtwork' | 'sceneConfigs'>): Snapshot | null {
    if (!this.serverSnapshot) return null;
    this.serverSnapshot = {
      ...this.serverSnapshot,
      ...(patch.sceneArtwork
        ? { sceneArtwork: { ...this.serverSnapshot.sceneArtwork, ...patch.sceneArtwork } }
        : {}),
      ...(patch.sceneConfigs
        ? { sceneConfigs: { ...this.serverSnapshot.sceneConfigs, ...patch.sceneConfigs } }
        : {}),
    };
    return this.project();
  }

  applyDelta(delta: HaStateChangedDelta): Snapshot | null | 'ignored' {
    if (!this.serverSnapshot) return null;
    if (delta.entity && !this.controller.reconcileEntity(delta.entity, delta.contextId)) {
      return 'ignored';
    }
    this.serverSnapshot = applyHaStateDeltaToSnapshot(this.serverSnapshot, delta);
    return this.project();
  }

  executeBatch(actions: readonly HausAction[]): Promise<void> {
    return this.controller.executeBatch(actions);
  }

  hydrateLightMemory(scope: string | undefined, preferences: Preferences): void {
    if (!scope) return;
    this.controller.optimistic.lightMemory.hydrate(scope, preferences.lightMemories?.[scope]);
  }

  mergeLightMemoryPreferences(
    scope: string | undefined,
    preferences: Preferences,
  ): Preferences | undefined {
    if (!scope) return undefined;
    const exported = this.controller.optimistic.lightMemory.export();
    if (!Object.keys(exported).length) return undefined;
    const lightMemories = sanitizeHomeLightMemories({
      ...preferences.lightMemories,
      [scope]: exported,
    });
    if (JSON.stringify(lightMemories) === JSON.stringify(preferences.lightMemories ?? {})) {
      return undefined;
    }
    return { ...preferences, lightMemories };
  }

  reset(clearServerSnapshot = false): Snapshot | null {
    this.controller.reset();
    if (clearServerSnapshot) this.serverSnapshot = null;
    return this.project();
  }

  dispose(): void {
    this.controller.dispose();
    this.serverSnapshot = null;
  }
}

export function routeGpuiHubEvent(params: {
  readonly event: NativeEvent;
  readonly active: boolean;
  readonly optimistic: GpuiOptimisticBridge;
  readonly onBrandInvalidated: (version?: string) => void;
  readonly onOffline: () => void;
  readonly onPublishHome: () => void;
  readonly onProjected: (snapshot: Snapshot) => void;
  readonly onSyncPreferences?: () => void;
}): void {
  const { event } = params;
  if (event.type === 'brand-icons-invalidated') {
    params.onBrandInvalidated(event.version);
    return;
  }
  if (!params.active) return;
  if (event.type === 'helper-live' && event.online) {
    params.onSyncPreferences?.();
    return;
  }
  if (event.type === 'connection' && event.status !== 'connected') params.onOffline();
  if (event.type === 'connection' && event.status === 'connected') params.onPublishHome();
  if (event.type === 'ha-event') {
    const delta = extractHaStateChangedDelta(event.event);
    if (!delta) {
      params.onPublishHome();
      return;
    }
    const next = params.optimistic.applyDelta(delta);
    if (next === 'ignored') return;
    if (next === null) params.onPublishHome();
    else params.onProjected(next);
  }
}

async function hydrateGpuiSceneExtras(params: {
  readonly snapshot: Snapshot;
  readonly kind: 'haus-hub' | 'home-assistant';
  readonly ha?: HomeAssistantConnection;
  readonly hub: HubConnection;
  readonly optimistic: GpuiOptimisticBridge;
  readonly update: (patch: Partial<GpuiHomeState>) => void;
}): Promise<void> {
  const api =
    params.kind === 'home-assistant' && params.ha
      ? {
          request: <T = unknown>(msg: Record<string, unknown>) => params.ha!.request<T>(msg),
          management: <T = unknown>(input: { method?: string; path: string; body?: unknown }) =>
            params.ha!.management(input) as Promise<T>,
          getSceneConfig: (entityId: string, configId: string) =>
            params.ha!.getSceneConfig(entityId, configId),
        }
      : {
          request: <T = unknown>(msg: Record<string, unknown>) => params.hub.request<T>(msg),
          management: <T = unknown>(input: { method?: string; path: string; body?: unknown }) =>
            params.hub.management(input) as Promise<T>,
          getSceneConfig: (entityId: string, configId: string) =>
            params.hub.getSceneConfig(entityId, configId),
        };

  void loadHueSceneArtwork(params.snapshot, api)
    .then((sceneArtwork) => {
      if (!Object.keys(sceneArtwork).length) return;
      const projected = params.optimistic.patchExtras({ sceneArtwork });
      if (projected) params.update({ snapshot: projected });
    })
    .catch(() => undefined);

  const sceneEntities = params.snapshot.states.filter(
    (entity) =>
      entity.entity_id.startsWith('scene.') &&
      typeof entity.attributes.id === 'string' &&
      /^[a-z0-9_-]{1,128}$/i.test(entity.attributes.id) &&
      params.snapshot.entities.some(
        (entry) =>
          entry.entity_id === entity.entity_id &&
          (entry.platform === 'homeassistant' || entry.platform === 'haus'),
      ),
  );
  if (sceneEntities.length > 0) {
    void Promise.all(
      sceneEntities.map(async (scene) => {
        try {
          const cfg = await api.getSceneConfig(scene.entity_id, String(scene.attributes.id));
          return cfg ? ([scene.entity_id, cfg] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      const entries = pairs.filter((item): item is readonly [string, Record<string, unknown>] =>
        Boolean(item),
      );
      if (!entries.length) return;
      const projected = params.optimistic.patchExtras({
        sceneConfigs: Object.fromEntries(entries),
      });
      if (projected) params.update({ snapshot: projected });
    });
  }
}

export async function loadGpuiHomeSession(params: {
  readonly session: NativeSession;
  readonly kind: 'haus-hub' | 'home-assistant';
  readonly ha?: HomeAssistantConnection;
  readonly hub: HubConnection;
  readonly optimistic: GpuiOptimisticBridge;
  readonly getPreferences: () => Preferences;
  readonly syncPreferences: () => Promise<void>;
  readonly commitSnapshot: (snapshot: Snapshot, extra?: Partial<GpuiHomeState>) => void;
  readonly update: (patch: Partial<GpuiHomeState>) => void;
  readonly markOffline: (error?: string) => void;
}): Promise<void> {
  const connected =
    params.kind === 'home-assistant' ? Boolean(params.ha?.connected) : params.hub.connected;
  params.update({ session: params.session, sessionKind: params.kind, offline: !connected });
  params.optimistic.hydrateLightMemory(params.session.url, params.getPreferences());
  if (!connected) return;
  try {
    if (params.kind === 'home-assistant' && params.ha) {
      const loaded = await readHaSnapshot(params.ha);
      params.commitSnapshot(loaded, {
        offline: false,
        preferenceStatus: 'synced',
      });
      void hydrateGpuiSceneExtras({ ...params, snapshot: loaded });
      return;
    }
    await Promise.all([params.syncPreferences(), params.hub.refresh(true)]);
    const home = params.hub.currentHome() ?? null;
    if (home) {
      params.commitSnapshot(home, { offline: false });
      void hydrateGpuiSceneExtras({ ...params, snapshot: home });
    } else {
      params.update({ snapshot: null, offline: false });
    }
  } catch {
    params.markOffline('The home could not be loaded. Reconnect to the Hub.');
  }
}

export async function runGpuiServerScan(params: {
  readonly task: DiscoveryTask;
  readonly isCurrent: () => boolean;
  readonly clearTask: () => void;
  readonly update: (patch: Partial<GpuiHomeState>) => void;
}): Promise<void> {
  params.update({ scanning: true, servers: [] });
  try {
    const servers = await params.task.promise;
    if (params.isCurrent()) params.update({ servers });
  } catch {
    if (params.isCurrent()) params.update({ error: 'Could not scan for local hubs.' });
  } finally {
    if (params.isCurrent()) {
      params.clearTask();
      params.update({ scanning: false });
    }
  }
}

export function createGpuiRegistryController(options: {
  readonly optimistic: GpuiOptimisticBridge;
  readonly getGeneration: () => number;
  readonly isConnected: () => boolean;
  readonly commitSnapshot: (snapshot: Snapshot) => void;
  readonly request: <T>(message: Record<string, unknown>) => Promise<T>;
}): RegistryController {
  return new RegistryController({
    snapshot: () => {
      if (!options.optimistic.confirmed) throw new Error('Wait for the home to load.');
      return options.optimistic.confirmed;
    },
    context: () => ({
      mode: 'live',
      generation: options.getGeneration(),
      status: options.isConnected() ? 'connected' : 'disconnected',
    }),
    commit: (update) => {
      if (options.optimistic.confirmed) {
        options.commitSnapshot(update(options.optimistic.confirmed));
      }
    },
    request: options.request,
  });
}

export async function dispatchGpuiDeviceActions(params: {
  readonly actions: readonly HausAction[];
  readonly failure: string;
  readonly state: () => GpuiHomeState;
  readonly isConnected: () => boolean;
  readonly getGeneration: () => number;
  readonly optimistic: GpuiOptimisticBridge;
  readonly ha?: HomeAssistantConnection;
  readonly hub: HubConnection;
  readonly commitServerSnapshot: (snapshot: Snapshot) => void;
  readonly publishHome: () => void;
  readonly update: (patch: Partial<GpuiHomeState>) => void;
}): Promise<void> {
  const current = params.state();
  if (
    !params.actions.length ||
    current.busy ||
    !current.session ||
    current.offline ||
    !params.isConnected()
  ) {
    return;
  }
  if (current.error) params.update({ error: null });
  const generation = params.getGeneration();
  try {
    await params.optimistic.executeBatch(params.actions);
    if (generation !== params.getGeneration() || params.state().offline || !params.isConnected()) {
      return;
    }
    if (params.state().sessionKind === 'home-assistant' && params.ha) {
      if (params.optimistic.pendingCount > 0) {
        params.commitServerSnapshot(await readHaSnapshot(params.ha));
      }
    } else {
      await params.hub.refresh(false);
      if (generation === params.getGeneration()) params.publishHome();
    }
  } catch (error) {
    if (generation !== params.getGeneration()) return;
    const sessionKind = params.state().sessionKind;
    const preserved = error instanceof Error && error.message && sessionKind === 'home-assistant';
    const lostConnection =
      !params.isConnected() || (sessionKind === 'haus-hub' && error instanceof TypeError);
    params.update({
      ...(lostConnection ? { offline: true, snapshot: params.optimistic.reset() } : {}),
      error: preserved ? error.message : params.failure,
    });
  }
}
