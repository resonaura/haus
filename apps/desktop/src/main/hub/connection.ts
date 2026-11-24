/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { NativeEvent, NativeSession } from '../../shared/native';
import { DesktopHubSessionManager, type HubSessionEvent } from '../hub-session';
import type { SecureStore } from '../secure-store';
import type { HomeCache } from '../home-cache';
import {
  SERVICES,
  mapPairingNotifications,
  pairingDismissSessionId,
  translateService,
} from './commands';
import { HubIntegrationFlowManager } from './flows';
import { handleHubIntegrationRpc, handleHubMqttExports } from './management/hub-requests';
import { handleHubRegistryRpc } from './management/hub-registry';
import { HubRulesBridge } from './management/hub-automations';
import {
  applyHubRefreshPayloads,
  applyHubStateDelta,
  CoalescedHubRefresh,
  createInitialHubRefreshState,
  dispatchHubCommandsParallel,
  shouldRefreshAfterCommands,
  type HubRefreshSnapshotState,
} from './management/hub-live-state';
import { isRecord } from './types';
import { decodeHaSnapshot } from '@haus/ha/snapshot';
import { HubPairingClient } from './pairing/client';
import { HubSnapshot } from './snapshot';
import { HubProviders } from './providers';
import { HubApps } from './apps';
import { HubCommissioningClient } from './commissioning';
import { HubHomeKitPublishing } from './homekit-publishing';
import { HubBrandIconsClient } from './management/hub-brand-icons';
import { handleHubHueDiagnostics } from './management/hub-hue-diagnostics';
import { HubAppLogStreamManager } from './management/app-logs';
import * as transport from './transport';
import { hubConnLog } from '../logging/logger';

type SnapshotCache = Pick<SecureStore['cameraSnapshots'], 'get' | 'put'>;
type Store = ConstructorParameters<typeof DesktopHubSessionManager>[0]['store'] & {
  cameraSnapshots?: SnapshotCache;
  loadHomeCache?: () => Promise<unknown>;
  saveHomeCache?: (value: unknown) => Promise<void>;
};

const STATES_MS = 2000;
const DEVICES_MS = 30000;

/** A Haus Hub session that presents Hub devices through the HA-shaped view the renderer consumes. */
export class HubConnection {
  private readonly manager: DesktopHubSessionManager;
  private readonly flows: HubIntegrationFlowManager;
  private readonly snapshotClient: HubSnapshot;
  private readonly providerClient: HubProviders;
  private readonly appClient: HubApps;
  private readonly appLogs: HubAppLogStreamManager;
  private readonly commissioningClient: HubCommissioningClient;
  private readonly homekitClient: HubHomeKitPublishing;
  private readonly brandIcons: HubBrandIconsClient;
  private readonly homeCache: HomeCache;
  private readonly rules: HubRulesBridge;
  private readonly refresher: CoalescedHubRefresh;
  private readonly fetchFn: typeof fetch;
  private readonly pairing: HubPairingClient;
  private readonly snapshot: HubRefreshSnapshotState = createInitialHubRefreshState();
  private hubName = 'Haus Hub';
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private polling = false;
  private generation = 0;

  constructor(
    store: Store,
    private readonly emit: (event: NativeEvent) => void,
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.fetchFn = fetchFn;
    this.manager = new DesktopHubSessionManager({ store, fetchFn, emit: (e) => this.onSession(e) });
    this.pairing = new HubPairingClient(this.manager, fetchFn);
    this.snapshotClient = new HubSnapshot({
      manager: this.manager,
      cache: store.cameraSnapshots,
      fetchFn: this.fetchFn,
      ensureSession: () => this.getSession(),
    });
    const api = (path: string, init?: { method?: string; body?: unknown }) => this.api(path, init);
    this.providerClient = new HubProviders(api);
    this.appClient = new HubApps(api);
    this.appLogs = new HubAppLogStreamManager(this.fetchFn);
    this.commissioningClient = new HubCommissioningClient(api);
    this.homekitClient = new HubHomeKitPublishing(api);
    this.brandIcons = new HubBrandIconsClient(api, emit);
    this.rules = new HubRulesBridge({
      api,
      refresh: () => this.refresh(true),
      getView: () => this.snapshot.view,
    });
    this.refresher = new CoalescedHubRefresh((force) => this.performRefresh(force));
    this.flows = new HubIntegrationFlowManager(
      api,
      () => this.refresh(true),
      undefined,
      () => this.snapshot.cachedEntries,
    );
    this.homeCache = transport.createHubHomeCache(store, () => this.credentialScope);
  }

  get connected(): boolean {
    return this.manager.status === 'connected';
  }
  get isHub(): boolean {
    return true;
  }
  get serverUrl(): string | undefined {
    return this.manager.bearer()?.url;
  }
  get credentialScope(): string | undefined {
    return this.serverUrl;
  }
  getBearerToken(): string | undefined {
    return this.manager.bearer()?.token;
  }

  /** True when the address answers like a Haus Hub (and not Home Assistant). */
  async probe(url: string): Promise<boolean> {
    return transport.probeHubAddress(this.fetchFn, url);
  }

  async getSession(): Promise<NativeSession | null> {
    if (!this.manager.bearer()) await this.manager.resume();
    const bearer = this.manager.bearer();
    if (!bearer) return null;
    if (this.manager.status === 'connected') {
      try {
        await this.loadIdentity(bearer.url);
        this.brandIcons.probeVersion();
      } catch (error) {
        if (error instanceof Error && error.message === 'That address is not a Haus Hub.')
          throw error;
        this.failures = 3;
        this.emit({ type: 'connection', status: 'reconnecting' });
      }
    } else if (this.manager.status === 'disconnected') {
      this.emit({ type: 'connection', status: 'reconnecting' });
    }
    this.start();
    return { url: bearer.url, name: this.hubName, kind: 'haus-hub' };
  }

  /** Asks the Hub to start pairing. Returns firstOnboarding info if available. */
  async startPairing(url: string): Promise<{ firstOnboarding?: boolean; challengeCode?: string }> {
    const offer = await this.pairing.begin(url);
    if (offer.name) this.hubName = offer.name;
    return offer;
  }

  async connect(url: string, code?: string): Promise<NativeSession> {
    const name = await this.pairing.connect(url, code);
    if (name) this.hubName = name;
    this.brandIcons.clear();
    this.brandIcons.probeVersion();
    this.start();
    return { url: url.replace(/\/+$/, ''), name: this.hubName, kind: 'haus-hub' };
  }

  cancelPairing(): void {
    this.pairing.cancel();
  }

  async disconnect(): Promise<void> {
    this.stop();
    this.homeCache.reset();
    this.brandIcons.clear();
    await this.manager.logout();
    this.emit({ type: 'connection', status: 'disconnected' });
  }

  async reconnect(): Promise<NativeSession | null> {
    if (this.manager.bearer()) await this.manager.reconnect();
    return this.getSession();
  }

  dispose(): void {
    this.stop();
  }
  async request<T = unknown>(message: Record<string, unknown>): Promise<T> {
    return (await this.handle(message)) as T;
  }
  async subscribe(message?: Record<string, unknown>): Promise<string> {
    if (message?.type === 'apps/logs')
      return this.appLogs.subscribe(message, this.manager.bearer(), this.emit);
    return randomUUID();
  }
  async unsubscribe(id?: string): Promise<void> {
    this.appLogs.unsubscribe(id);
  }
  currentHome() {
    if (!this.connected || !this.snapshot.devicesAt) return undefined;
    return decodeHaSnapshot({
      ...this.snapshot.view,
      config: { location_name: this.hubName },
      user: { name: 'Haus Desktop', is_admin: this.manager.getSession()?.clientRole === 'admin' },
      services: SERVICES,
    });
  }

  readPreferences(): Promise<unknown> {
    return this.api('/api/preferences');
  }

  writePreferences(baseRevision: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.api('/api/preferences', { method: 'PATCH', body: { baseRevision, patch } });
  }

  cachedHome() {
    return this.homeCache.load();
  }
  cameraLastSnapshot(entityId: unknown) {
    return this.snapshotClient.last(entityId);
  }
  cameraSnapshot(entityId: unknown) {
    return this.snapshotClient.capture(entityId);
  }
  async getSceneConfig(entityId?: unknown, sceneId?: unknown) {
    return this.rules.getSceneConfig(entityId, sceneId);
  }
  async management(input: unknown): Promise<unknown> {
    if (isRecord(input) && typeof input.path === 'string') {
      if (input.path === 'auth/pairing-requests') return this.api('/api/auth/pairing-requests');
      if (input.path === 'auth/pairing-requests/dismiss')
        return this.api('/api/auth/pairing-requests/dismiss', { method: 'POST', body: input.data });
      if (/^apps(?:\/|$)/.test(input.path)) return this.appClient.request(input);
      if (/^homekit(?:\/|$)/.test(input.path)) return this.homekitClient.request(input);
      const hueDiagnostics = await handleHubHueDiagnostics(input.method, input.path, (path) =>
        this.api(path),
      );
      if (hueDiagnostics.handled) return hueDiagnostics.result;
      const mqttExports = await handleHubMqttExports(input.method, input.path, input.data, (p, i) =>
        this.api(p, i),
      );
      if (mqttExports.handled) return mqttExports.result;
      if (/^commissioning(?:\/|$)/.test(input.path)) return this.commissioningClient.request(input);
      const ruleMgmt = await this.rules.management(input);
      if (ruleMgmt.handled) return ruleMgmt.result;
    }
    return this.flows.handleManagement(input);
  }
  nativeProviders(input: unknown): Promise<unknown> {
    return this.providerClient.request(input);
  }
  async addonSurface(): Promise<{ url: string; token?: string; cookie?: string; title: string }> {
    const bearer = this.manager.bearer();
    if (!bearer) throw new Error('Connect to your Haus Hub first.');
    return { url: `${bearer.url.replace(/\/+$/, '')}/`, token: bearer.token, title: this.hubName };
  }
  brandIcon(kind: unknown, id: unknown, dark = false, hint?: unknown): Promise<string | null> {
    return this.brandIcons.resolve(kind, id, dark, hint);
  }
  brandIconTile = (kind: unknown, id: unknown, style: unknown, hint?: unknown) =>
    this.brandIcons.resolveTile(kind, id, style, hint);

  private async handle(message: Record<string, unknown>): Promise<unknown> {
    const rpc = await handleHubIntegrationRpc(
      {
        api: (path, init) => this.api(path, init),
        devices: this.snapshot.devices,
        bindings: this.snapshot.view.bindings,
        flows: this.flows,
        refreshDevices: () => this.refresh(true),
        setCachedEntries: (entries) => {
          this.snapshot.cachedEntries = [...entries];
        },
      },
      message,
    );
    if (rpc.handled) return rpc.result;

    const registry = await handleHubRegistryRpc(message, {
      api: (path, init) => this.api(path, init),
      refresh: () => this.refresh(true),
      ensureLoaded: () => this.refresher.ensureLoaded(() => this.snapshot.devicesAt > 0),
      getView: () => this.snapshot.view,
      getDevices: () => this.snapshot.devices,
      recordCache: (type, value) => this.homeCache.record(type, value),
      emitRegistryUpdated: (eventType) =>
        this.emit({ type: 'ha-event', event: { event_type: eventType, data: {} } }),
    });
    if (registry.handled) return registry.result;

    const ruleRpc = this.rules.rpc(message);
    if (ruleRpc.handled) return ruleRpc.result;

    switch (message.type) {
      case 'get_states':
        await this.refresh(true);
        this.homeCache.record('get_states', this.snapshot.view.states);
        return this.snapshot.view.states;
      case 'get_services':
        this.homeCache.record('get_services', SERVICES);
        return SERVICES;
      case 'get_config': {
        const config = {
          location_name: this.hubName,
          version: 'haus-hub',
          unit_system: { temperature: '°C' },
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        this.homeCache.record('get_config', config);
        return config;
      }
      case 'auth/current_user': {
        const isAdmin = this.manager.getSession()?.clientRole === 'admin';
        const user = {
          id: 'haus-desktop',
          name: 'Haus Desktop',
          is_owner: isAdmin,
          is_admin: isAdmin,
        };
        this.homeCache.record('auth/current_user', user);
        return user;
      }
      case 'persistent_notification/get':
        return mapPairingNotifications(
          await this.api('/api/auth/pairing-requests').catch(() => null),
        );
      case 'manifest/list':
        return await this.flows.getManifests();
      case 'config_entries/flow/progress':
        return this.flows.listFlowProgress();
      case 'config_entries/ignore_flow':
        return this.flows.ignoreFlow(String(message.flow_id ?? ''));
      case 'haus/discovery/scan':
        return this.flows.scanDiscovery();
      case 'call_service': {
        const dismissSessionId = pairingDismissSessionId(message);
        if (dismissSessionId) {
          await this.api('/api/auth/pairing-requests/dismiss', {
            method: 'POST',
            body: { sessionId: dismissSessionId },
          }).catch(() => undefined);
          return { context: { id: randomUUID() } };
        }
        return this.callService(message);
      }
      default:
        throw new Error('This command is not available on a Haus Hub yet.');
    }
  }

  private async callService(message: Record<string, unknown>): Promise<unknown> {
    if (await this.rules.callService(message)) return { context: { id: randomUUID() } };
    const commands = translateService(this.snapshot.view.bindings, message, (id) =>
      this.snapshot.view.states.some((state) => state.entity_id === id && state.state === 'on'),
    );
    const receiptStates = await dispatchHubCommandsParallel(commands, (deviceId, body) =>
      this.api(`/api/devices/${encodeURIComponent(deviceId)}/command`, { method: 'POST', body }),
    );
    if (shouldRefreshAfterCommands(this.applyStateDeltaInternal(receiptStates), commands))
      void this.refresh(false).catch(() => undefined);
    return { context: { id: randomUUID() } };
  }

  /** Applies live pushed endpoint state deltas immediately without HTTP round-trips. */
  applyLiveStateChanges(changes: Record<string, Record<string, unknown>>): void {
    const applied = this.applyStateDeltaInternal(changes);
    if (applied === 'refresh') void this.refresh(true).catch(() => undefined);
  }

  private applyStateDeltaInternal(
    changes: Record<string, Record<string, unknown>>,
  ): number | 'refresh' {
    const result = applyHubStateDelta({
      devices: this.snapshot.devices,
      rooms: this.snapshot.rooms,
      cachedEntries: this.snapshot.cachedEntries,
      knownEndpointIds: this.snapshot.knownEndpointIds,
      latestStates: this.snapshot.latestStates,
      changes,
      beforeView: this.snapshot.view,
      rules: this.rules,
      homeCache: this.homeCache,
      emit: this.emit,
    });
    if (result.needsRefresh) return 'refresh';
    this.snapshot.latestStates = result.states;
    this.snapshot.view = result.view;
    return result.emitted;
  }

  private api(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    return transport.requestHubApi(this.fetchFn, this.manager, path, init);
  }

  private async loadIdentity(base: string): Promise<void> {
    const result = await transport.loadHubIdentity(this.fetchFn, base);
    const session = this.manager.getSession();
    if (session && (session.hubId !== result.hubId || session.homeId !== result.homeId)) {
      throw new Error('That address is not a Haus Hub.');
    }
    if (result.hubName) this.hubName = result.hubName;
  }

  private onSession(event: HubSessionEvent): void {
    if (event.status === 'connected') this.emit({ type: 'connection', status: 'connected' });
    else if (event.status === 'connecting') this.emit({ type: 'connection', status: 'connecting' });
    else if (event.status === 'disconnected' && event.error === 'hub_unreachable')
      this.emit({ type: 'connection', status: 'reconnecting' });
    else if (event.error)
      this.emit({ type: 'connection', status: 'disconnected', error: event.error });
  }

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), STATES_MS);
    this.timer.unref();
  }

  private stop(): void {
    this.generation++;
    this.pairing.cancel();
    clearInterval(this.timer);
    this.timer = undefined;
    this.appLogs.dispose();
    Object.assign(this.snapshot, createInitialHubRefreshState());
    this.refresher.reset();
    this.rules.reset();
    this.failures = 0;
  }

  private async tick(): Promise<void> {
    if (this.polling || !this.manager.bearer()) return;
    this.polling = true;
    try {
      const recovered = this.manager.status === 'disconnected' || this.failures > 0;
      if (this.manager.status === 'disconnected') {
        if (!(await this.manager.reconnect())) return;
        const bearer = this.manager.bearer();
        if (bearer) await this.loadIdentity(bearer.url);
      }
      if (this.manager.status !== 'connected') return;
      await this.refresh(false);
      if (recovered) this.brandIcons.probeVersion();
      if (this.failures >= 3) {
        hubConnLog.info(`Reconnected to ${this.hubName}`);
        this.emit({ type: 'connection', status: 'connected' });
      }
      this.failures = 0;
    } catch (err) {
      if (++this.failures === 3) {
        hubConnLog.warnThrottled(
          'hub-reconnecting',
          `Lost connection to ${this.hubName}`,
          15_000,
          err,
        );
        this.emit({ type: 'connection', status: 'reconnecting' });
      }
    } finally {
      this.polling = false;
    }
  }

  /** Re-reads states (and, periodically or on demand, devices) and publishes changes. */
  refresh(force: boolean): Promise<void> {
    return this.refresher.run(force);
  }

  private async performRefresh(force: boolean): Promise<void> {
    const generation = this.generation;
    const stale =
      force || Date.now() - this.snapshot.devicesAt > DEVICES_MS || !this.snapshot.devices.length;
    const [devicesBody, roomsBody, statesBody, integrationsBody, nextRules] = await Promise.all([
      stale ? this.api('/api/devices') : Promise.resolve(undefined),
      stale ? this.api('/api/rooms').catch(() => undefined) : Promise.resolve(undefined),
      this.api('/api/states'),
      stale
        ? this.api('/api/commissioning/integrations').catch(() => undefined)
        : Promise.resolve(undefined),
      this.rules.fetchIfStale(stale),
    ]);
    if (generation !== this.generation) return;
    applyHubRefreshPayloads({
      state: this.snapshot,
      devicesBody,
      roomsBody,
      statesBody,
      integrationsBody,
      nextRules,
      rules: this.rules,
      homeCache: this.homeCache,
      emit: this.emit,
    });
  }
}

export { HUB_PAIRING_REQUIRED } from './pairing/client';
