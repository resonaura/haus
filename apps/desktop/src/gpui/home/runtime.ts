/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AlertsTransport, ManagementPort } from '@haus/core/transport';
import type { CredentialStore } from '@haus/ha/native-types';
import type { HausAction, Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import { defaults, type PreferenceSync, type Preferences } from '@haus/core/preferences';
import type { NativeEvent, NativeSession } from '../../shared/native.js';
import { HomeAssistantConnection } from '../../main/connection.js';
import { createDiscoveryTask, type DiscoveryTask } from '../../main/discovery.js';
import { HubConnection } from '../../main/hub/connection.js';
import type { HubSessionManagerDependencies } from '../../main/hub-session.js';
import { createGpuiRuntimeSystem, type GpuiSystemPorts } from '../management/servers-port.js';
import { connectHome } from './connect.js';
import {
  createGpuiCameraHelper,
  createGpuiPreferenceSync,
  createGpuiRuntimePorts,
  createInitialHomeState,
  handleHaRuntimeEvent,
  hasHaCredentialStore,
  readGpuiCameraSnapshot,
  readGpuiStatistics,
  startGpuiPreferencePoll,
  type GpuiHomeState,
} from './ha-bridge.js';
import {
  availableDeviceActions,
  lightAction,
  updateFavorite,
  type DeviceIntent,
  type DeviceTarget,
} from './model.js';
import {
  createGpuiRegistryController,
  dispatchGpuiDeviceActions,
  GpuiOptimisticBridge,
  loadGpuiHomeSession,
  routeGpuiHubEvent,
  runGpuiServerScan,
} from './optimistic-bridge.js';

const PREFERENCES_MS = 15_000;

/** A single composition root owns authenticated transport, confirmed facts, and optimistic intent. */
export class GpuiHomeRuntime {
  private readonly connection: HubConnection;
  private readonly ha?: HomeAssistantConnection;
  private readonly optimistic: GpuiOptimisticBridge;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private generation = 0;
  readonly registry: RegistryController;
  readonly alertsTransport: AlertsTransport;
  readonly managementPort: ManagementPort;
  readonly brandIcons: ReturnType<typeof createGpuiRuntimePorts>['brandIcons'];
  private readonly brandInvalidationListeners = new Set<(revision?: string) => void>();
  private readonly systemAccess: ReturnType<typeof createGpuiRuntimeSystem>;
  private discovery?: DiscoveryTask;
  private boot?: Promise<void>;
  private preferenceSync?: PreferenceSync;
  private preferenceTimer?: ReturnType<typeof setInterval>;
  private state: GpuiHomeState = createInitialHomeState();

  constructor(
    store: HubSessionManagerDependencies['store'] & Partial<CredentialStore>,
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly discover: (options?: { explicitHa?: boolean }) => DiscoveryTask = (options) =>
      createDiscoveryTask(3500, undefined, undefined, options),
    private readonly appearance?: {
      theme: Preferences['theme'];
      save(theme: Preferences['theme']): Promise<void>;
    },
    options?: {
      readonly openBrowser?: (url: string, hub: string) => Promise<void>;
    },
  ) {
    if (appearance)
      this.state = { ...this.state, preferences: { ...defaults, theme: appearance.theme } };
    const scopedFetch: typeof fetch = (input, init) =>
      fetchFn(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([this.lifetime.signal, init?.signal ?? AbortSignal.timeout(10000)]),
      });
    this.optimistic = new GpuiOptimisticBridge({
      send: (action) => this.requestActive({ type: 'call_service', ...action }),
      onProjectedSnapshot: (snapshot) => this.update({ snapshot }),
      onNotice: (error) => this.update({ error }),
    });
    this.connection = new HubConnection(store, (event) => this.onHubEvent(event), scopedFetch);
    if (hasHaCredentialStore(store) && options?.openBrowser) {
      const openExternal = options.openBrowser;
      this.ha = new HomeAssistantConnection(
        store,
        (event) => this.onHaEvent(event),
        (url) => openExternal(url, url),
      );
    }
    this.registry = createGpuiRegistryController({
      optimistic: this.optimistic,
      getGeneration: () => this.generation,
      isConnected: () => !this.state.offline && !this.state.busy && this.activeConnected,
      commitSnapshot: (snapshot) => this.commitServerSnapshot(snapshot),
      request: (message) => this.requestActive(message),
    });
    this.systemAccess = createGpuiRuntimeSystem({
      getHubAccess: () => {
        const token =
          this.state.sessionKind === 'haus-hub' ? this.connection.getBearerToken() : undefined;
        const url = this.connection.serverUrl;
        return url && token ? { url, token } : null;
      },
      getHelper: () => {
        const url = this.connection.serverUrl;
        return this.state.sessionKind === 'haus-hub' && url ? this.createCameraViewer(url) : null;
      },
      getRequestRpc: () => this.requestRpc,
      getSessionKind: () => this.state.sessionKind,
    });
    const ports = createGpuiRuntimePorts({
      sessionKind: () => this.state.sessionKind,
      isConnected: () => this.activeConnected && !this.state.offline,
      request: (msg) => this.requestActive(msg),
      hubConnection: this.connection,
      haConnection: this.ha,
      subscribeBrandInvalidation: (listener) => (
        this.brandInvalidationListeners.add(listener),
        () => this.brandInvalidationListeners.delete(listener)
      ),
    });
    this.alertsTransport = ports.alertsTransport;
    this.managementPort = ports.managementPort;
    this.brandIcons = ports.brandIcons;
  }

  private get activeConnected(): boolean {
    return this.state.sessionKind === 'home-assistant'
      ? Boolean(this.ha?.connected)
      : this.connection.connected;
  }

  private requestActive<T = unknown>(message: Record<string, unknown>): Promise<T> {
    return this.state.sessionKind === 'home-assistant' && this.ha
      ? this.ha.request<T>(message)
      : this.connection.request<T>(message);
  }

  getSnapshot = () => this.state;
  getConfirmedSnapshot = () => this.optimistic.confirmed;
  requestRpc = <T = unknown>(message: Record<string, unknown>): Promise<T> =>
    this.requestActive<T>(message);
  readStatistics = (message: Record<string, unknown>): Promise<unknown> =>
    readGpuiStatistics(Boolean(this.state.session && !this.state.offline), message, (msg) =>
      this.requestActive(msg),
    );
  readCameraSnapshot = (entityId: string): Promise<string | null> =>
    this.state.session && !this.state.offline
      ? readGpuiCameraSnapshot(this.state.sessionKind, this.connection, this.ha, entityId)
      : Promise.resolve(null);
  get systemPorts(): GpuiSystemPorts {
    return this.systemAccess.snapshotPorts();
  }
  applySceneEntities = (entities: Record<string, unknown>): Promise<void> =>
    this.dispatchActions(
      [
        {
          domain: 'scene',
          service: 'apply',
          target: { entity_id: 'scene.preview' },
          service_data: { entities },
        },
      ],
      'Could not preview scene.',
    );
  createCameraViewer = (hub: string) =>
    createGpuiCameraHelper({
      hub,
      sessionKind: () => this.state.sessionKind,
      isConnected: () => this.activeConnected,
      currentUrl: () => this.state.session?.url,
      scope: () =>
        this.state.sessionKind === 'home-assistant'
          ? this.ha?.credentialScope
          : this.connection.credentialScope,
      hubConnection: this.connection,
      request: (msg) => this.requestActive(msg),
    });
  subscribe = (listener: () => void) => (
    this.listeners.add(listener),
    () => this.listeners.delete(listener)
  );

  start(): Promise<void> {
    this.boot ??= this.perform('The saved Hub session could not be opened.', async () => {
      const hubSession = await this.connection.getSession();
      if (hubSession) return this.loadHome(hubSession, 'haus-hub');
      const haSession = await this.ha?.getSession();
      if (haSession) await this.loadHome(haSession, 'home-assistant');
    });
    return this.boot;
  }

  scan(explicitHa = false): Promise<void> {
    const task = this.discover({ explicitHa });
    this.discovery?.cancel();
    this.discovery = task;
    return runGpuiServerScan({
      task,
      isCurrent: () => this.discovery === task,
      clearTask: () => (this.discovery = undefined),
      update: (patch) => this.update(patch),
    });
  }

  connect(address: string, code?: string, explicitHa = false): Promise<void> {
    return this.perform(
      explicitHa ? 'Could not connect to Home Assistant.' : 'Could not connect to the Haus Hub.',
      () =>
        connectHome(
          { address, code, explicitHa },
          {
            state: this.getSnapshot,
            update: (patch) => this.update(patch),
            cancelDiscovery: () => this.discovery?.cancel(),
            stopPreferenceSync: () => this.stopPreferenceSync(),
            loadHome: (session, kind) => this.loadHome(session, kind),
            hub: this.connection,
            ha: this.ha,
          },
        ),
    );
  }

  cancelPairing(): void {
    if (this.state.busy) return;
    this.connection.cancelPairing();
    this.update({ pairingUrl: null, error: null });
  }

  private async reconnectHub(): Promise<void> {
    if (!this.state.session) return;
    const next = this.connection.connected ? this.state.session : await this.connection.reconnect();
    if (next && this.connection.connected) await this.loadHome(next, 'haus-hub');
    else if (!next) this.clearSessionState();
  }
  private clearSessionState(): void {
    this.update({ session: null, snapshot: this.optimistic.reset(true), offline: false });
  }
  reconnect(): Promise<void> {
    return this.perform('The home server is unavailable.', async () => {
      if (!this.state.session) return;
      if (this.state.sessionKind === 'home-assistant' && this.ha) {
        const haSession = await this.ha.getSession();
        if (haSession && this.ha.connected) await this.loadHome(haSession, 'home-assistant');
        else if (!haSession) this.clearSessionState();
        return;
      }
      await this.reconnectHub();
    });
  }

  disconnect(): Promise<void> {
    return this.perform('The saved session could not be removed.', async () => {
      this.stopPreferenceSync();
      this.optimistic.reset();
      this.update({ offline: true, preferenceStatus: 'offline' });
      if (this.state.sessionKind === 'home-assistant' && this.ha) await this.ha.disconnect();
      else await this.connection.disconnect();
      const theme = this.state.preferences.theme;
      this.update({
        session: null,
        sessionKind: 'haus-hub',
        snapshot: this.optimistic.reset(true),
        preferences: { ...defaults, theme },
        offline: false,
      });
    });
  }

  toggleLight(id: string): Promise<void> {
    const action = this.state.snapshot && lightAction(this.state.snapshot, id);
    return action
      ? this.dispatchActions(
          [action],
          'The command could not be confirmed. Check the light before trying again.',
        )
      : Promise.resolve();
  }

  controlDevice(target: DeviceTarget, intent: DeviceIntent, value?: unknown): Promise<void> {
    if (!this.state.snapshot) return Promise.resolve();
    return this.dispatchActions(
      availableDeviceActions(this.state.snapshot, target, intent, value),
      'The command could not be confirmed. Check the device before trying again.',
    );
  }

  private dispatchActions(actions: readonly HausAction[], failure: string): Promise<void> {
    return dispatchGpuiDeviceActions({
      actions,
      failure,
      state: this.getSnapshot,
      isConnected: () => this.activeConnected,
      getGeneration: () => this.generation,
      optimistic: this.optimistic,
      ha: this.ha,
      hub: this.connection,
      commitServerSnapshot: (snapshot) => this.commitServerSnapshot(snapshot),
      publishHome: () => this.publishHome(),
      update: (patch) => this.update(patch),
    });
  }

  setTheme(theme: Preferences['theme']): Promise<void> {
    return this.perform('Could not save desktop appearance.', async () => {
      await this.appearance?.save(theme);
      this.update({ preferences: { ...this.state.preferences, theme } });
    });
  }

  openDeviceAddress(url: string, open: (url: string, hub: string) => Promise<void>): Promise<void> {
    return this.perform('Could not open this device in the browser.', async () => {
      if (this.state.session) await open(url, this.state.session.url);
    });
  }
  setLightGrouping(autoGroupLights: boolean): Promise<void> {
    return this.updateSharedPreferences({ autoGroupLights }, 'Could not update light grouping.');
  }
  savePreferences(patch: Partial<Preferences>): Promise<void> {
    return this.updateSharedPreferences(patch, 'Could not save desktop preferences.');
  }
  resetSeparatedLightGroups(): Promise<void> {
    return this.updateSharedPreferences(
      { disabledLightGroups: [] },
      'Could not reset separated light groups.',
    );
  }
  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.perform('Could not update favorites.', async () => {
      const { snapshot, preferences, offline, preferenceStatus } = this.state;
      if (!snapshot || offline) return;
      if (
        this.state.sessionKind === 'haus-hub' &&
        (preferenceStatus !== 'synced' || !this.preferenceSync)
      )
        return;
      const next = updateFavorite(snapshot, preferences, id, favorite);
      if (!next) return;
      this.update({ preferences: next });
      await this.preferenceSync?.sync();
    });
  }
  dispose(): void {
    this.generation++;
    this.optimistic.dispose();
    this.discovery?.cancel();
    this.stopPreferenceSync();
    this.systemAccess.terminal.closeAll();
    this.connection.dispose();
    this.ha?.dispose();
    this.lifetime.abort();
    this.listeners.clear();
  }

  private updateSharedPreferences(patch: Partial<Preferences>, failure: string): Promise<void> {
    return this.perform(failure, async () => {
      const { offline, preferenceStatus, sessionKind, preferences } = this.state;
      if (
        offline ||
        (sessionKind === 'haus-hub' && (preferenceStatus !== 'synced' || !this.preferenceSync))
      )
        return;
      this.update({ preferences: { ...preferences, ...patch } });
      await this.preferenceSync?.sync();
    });
  }

  private loadHome(session: NativeSession, kind: 'haus-hub' | 'home-assistant'): Promise<void> {
    return loadGpuiHomeSession({
      session,
      kind,
      ha: this.ha,
      hub: this.connection,
      optimistic: this.optimistic,
      getPreferences: () => this.state.preferences,
      syncPreferences: () => this.startPreferenceSync().sync(),
      commitSnapshot: (snapshot, extra) => this.commitServerSnapshot(snapshot, extra),
      update: (patch) => this.update(patch),
      markOffline: (error) => this.markOffline(error),
    });
  }

  private onHubEvent(event: NativeEvent): void {
    routeGpuiHubEvent({
      event,
      active: Boolean(this.state.session && this.state.sessionKind === 'haus-hub'),
      optimistic: this.optimistic,
      onBrandInvalidated: (version) => {
        for (const listener of this.brandInvalidationListeners) listener(version);
      },
      onOffline: () => this.markOffline(),
      onPublishHome: () => this.publishHome(),
      onProjected: (snapshot) => this.update({ snapshot, offline: false }),
      onSyncPreferences: () => void this.preferenceSync?.sync(),
    });
  }

  private onHaEvent(event: NativeEvent): void {
    if (!this.state.session || this.state.sessionKind !== 'home-assistant' || !this.ha) return;
    handleHaRuntimeEvent(
      event,
      this.ha,
      () => this.optimistic.confirmed,
      (snapshot) => this.commitServerSnapshot(snapshot, { offline: false }),
      () => this.markOffline(),
      (delta) => {
        const next = this.optimistic.applyDelta(delta);
        if (next && next !== 'ignored') this.update({ snapshot: next, offline: false });
      },
    );
  }

  private publishHome(): void {
    const snapshot = this.connection.currentHome();
    if (!snapshot) return;
    this.commitServerSnapshot(snapshot, { offline: false });
    if (!this.preferenceSync) void this.startPreferenceSync().sync();
  }

  private commitServerSnapshot(snapshot: Snapshot, extra?: Partial<GpuiHomeState>): void {
    const projected = this.optimistic.commitSnapshot(snapshot);
    const preferences = this.optimistic.mergeLightMemoryPreferences(
      this.state.session?.url,
      this.state.preferences,
    );
    this.update({ ...extra, ...(preferences ? { preferences } : {}), snapshot: projected });
  }

  private markOffline(error?: string): void {
    this.update({ offline: true, snapshot: this.optimistic.reset(), ...(error ? { error } : {}) });
  }

  private startPreferenceSync(): PreferenceSync {
    if (this.preferenceSync) return this.preferenceSync;
    const sync = createGpuiPreferenceSync({
      getPreferences: () => this.state.preferences,
      applyPreferences: (preferences) => {
        this.optimistic.hydrateLightMemory(this.state.session?.url, preferences);
        const snapshot = this.optimistic.confirmed ? this.optimistic.project() : undefined;
        this.update({ preferences, ...(snapshot !== undefined ? { snapshot } : {}) });
      },
      connection: this.connection,
      onStatus: (preferenceStatus) => this.update({ preferenceStatus }),
    });
    this.preferenceSync = sync;
    this.preferenceTimer = startGpuiPreferencePoll(
      sync,
      () => this.connection.connected,
      PREFERENCES_MS,
    );
    return sync;
  }

  private stopPreferenceSync(): void {
    this.preferenceSync?.stop();
    this.preferenceSync = undefined;
    clearInterval(this.preferenceTimer);
    this.preferenceTimer = undefined;
  }
  private async perform(message: string, operation: () => Promise<void>): Promise<void> {
    if (this.state.busy) return;
    this.update({ busy: true, error: null });
    try {
      await operation();
    } catch (error) {
      const preserved =
        error instanceof Error && error.message && this.state.sessionKind === 'home-assistant';
      this.update({ error: preserved ? error.message : message });
    } finally {
      this.update({ busy: false });
    }
  }

  private update(patch: Partial<GpuiHomeState>): void {
    if ('session' in patch && patch.session?.url !== this.state.session?.url) {
      this.generation++;
      this.optimistic.reset(patch.session === null);
    }
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
