/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash, randomUUID } from 'node:crypto';
import type { NativeEvent, NativeSession } from '../../shared/native';
import { DesktopHubSessionManager, type HubSessionEvent } from '../hub-session';
import type { SecureStore } from '../secure-store';
import { HomeCache } from '../home-cache';
import { SERVICES, mapPairingNotifications, translateService } from './commands';
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
import { isRecord, isGrant } from './types';
import { HubSnapshot } from './snapshot';
import { HubProviders } from './providers';
import { HubApps } from './apps';
import { HubCommissioningClient } from './commissioning';
import { HubHomeKitPublishing } from './homekit-publishing';
import { resolveHubBrandIcon } from './management/hub-brand-icons';
import { handleHubHueDiagnostics } from './management/hub-hue-diagnostics';
import { HubAppLogStreamManager } from './management/app-logs';
import { loadHubIdentity, postHubJson, probeHubAddress, requestHubApi } from './transport';
import { hubConnLog } from '../logging/logger';

type SnapshotCache = Pick<SecureStore['cameraSnapshots'], 'get' | 'put'>;
type Store = ConstructorParameters<typeof DesktopHubSessionManager>[0]['store'] & {
  cameraSnapshots: SnapshotCache;
  loadHomeCache?: () => Promise<unknown>;
  saveHomeCache?: (value: unknown) => Promise<void>;
};

const STATES_MS = 2000;
const DEVICES_MS = 30000;
const PAIRING_REQUIRED = 'pairing_code_required';

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
  private readonly homeCache: HomeCache;
  private readonly rules: HubRulesBridge;
  private readonly refresher: CoalescedHubRefresh;
  private readonly store: Store;
  private readonly fetchFn: typeof fetch;
  private pending?: { url: string; sessionId: string; homeId: string };
  private readonly snapshot: HubRefreshSnapshotState = createInitialHubRefreshState();
  private hubName = 'Haus Hub';
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private polling = false;

  constructor(
    store: Store,
    private readonly emit: (event: NativeEvent) => void,
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.store = store;
    this.fetchFn = fetchFn;
    this.manager = new DesktopHubSessionManager({ store, fetchFn, emit: (e) => this.onSession(e) });
    this.snapshotClient = new HubSnapshot({
      manager: this.manager,
      cache: this.store.cameraSnapshots,
      fetchFn: this.fetchFn,
      ensureSession: () => this.getSession(),
    });
    const api = (path: string, init?: { method?: string; body?: unknown }) => this.api(path, init);
    this.providerClient = new HubProviders(api);
    this.appClient = new HubApps(api);
    this.appLogs = new HubAppLogStreamManager(this.fetchFn);
    this.commissioningClient = new HubCommissioningClient(api);
    this.homekitClient = new HubHomeKitPublishing(api);
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
    this.homeCache = new HomeCache(
      {
        loadHomeCache: () => store.loadHomeCache?.() ?? Promise.resolve(null),
        saveHomeCache: (v) => store.saveHomeCache?.(v) ?? Promise.resolve(),
      },
      () =>
        this.credentialScope
          ? createHash('sha256').update(this.credentialScope).digest('hex')
          : undefined,
    );
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
    return probeHubAddress(this.fetchFn, url);
  }

  async getSession(): Promise<NativeSession | null> {
    if (!this.manager.bearer()) await this.manager.resume();
    const bearer = this.manager.bearer();
    if (!bearer) return null;
    if (this.manager.status === 'connected') {
      try {
        await this.loadIdentity(bearer.url);
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
    const base = url.replace(/\/+$/, '');
    const identity = await this.loadIdentity(base);
    const response = await this.post(`${base}/api/auth/challenge`, {});
    const sessionId =
      isRecord(response) && typeof response.sessionId === 'string' ? response.sessionId : undefined;
    if (!sessionId) throw new Error('The Hub could not start pairing.');
    const firstOnboarding = isRecord(response) && Boolean(response.firstOnboarding);
    const challengeCode =
      isRecord(response) && typeof response.challengeCode === 'string'
        ? response.challengeCode
        : undefined;
    this.pending = { url: base, sessionId, homeId: identity.homeId };
    return { firstOnboarding, challengeCode };
  }

  /** Completes pairing with the code shown by the Hub, or auto-claims on first bind. */
  async connect(url: string, code?: string): Promise<NativeSession> {
    const base = url.replace(/\/+$/, '');
    let effectiveCode = code ? code.replace(/[\s-]+/g, '').toUpperCase() : undefined;
    if (!effectiveCode) {
      const offer = await this.startPairing(base);
      if (offer.firstOnboarding && offer.challengeCode) {
        effectiveCode = offer.challengeCode.replace(/[\s-]+/g, '').toUpperCase();
      } else {
        throw new Error(PAIRING_REQUIRED);
      }
    }
    const pending = this.pending;
    if (!pending || pending.url !== base) throw new Error('Start pairing again.');
    this.pending = undefined;
    const confirmed = await this.post(`${base}/api/auth/confirm`, {
      sessionId: pending.sessionId,
      challengeCode: effectiveCode,
      expectedHomeId: pending.homeId,
      client: { clientId: `desktop-${randomUUID()}`, clientName: 'Haus Desktop', role: 'admin' },
    });
    const grant = isRecord(confirmed) ? confirmed.grant : undefined;
    if (!isGrant(grant)) throw new Error('The pairing code was not accepted.');
    await this.manager.onboard(base, grant);
    this.start();
    return { url: base, name: this.hubName, kind: 'haus-hub' };
  }

  async disconnect(): Promise<void> {
    this.stop();
    this.homeCache.reset();
    await this.manager.logout();
    this.emit({ type: 'connection', status: 'disconnected' });
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
    return resolveHubBrandIcon(this, (path) => this.api(path), kind, id, dark, hint);
  }

  private async handle(message: Record<string, unknown>): Promise<unknown> {
    const rpc = await handleHubIntegrationRpc(
      {
        api: (path, init) => this.api(path, init),
        devices: this.snapshot.devices,
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
      case 'call_service':
        if (
          message.domain === 'persistent_notification' &&
          message.service === 'dismiss' &&
          isRecord(message.service_data) &&
          typeof message.service_data.notification_id === 'string'
        ) {
          const match = /^pairing-(.+)$/.exec(message.service_data.notification_id);
          if (match) {
            await this.api('/api/auth/pairing-requests/dismiss', {
              method: 'POST',
              body: { sessionId: match[1] },
            }).catch(() => undefined);
            return { context: { id: randomUUID() } };
          }
        }
        return this.callService(message);
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

  private post(url: string, body: unknown): Promise<unknown> {
    return postHubJson(this.fetchFn, url, body);
  }

  private api(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    return requestHubApi(this.fetchFn, this.manager, path, init);
  }

  private async loadIdentity(base: string): Promise<{ homeId: string }> {
    const result = await loadHubIdentity(this.fetchFn, base);
    if (result.hubName) this.hubName = result.hubName;
    return { homeId: result.homeId };
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
    clearInterval(this.timer);
    this.timer = undefined;
    this.appLogs.dispose();
    Object.assign(this.snapshot, { devices: [], rooms: [], latestStates: {}, devicesAt: 0 });
    this.snapshot.knownEndpointIds.clear();
    this.refresher.reset();
    this.rules.reset();
    this.failures = 0;
  }

  private async tick(): Promise<void> {
    if (this.polling || !this.manager.bearer()) return;
    this.polling = true;
    try {
      if (this.manager.status === 'disconnected') {
        if (!(await this.manager.reconnect())) return;
        const bearer = this.manager.bearer();
        if (bearer) await this.loadIdentity(bearer.url);
      }
      if (this.manager.status !== 'connected') return;
      await this.refresh(false);
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

export const HUB_PAIRING_REQUIRED = PAIRING_REQUIRED;
