/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ManagementPort } from '@haus/core/transport';
import { defaults, type Preferences } from '@haus/ha/view/preferences';
import type { PreferenceSync } from '@haus/ha/view/settings/sync';
import type { CredentialStore } from '@haus/ha/native-types';
import { readHaSnapshot } from '@haus/ha/snapshot';
import { RegistryController } from '@haus/ha/ui/registry';
import type { NativeEvent, NativeSession } from '../../shared/native.js';
import { HomeAssistantConnection } from '../../main/connection.js';
import { createDiscoveryTask, type DiscoveryTask } from '../../main/discovery.js';
import { HubConnection, HUB_PAIRING_REQUIRED } from '../../main/hub/connection.js';
import { HubCredentialSaveError, type HubSessionManagerDependencies } from '../../main/hub-session.js';
import { normalizeServerUrl } from '../../main/validation.js';
import {
  createGpuiAlertsTransport,
  createGpuiCameraHelper,
  createGpuiManagementPort,
  createGpuiPreferenceSync,
  createInitialHomeState,
  handleHaRuntimeEvent,
  hasHaCredentialStore,
  readGpuiCameraSnapshot,
  readGpuiStatistics,
  startGpuiPreferencePoll,
  type GpuiHomeState,
} from './ha-bridge.js';
import { availableAction, lightCommand, updateFavorite, type DeviceIntent } from './model.js';
import { createGpuiRuntimeSystem, type GpuiSystemPorts } from '../management/servers-port.js';

const PREFERENCES_MS = 15_000;

/** A single composition root owns the authenticated transport and exposes display state only. */
export class GpuiHomeRuntime {
  private readonly connection: HubConnection;
  private readonly ha?: HomeAssistantConnection;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private generation = 0;
  readonly registry: RegistryController;
  private readonly systemAccess: ReturnType<typeof createGpuiRuntimeSystem>;
  private discovery?: DiscoveryTask;
  private boot?: Promise<void>;
  private preferenceSync?: PreferenceSync;
  private preferenceTimer?: ReturnType<typeof setInterval>;
  private state: GpuiHomeState = createInitialHomeState();

  constructor(
    store: HubSessionManagerDependencies['store'] & Partial<CredentialStore>,
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly discover: (options?: { explicitHa?: boolean }) => DiscoveryTask = (
      options,
    ) => createDiscoveryTask(3500, undefined, undefined, options),
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
    this.connection = new HubConnection(store, (event) => this.onHubEvent(event), scopedFetch);
    if (hasHaCredentialStore(store) && options?.openBrowser) {
      const openExternal = options.openBrowser;
      this.ha = new HomeAssistantConnection(
        store,
        (event) => this.onHaEvent(event),
        (url) => openExternal(url, url),
      );
    }
    this.registry = new RegistryController({
      snapshot: () => {
        if (!this.state.snapshot) throw new Error('Wait for the home to load.');
        return this.state.snapshot;
      },
      context: () => ({
        mode: 'live',
        generation: this.generation,
        status:
          this.state.offline || this.state.busy || !this.activeConnected
            ? 'disconnected'
            : 'connected',
      }),
      commit: (update) => {
        if (this.state.snapshot) this.update({ snapshot: update(this.state.snapshot) });
      },
      request: (message) => this.requestActive(message),
    });
    this.systemAccess = createGpuiRuntimeSystem({
      getHubAccess: () => {
        const token = this.state.sessionKind === 'haus-hub' ? this.connection.getBearerToken() : undefined;
        return this.connection.serverUrl && token ? { url: this.connection.serverUrl, token } : null;
      },
      getHelper: () =>
        this.state.sessionKind === 'haus-hub' && this.connection.serverUrl ? this.createCameraViewer(this.connection.serverUrl) : null,
      getRequestRpc: () => this.requestRpc,
      getSessionKind: () => this.state.sessionKind,
    });
  }

  private get activeConnected(): boolean {
    return this.state.sessionKind === 'home-assistant'
      ? Boolean(this.ha?.connected)
      : this.connection.connected;
  }

  private requestActive<T = unknown>(message: Record<string, unknown>): Promise<T> {
    if (this.state.sessionKind === 'home-assistant' && this.ha) {
      return this.ha.request<T>(message);
    }
    return this.connection.request<T>(message);
  }

  getSnapshot = () => this.state;
  requestRpc = <T = unknown>(message: Record<string, unknown>): Promise<T> => this.requestActive<T>(message);
  readStatistics = (message: Record<string, unknown>): Promise<unknown> =>
    readGpuiStatistics(Boolean(this.state.session && !this.state.offline), message, (msg) => this.requestActive(msg));
  readCameraSnapshot = (entityId: string): Promise<string | null> =>
    this.state.session && !this.state.offline
      ? readGpuiCameraSnapshot(this.state.sessionKind, this.connection, this.ha, entityId)
      : Promise.resolve(null);
  get alertsTransport() {
    return createGpuiAlertsTransport({
      sessionKind: () => this.state.sessionKind,
      isConnected: () => this.activeConnected && !this.state.offline,
      request: (msg) => this.requestActive(msg),
      hubConnection: this.connection,
    });
  }
  get managementPort(): ManagementPort {
    return createGpuiManagementPort({
      sessionKind: () => this.state.sessionKind,
      isConnected: () => this.activeConnected && !this.state.offline,
      hubConnection: this.connection,
      haConnection: this.ha,
    });
  }
  get systemPorts(): GpuiSystemPorts {
    return this.systemAccess.snapshotPorts();
  }
  applySceneEntities = (entities: Record<string, unknown>): Promise<void> =>
    this.requestActive({ type: 'call_service', domain: 'scene', service: 'apply', service_data: { entities } }).then(() => undefined);
  createCameraViewer = (hub: string) =>
    createGpuiCameraHelper({
      hub,
      sessionKind: () => this.state.sessionKind,
      isConnected: () => this.activeConnected,
      currentUrl: () => this.state.session?.url,
      scope: () => (this.state.sessionKind === 'home-assistant' ? this.ha?.credentialScope : this.connection.credentialScope),
      hubConnection: this.connection,
      request: (msg) => this.requestActive(msg),
    });
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  start(): Promise<void> {
    this.boot ??= this.perform('The saved Hub session could not be opened.', async () => {
      const hubSession = await this.connection.getSession();
      if (hubSession) {
        this.update({ sessionKind: 'haus-hub' });
        await this.loadHome(hubSession, 'haus-hub');
        return;
      }
      if (this.ha) {
        const haSession = await this.ha.getSession();
        if (haSession) {
          this.update({ sessionKind: 'home-assistant' });
          await this.loadHome(haSession, 'home-assistant');
        }
      }
    });
    return this.boot;
  }

  async scan(explicitHa = false): Promise<void> {
    const task = this.discover({ explicitHa });
    this.discovery?.cancel();
    this.discovery = task;
    this.update({ scanning: true, servers: [] });
    try {
      const servers = await task.promise;
      if (this.discovery === task) this.update({ servers });
    } catch {
      if (this.discovery === task) this.update({ error: 'Could not scan for local hubs.' });
    } finally {
      if (this.discovery === task) {
        this.discovery = undefined;
        this.update({ scanning: false });
      }
    }
  }

  connect(address: string, code?: string, explicitHa = false): Promise<void> {
    return this.perform(
      explicitHa ? 'Could not connect to Home Assistant.' : 'Could not connect to the Haus Hub.',
      async () => {
        if (this.state.session && this.state.sessionKind === (explicitHa ? 'home-assistant' : 'haus-hub') && this.state.session.url === address) {
          return;
        }
        let url: string;
        try {
          url = normalizeServerUrl(address, explicitHa ? 'Home Assistant' : 'Haus Hub');
        } catch {
          this.update({
            error: explicitHa
              ? 'Enter the Home Assistant base address. Use HTTPS outside the local network.'
              : 'Enter the Haus Hub base address. Use HTTPS outside the local network.',
          });
          return;
        }
        this.discovery?.cancel();
        if (explicitHa) {
          if (!this.ha) {
            this.update({ error: 'Home Assistant sign-in requires a browser launch handler.' });
            return;
          }
          const session = await this.ha.connect(url);
          if (this.state.sessionKind === 'haus-hub') {
            await this.connection.disconnect().catch(() => undefined);
          }
          this.stopPreferenceSync();
          this.update({ pairingUrl: null, sessionKind: 'home-assistant', preferenceStatus: 'offline' });
          await this.loadHome(session, 'home-assistant');
          return;
        }

        if (code && this.state.pairingUrl !== url) return;
        try {
          const session = await this.connection.connect(url, code);
          if (this.ha && this.state.sessionKind === 'home-assistant') {
            await this.ha.disconnect().catch(() => undefined);
          }
          this.update({ pairingUrl: null, sessionKind: 'haus-hub' });
          await this.loadHome(session, 'haus-hub');
        } catch (error) {
          if (error instanceof Error && error.message === HUB_PAIRING_REQUIRED) {
            this.update({ pairingUrl: url });
            return;
          }
          this.update({ pairingUrl: null });
          if (
            error instanceof HubCredentialSaveError ||
            (error instanceof Error &&
              error.message === 'That pairing code is not correct. Start again.')
          ) {
            this.update({ error: error.message });
            return;
          }
          throw error;
        }
      },
    );
  }

  cancelPairing(): void {
    if (this.state.busy) return;
    this.connection.cancelPairing();
    this.update({ pairingUrl: null, error: null });
  }

  reconnect(): Promise<void> {
    return this.perform('The home server is unavailable.', async () => {
      if (!this.state.session) return;
      if (this.state.sessionKind === 'home-assistant' && this.ha) {
        const haSession = await this.ha.getSession();
        if (haSession && this.ha.connected) await this.loadHome(haSession, 'home-assistant');
        else if (!haSession) this.update({ session: null, snapshot: null, offline: false });
        return;
      }
      if (this.connection.connected) {
        await this.loadHome(this.state.session, 'haus-hub');
      } else {
        const session = await this.connection.reconnect();
        if (session && this.connection.connected) await this.loadHome(session, 'haus-hub');
        else if (!session) this.update({ session: null, snapshot: null, offline: false });
      }
    });
  }

  disconnect(): Promise<void> {
    return this.perform('The saved session could not be removed.', async () => {
      this.stopPreferenceSync();
      this.update({ offline: true, preferenceStatus: 'offline' });
      if (this.state.sessionKind === 'home-assistant' && this.ha) {
        await this.ha.disconnect();
      } else {
        await this.connection.disconnect();
      }
      const theme = this.state.preferences.theme;
      this.update({
        session: null,
        sessionKind: 'haus-hub',
        snapshot: null,
        preferences: { ...defaults, theme },
        offline: false,
      });
    });
  }

  toggleLight(id: string): Promise<void> {
    const command = this.state.snapshot && lightCommand(this.state.snapshot, id);
    return command
      ? this.send(command, 'The command could not be confirmed. Check the light before trying again.')
      : Promise.resolve();
  }

  controlDevice(id: string, intent: DeviceIntent, value?: unknown): Promise<void> {
    const action = this.state.snapshot && availableAction(this.state.snapshot, id, intent, value);
    return action
      ? this.send({ type: 'call_service', ...action }, 'The command could not be confirmed. Check the device before trying again.')
      : Promise.resolve();
  }

  private send(command: Record<string, unknown>, failure: string) {
    return this.perform(failure, async () => {
      if (!this.state.session || this.state.offline || !this.activeConnected) return;
      try {
        await this.requestActive(command);
        if (this.state.sessionKind === 'home-assistant' && this.ha) {
          const snapshot = await readHaSnapshot(this.ha);
          this.update({ snapshot, offline: false });
        } else {
          await this.connection.refresh(false);
          this.publishHome();
        }
      } catch (error) {
        this.update({ offline: true });
        throw error;
      }
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

  setLightGrouping(enabled: boolean): Promise<void> {
    return this.updateSharedPreferences({ autoGroupLights: enabled }, 'Could not update light grouping.');
  }
  savePreferences(patch: Partial<Preferences>): Promise<void> {
    return this.updateSharedPreferences(patch, 'Could not save desktop preferences.');
  }
  resetSeparatedLightGroups(): Promise<void> {
    return this.updateSharedPreferences({ disabledLightGroups: [] }, 'Could not reset separated light groups.');
  }
  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.perform('Could not update favorites.', async () => {
      const { snapshot, preferences, offline, preferenceStatus } = this.state;
      if (!snapshot || offline) return;
      if (this.state.sessionKind === 'haus-hub' && (preferenceStatus !== 'synced' || !this.preferenceSync)) return;
      const next = updateFavorite(snapshot, preferences, id, favorite);
      if (!next) return;
      this.update({ preferences: next });
      await this.preferenceSync?.sync();
    });
  }
  dispose(): void {
    this.generation++;
    this.discovery?.cancel();
    this.stopPreferenceSync();
    this.systemAccess.terminal.closeAll();
    this.connection.dispose();
    this.ha?.dispose();
    this.lifetime.abort();
    this.listeners.clear();
  }

  private async updateSharedPreferences(patch: Partial<Preferences>, failure: string): Promise<void> {
    return this.perform(failure, async () => {
      const { offline, preferenceStatus, sessionKind, preferences } = this.state;
      if (offline || (sessionKind === 'haus-hub' && (preferenceStatus !== 'synced' || !this.preferenceSync))) return;
      this.update({ preferences: { ...preferences, ...patch } });
      await this.preferenceSync?.sync();
    });
  }

  private async loadHome(
    session: NativeSession,
    kind: 'haus-hub' | 'home-assistant',
  ): Promise<void> {
    const connected = kind === 'home-assistant' ? Boolean(this.ha?.connected) : this.connection.connected;
    this.update({ session, sessionKind: kind, offline: !connected });
    if (!connected) return;
    try {
      if (kind === 'home-assistant' && this.ha) {
        const snapshot = await readHaSnapshot(this.ha);
        this.update({ snapshot, offline: false, preferenceStatus: 'synced' });
        return;
      }
      await Promise.all([this.startPreferenceSync().sync(), this.connection.refresh(true)]);
      this.update({ snapshot: this.connection.currentHome() ?? null, offline: false });
    } catch {
      this.update({ offline: true, error: 'The home could not be loaded. Reconnect to the Hub.' });
    }
  }

  private onHubEvent(event: NativeEvent): void {
    if (!this.state.session || this.state.sessionKind !== 'haus-hub') return;
    if (event.type === 'connection' && event.status !== 'connected') this.update({ offline: true });
    if (event.type === 'connection' && event.status === 'connected') this.publishHome();
    if (event.type === 'ha-event') this.publishHome();
  }

  private onHaEvent(event: NativeEvent): void {
    if (!this.state.session || this.state.sessionKind !== 'home-assistant' || !this.ha) return;
    handleHaRuntimeEvent(
      event,
      this.ha,
      () => this.state.snapshot,
      (snapshot) => this.update({ snapshot, offline: false }),
      () => this.update({ offline: true }),
    );
  }

  private publishHome(): void {
    const snapshot = this.connection.currentHome();
    if (!snapshot) return;
    this.update({ snapshot, offline: false });
    if (!this.preferenceSync) void this.startPreferenceSync().sync();
  }

  private startPreferenceSync(): PreferenceSync {
    if (this.preferenceSync) return this.preferenceSync;
    const sync = createGpuiPreferenceSync({
      getPreferences: () => this.state.preferences,
      applyPreferences: (preferences) => this.update({ preferences }),
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
    if ('session' in patch && patch.session?.url !== this.state.session?.url) this.generation++;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
