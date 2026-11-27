/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  AlertsTransport,
  ClientVisibilityPreferences,
  ManagementPort,
  ManagementRequest,
} from '@haus/core/transport';
import {
  defaults,
  PreferenceSync,
  sanitizePreferences,
  sharedPreferences,
  type Preferences,
  type SharedDocument,
} from '@haus/core/preferences';
import type { CredentialStore } from '@haus/ha/native-types';
import { readHaSnapshot } from '@haus/ha/snapshot';
import type { Snapshot } from '@haus/ha/types';
import type { BrandIconPort } from '@haus/ui/components';
import { applyBrandIconDropShadow, createGpuiBrandIconPort } from '@haus/ui/gpui';
import {
  renderGpuiLocalBrandTile,
  resolveGpuiLocalBrandSource,
  resolveGpuiLocalBrandTile,
} from './brand-service.js';
import type { HomeAssistantConnection } from '../../main/connection.js';
import { HausHelper } from '../../main/helper.js';
import type { HubSessionManagerDependencies } from '../../main/hub-session.js';
import type { HubConnection } from '../../main/hub/connection.js';
import { isRecord } from '../../main/hub/types.js';
import type { DiscoveredServer, NativeEvent, NativeSession } from '../../shared/native.js';

export interface GpuiHomeState {
  readonly session: NativeSession | null;
  readonly sessionKind: 'haus-hub' | 'home-assistant';
  readonly snapshot: Snapshot | null;
  readonly preferences: Preferences;
  readonly preferenceStatus: 'syncing' | 'synced' | 'offline';
  readonly servers: readonly DiscoveredServer[];
  readonly scanning: boolean;
  readonly busy: boolean;
  readonly offline: boolean;
  readonly pairingUrl: string | null;
  readonly error: string | null;
}

export function createInitialHomeState(defaultTheme?: Preferences['theme']): GpuiHomeState {
  return {
    session: null,
    sessionKind: 'haus-hub',
    snapshot: null,
    preferences: defaultTheme ? { ...defaults, theme: defaultTheme } : defaults,
    preferenceStatus: 'offline',
    servers: [],
    scanning: false,
    busy: false,
    offline: false,
    pairingUrl: null,
    error: null,
  };
}

export function hasHaCredentialStore(
  store: HubSessionManagerDependencies['store'] & Partial<CredentialStore>,
): store is HubSessionManagerDependencies['store'] & CredentialStore {
  return (
    typeof store.loadSession === 'function' &&
    typeof store.saveSession === 'function' &&
    typeof store.clearSession === 'function' &&
    typeof store.loadHomeCache === 'function' &&
    typeof store.saveHomeCache === 'function' &&
    Boolean(store.cameraSnapshots)
  );
}

export function decodeSharedPreferences(input: unknown): SharedDocument {
  if (
    !isRecord(input) ||
    typeof input.revision !== 'string' ||
    !isRecord(input.value) ||
    typeof input.updatedAt !== 'number' ||
    !Number.isFinite(input.updatedAt)
  ) {
    throw new Error('The Hub returned invalid preferences.');
  }
  return {
    revision: input.revision,
    value: input.value,
    updatedAt: input.updatedAt,
    conflict: input.conflict === true,
  };
}

export function createGpuiCameraHelper(options: {
  readonly hub: string;
  readonly sessionKind: () => 'haus-hub' | 'home-assistant';
  readonly isConnected: () => boolean;
  readonly currentUrl: () => string | undefined;
  readonly scope: () => string | undefined;
  readonly hubConnection: HubConnection;
  readonly request: <T = unknown>(message: Record<string, unknown>) => Promise<T>;
}): HausHelper {
  const checkHub = () => {
    if (options.scope() !== options.hub) throw new Error('The connected home changed.');
  };
  return new HausHelper({
    isHub: options.sessionKind() === 'haus-hub',
    serverUrl: options.hub,
    credentialScope: options.hub,
    get connected() {
      return options.isConnected() && options.currentUrl() === options.hub;
    },
    async addonSurface() {
      checkHub();
      if (options.sessionKind() === 'home-assistant') {
        throw new Error('Add-on surfaces require a Haus Hub connection.');
      }
      const surface = await options.hubConnection.addonSurface();
      if (surface.url !== `${options.hub}/`) throw new Error('The connected home changed.');
      return surface;
    },
    request(message) {
      checkHub();
      return options.request(message);
    },
  });
}

export interface HaStateChangedDelta {
  readonly entityId: string;
  readonly entity: Snapshot['states'][number] | null;
  readonly contextId?: string;
}

export function extractHaStateChangedDelta(
  event: Extract<NativeEvent, { type: 'ha-event' }>['event'],
): HaStateChangedDelta | null {
  if (event.event_type !== 'state_changed' || !isRecord(event.data)) return null;
  const contextId =
    isRecord(event.context) && typeof event.context.id === 'string' && event.context.id.length > 0
      ? event.context.id
      : undefined;
  const next = event.data.new_state;
  if (next === null && typeof event.data.entity_id === 'string') {
    return { entityId: event.data.entity_id, entity: null, contextId };
  }
  if (
    !isRecord(next) ||
    typeof next.entity_id !== 'string' ||
    typeof next.state !== 'string' ||
    !isRecord(next.attributes)
  ) {
    return null;
  }
  const entity: Snapshot['states'][number] = {
    entity_id: next.entity_id,
    state: next.state,
    attributes: { ...next.attributes },
    last_changed: typeof next.last_changed === 'string' ? next.last_changed : '',
    last_updated: typeof next.last_updated === 'string' ? next.last_updated : undefined,
  };
  return { entityId: entity.entity_id, entity, contextId };
}

export function applyHaStateDeltaToSnapshot(
  snapshot: Snapshot,
  delta: HaStateChangedDelta,
): Snapshot {
  if (delta.entity === null) {
    return {
      ...snapshot,
      states: snapshot.states.filter((item) => item.entity_id !== delta.entityId),
    };
  }
  const entity = delta.entity;
  const index = snapshot.states.findIndex((item) => item.entity_id === entity.entity_id);
  const states =
    index >= 0
      ? snapshot.states.map((item, i) => (i === index ? entity : item))
      : [...snapshot.states, entity];
  return { ...snapshot, states };
}

export function applyHaStateChangedEvent(
  snapshot: Snapshot,
  data: Record<string, unknown>,
): Snapshot | null {
  const delta = extractHaStateChangedDelta({ event_type: 'state_changed', data });
  return delta ? applyHaStateDeltaToSnapshot(snapshot, delta) : null;
}

export function createGpuiPreferenceSync(options: {
  readonly getPreferences: () => Preferences;
  readonly applyPreferences: (next: Preferences) => void;
  readonly connection: HubConnection;
  readonly onStatus: (status: 'syncing' | 'synced' | 'offline') => void;
}): PreferenceSync {
  return new PreferenceSync({
    local: () => sharedPreferences(options.getPreferences()),
    apply: (patch) =>
      options.applyPreferences(sanitizePreferences({ ...options.getPreferences(), ...patch })),
    read: async () => decodeSharedPreferences(await options.connection.readPreferences()),
    write: async (revision, patch) =>
      decodeSharedPreferences(await options.connection.writePreferences(revision, patch)),
    status: options.onStatus,
    seedMissing: false,
  });
}

export function startGpuiPreferencePoll(
  sync: PreferenceSync,
  isConnected: () => boolean,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    if (isConnected()) void sync.sync();
  }, intervalMs);
  timer.unref();
  return timer;
}

export function handleHaRuntimeEvent(
  event: NativeEvent,
  ha: HomeAssistantConnection,
  currentSnapshot: () => Snapshot | null,
  onSnapshot: (snapshot: Snapshot) => void,
  onOffline: () => void,
  onStateDelta?: (delta: HaStateChangedDelta) => void,
): void {
  if (event.type === 'connection' && event.status !== 'connected') onOffline();
  if (event.type === 'connection' && event.status === 'connected') {
    void readHaSnapshot(ha).then(onSnapshot, onOffline);
  }
  if (event.type === 'ha-event' && event.event.event_type === 'state_changed') {
    const delta = extractHaStateChangedDelta(event.event);
    if (!delta) return;
    if (onStateDelta) {
      onStateDelta(delta);
      return;
    }
    const snapshot = currentSnapshot();
    if (snapshot) onSnapshot(applyHaStateDeltaToSnapshot(snapshot, delta));
  }
}

export async function readGpuiCameraSnapshot(
  sessionKind: 'haus-hub' | 'home-assistant',
  hubConnection: HubConnection,
  haConnection: HomeAssistantConnection | undefined,
  entityId: string,
): Promise<string | null> {
  const frame =
    sessionKind === 'home-assistant' && haConnection
      ? await haConnection.cameraLastSnapshot(entityId)
      : await hubConnection.cameraSnapshot(entityId);
  return frame?.image ?? null;
}

export function readGpuiStatistics(
  connected: boolean,
  message: Record<string, unknown>,
  request: <T = unknown>(msg: Record<string, unknown>) => Promise<T>,
): Promise<unknown> {
  if (!connected) return Promise.reject(new Error('Reconnect to the Hub.'));
  if (
    ![
      'recorder/list_statistic_ids',
      'recorder/statistics_during_period',
      'history/history_during_period',
    ].includes(String(message.type))
  ) {
    return Promise.reject(new Error('Unsupported statistics request.'));
  }
  return request(message);
}

export function createGpuiAlertsTransport(options: {
  readonly sessionKind: () => 'haus-hub' | 'home-assistant';
  readonly isConnected: () => boolean;
  readonly request: <T = unknown>(message: Record<string, unknown>) => Promise<T>;
  readonly hubConnection: HubConnection;
}): AlertsTransport {
  return {
    get connected() {
      return options.isConnected();
    },
    get supportsPairingRequests() {
      return options.sessionKind() === 'haus-hub';
    },
    get reportNotificationLoadError() {
      return options.sessionKind() === 'home-assistant';
    },
    request: (message) => options.request(message),
    management: (input) => options.hubConnection.management(input),
  };
}

export function createGpuiManagementPort(options: {
  readonly sessionKind: () => 'haus-hub' | 'home-assistant';
  readonly isConnected: () => boolean;
  readonly hubConnection: HubConnection;
  readonly haConnection?: HomeAssistantConnection;
}): ManagementPort {
  return {
    management<T = unknown>(input: ManagementRequest): Promise<T> {
      if (!options.isConnected()) return Promise.reject(new Error('Connect your home first.'));
      if (options.sessionKind() === 'home-assistant' && options.haConnection) {
        return options.haConnection.management(input) as Promise<T>;
      }
      return options.hubConnection.management(input) as Promise<T>;
    },
  };
}

export function mergeGpuiPreferencePatch(
  current: Preferences,
  patch: Partial<Preferences> & Partial<ClientVisibilityPreferences>,
): Preferences {
  return sanitizePreferences({ ...current, ...patch });
}

export function createGpuiBrandIconsBridge(options: {
  readonly sessionKind: () => 'haus-hub' | 'home-assistant';
  readonly isConnected: () => boolean;
  readonly hubConnection: HubConnection;
  readonly haConnection?: HomeAssistantConnection;
  readonly subscribeInvalidation: (listener: (revision?: string) => void) => () => void;
}): BrandIconPort {
  return createGpuiBrandIconPort({
    resolveTile: async (kind, id, style, hint) => {
      if (options.isConnected()) {
        if (options.sessionKind() === 'haus-hub') {
          const hubTile = await options.hubConnection.brandIconTile(kind, id, style, hint);
          if (hubTile?.rendered && hubTile.dataUri) return hubTile;
          if (hubTile?.dataUri) {
            return resolveGpuiLocalBrandTile(kind, id, style, hint, async () => ({
              dataUri: hubTile.dataUri ?? null,
              isFallback: Boolean(hubTile.dataUri?.startsWith('data:image/svg+xml;')),
            }));
          }
        } else if (options.haConnection) {
          const haConn = options.haConnection;
          return resolveGpuiLocalBrandTile(kind, id, style, hint, async () => {
            const raw = await haConn.brandIcon(kind, id, false, hint);
            return {
              dataUri: raw,
              isFallback: Boolean(raw?.startsWith('data:image/svg+xml;')),
            };
          });
        }
      }
      return resolveGpuiLocalBrandTile(kind, id, style, hint);
    },
    resolveSource: async (kind, id, dark, hint) => {
      if (options.isConnected()) {
        const remote =
          options.sessionKind() === 'home-assistant' && options.haConnection
            ? await options.haConnection.brandIcon(kind, id, dark, hint)
            : await options.hubConnection.brandIcon(kind, id, dark, hint);
        if (remote) return remote;
      }
      return resolveGpuiLocalBrandSource(kind, id, dark, hint);
    },
    renderLocalTile: renderGpuiLocalBrandTile,
    applyTileShadow: applyBrandIconDropShadow,
    subscribeInvalidation: options.subscribeInvalidation,
  });
}

export function createGpuiRuntimePorts(options: {
  readonly sessionKind: () => 'haus-hub' | 'home-assistant';
  readonly isConnected: () => boolean;
  readonly request: <T = unknown>(message: Record<string, unknown>) => Promise<T>;
  readonly hubConnection: HubConnection;
  readonly haConnection?: HomeAssistantConnection;
  readonly subscribeBrandInvalidation: (listener: (revision?: string) => void) => () => void;
}) {
  return {
    alertsTransport: createGpuiAlertsTransport(options),
    managementPort: createGpuiManagementPort(options),
    brandIcons: createGpuiBrandIconsBridge({
      ...options,
      subscribeInvalidation: options.subscribeBrandInvalidation,
    }),
  };
}
