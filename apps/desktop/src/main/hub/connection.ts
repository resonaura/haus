/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash, randomUUID } from 'node:crypto';
import type { NativeEvent, NativeSession } from '../../shared/native';
import { DesktopHubSessionManager, type HubSessionEvent } from '../hub-session';
import type { SecureStore } from '../secure-store';
import { HomeCache } from '../home-cache';
import { SERVICES, mapPairingNotifications, translateService } from './commands';
import { buildView } from './entities';
import { HubIntegrationFlowManager } from './flows';
import { handleHubIntegrationRpc } from './management/hub-requests';
import { diffCompatStates, handleHubRegistryRpc } from './management/hub-registry';
import { HubRulesBridge } from './management/hub-automations';
import {
  parseDevices,
  parseRooms,
  parseStates,
  isRecord,
  isGrant,
  type CompatView,
  type HubDevice,
  type HubRoom,
} from './types';
import { HubSnapshot } from './snapshot';
import { HubProviders } from './providers';
import { HubApps } from './apps';
import { HubCommissioningClient } from './commissioning';
import { HubHomeKitPublishing } from './homekit-publishing';
import { resolveHubBrandIcon } from './management/hub-brand-icons';
import { loadHubIdentity, postHubJson, requestHubApi } from './transport';

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
  private readonly commissioningClient: HubCommissioningClient;
  private readonly homekitClient: HubHomeKitPublishing;
  private readonly homeCache: HomeCache;
  private readonly rules: HubRulesBridge;
  private readonly store: Store;
  private readonly fetchFn: typeof fetch;
  private pending?: { url: string; sessionId: string; homeId: string };
  private devices: HubDevice[] = [];
  private rooms: HubRoom[] = [];
  private cachedEntries: Array<{ entry_id?: unknown; domain?: unknown }> = [];
  private view: CompatView = {
    states: [],
    devices: [],
    entities: [],
    areas: [],
    bindings: new Map(),
  };
  private hubName = 'Haus Hub';
  private timer?: NodeJS.Timeout;
  private devicesAt = 0;
  private failures = 0;
  private polling = false;

  constructor(
    store: Store,
    private readonly emit: (event: NativeEvent) => void,
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.store = store;
    this.fetchFn = fetchFn;
    this.manager = new DesktopHubSessionManager({
      store,
      fetchFn,
      emit: (event) => this.onSession(event),
    });
    this.snapshotClient = new HubSnapshot({
      manager: this.manager,
      cache: this.store.cameraSnapshots,
      fetchFn: this.fetchFn,
      ensureSession: () => this.getSession(),
    });
    this.providerClient = new HubProviders((path, init) => this.api(path, init));
    this.appClient = new HubApps((path, init) => this.api(path, init));
    this.commissioningClient = new HubCommissioningClient((path, init) => this.api(path, init));
    this.homekitClient = new HubHomeKitPublishing((path, init) => this.api(path, init));
    this.rules = new HubRulesBridge({
      api: (path, init) => this.api(path, init),
      refresh: () => this.refresh(true),
      getView: () => this.view,
    });
    this.flows = new HubIntegrationFlowManager(
      (path, init) => this.api(path, init),
      () => this.refresh(true),
      undefined,
      () => this.cachedEntries,
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
    try {
      const response = await this.fetchFn(`${url.replace(/\/+$/, '')}/api/auth/identity`, {
        signal: AbortSignal.timeout(10000),
      });
      const body: unknown = await response.json();
      return (
        response.ok && isRecord(body) && isRecord(body.hub) && typeof body.hub.hubId === 'string'
      );
    } catch {
      return false;
    }
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
    this.devices = [];
    this.rooms = [];
    this.rules.reset();
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
  async subscribe(): Promise<string> {
    return randomUUID();
  }
  async unsubscribe(): Promise<void> {}
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
        devices: this.devices,
        flows: this.flows,
        refreshDevices: () => this.refresh(true),
        setCachedEntries: (entries) => {
          this.cachedEntries = [...entries];
        },
      },
      message,
    );
    if (rpc.handled) return rpc.result;

    const registry = await handleHubRegistryRpc(message, {
      api: (path, init) => this.api(path, init),
      refresh: () => this.refresh(true),
      getView: () => this.view,
      getDevices: () => this.devices,
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
        this.homeCache.record('get_states', this.view.states);
        return this.view.states;
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
    if (await this.rules.callService(message)) {
      return { context: { id: randomUUID() } };
    }
    const commands = translateService(this.view.bindings, message, (id) =>
      this.view.states.some((state) => state.entity_id === id && state.state === 'on'),
    );
    for (const { deviceId, ...body } of commands)
      await this.api(`/api/devices/${encodeURIComponent(deviceId)}/command`, {
        method: 'POST',
        body,
      });
    void this.refresh(false).catch(() => undefined);
    return { context: { id: randomUUID() } };
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
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.devices = [];
    this.rooms = [];
    this.rules.reset();
    this.devicesAt = 0;
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
      if (this.failures >= 3) this.emit({ type: 'connection', status: 'connected' });
      this.failures = 0;
    } catch {
      this.failures += 1;
      if (this.failures === 3) this.emit({ type: 'connection', status: 'reconnecting' });
    } finally {
      this.polling = false;
    }
  }

  /** Re-reads states (and, periodically or on demand, devices) and publishes changes. */
  async refresh(force: boolean): Promise<void> {
    const stale = force || Date.now() - this.devicesAt > DEVICES_MS || !this.devices.length;
    const [devicesBody, roomsBody, statesBody, integrationsBody, nextRules] = await Promise.all([
      stale ? this.api('/api/devices') : Promise.resolve(undefined),
      stale ? this.api('/api/rooms').catch(() => undefined) : Promise.resolve(undefined),
      this.api('/api/states'),
      stale
        ? this.api('/api/commissioning/integrations').catch(() => undefined)
        : Promise.resolve(undefined),
      this.rules.fetchIfStale(stale),
    ]);
    const before = this.view;
    const hadLoaded = this.devicesAt > 0;
    let registryChanged = false;
    if (integrationsBody && isRecord(integrationsBody) && Array.isArray(integrationsBody.entries)) {
      this.cachedEntries = integrationsBody.entries as Array<{
        entry_id?: unknown;
        domain?: unknown;
      }>;
    }
    if (devicesBody !== undefined) {
      const devices = parseDevices(devicesBody);
      registryChanged = hadLoaded && JSON.stringify(devices) !== JSON.stringify(this.devices);
      this.devices = devices;
      this.devicesAt = Date.now();
    }
    if (roomsBody !== undefined) {
      const rooms = parseRooms(roomsBody);
      if (hadLoaded && JSON.stringify(rooms) !== JSON.stringify(this.rooms)) {
        registryChanged = true;
      }
      this.rooms = rooms;
    }
    const deviceView = buildView(
      this.devices,
      parseStates(statesBody),
      undefined,
      this.cachedEntries,
      this.rooms,
    );
    this.view = this.rules.applyView(deviceView, nextRules);
    this.homeCache.record('get_states', this.view.states);
    if (registryChanged) {
      this.homeCache.record('config/area_registry/list', this.view.areas);
      this.homeCache.record('config/device_registry/list', this.view.devices);
      this.homeCache.record('config/entity_registry/list', this.view.entities);
      this.emit({
        type: 'ha-event',
        event: { event_type: 'device_registry_updated', data: {} },
      });
      return;
    }
    for (const change of diffCompatStates(before.states, this.view.states)) {
      this.homeCache.state(change);
      this.emit({ type: 'ha-event', event: { event_type: 'state_changed', data: change } });
    }
  }
}

export const HUB_PAIRING_REQUIRED = PAIRING_REQUIRED;
