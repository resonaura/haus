/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { PairingGrant } from '@haus/core/pairing';
import type { NativeEvent, NativeSession } from '../../shared/native';
import { DesktopHubSessionManager, type HubSessionEvent } from '../hub-session';
import type { SecureStore } from '../secure-store';
import { translateService } from './commands';
import { buildView } from './entities';
import { HubIntegrationFlowManager, buildHubConfigEntries, buildHubManifests } from './flows';
import { parseDevices, parseStates, type CompatView, type HubDevice } from './types';
import { HubSnapshot } from './snapshot';
import { HubProviders } from './providers';
import { HubApps } from './apps';

type SnapshotCache = Pick<SecureStore['cameraSnapshots'], 'get' | 'put'>;
type Store = ConstructorParameters<typeof DesktopHubSessionManager>[0]['store'] & {
  cameraSnapshots: SnapshotCache;
};

const STATES_MS = 2000;
const DEVICES_MS = 30000;
const PAIRING_REQUIRED = 'pairing_code_required';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isGrant(value: unknown): value is PairingGrant {
  return (
    isRecord(value) &&
    ['grantId', 'hubId', 'homeId', 'clientId', 'clientRole', 'clientName'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    typeof value.issuedAt === 'number' &&
    typeof value.revoked === 'boolean'
  );
}

const SERVICES = {
  light: { turn_on: {}, turn_off: {}, toggle: {} },
  switch: { turn_on: {}, turn_off: {}, toggle: {} },
  button: { press: {} },
  climate: { set_temperature: {}, set_hvac_mode: {}, turn_on: {}, turn_off: {} },
  water_heater: { set_temperature: {}, set_operation_mode: {}, turn_on: {}, turn_off: {} },
  cover: { open_cover: {}, close_cover: {}, stop_cover: {}, set_cover_position: {} },
  lock: { lock: {}, unlock: {} },
  fan: { turn_on: {}, turn_off: {}, set_percentage: {} },
  number: { set_value: {} },
  select: { select_option: {} },
};

/** A Haus Hub session that presents Hub devices through the HA-shaped view the renderer consumes. */
export class HubConnection {
  private readonly manager: DesktopHubSessionManager;
  private readonly flows: HubIntegrationFlowManager;
  private readonly snapshotClient: HubSnapshot;
  private readonly providerClient: HubProviders;
  private readonly appClient: HubApps;
  private readonly store: Store;
  private readonly fetchFn: typeof fetch;
  private pending?: { url: string; sessionId: string; homeId: string };
  private devices: HubDevice[] = [];
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
    this.flows = new HubIntegrationFlowManager(
      (path, init) => this.api(path, init),
      () => this.refresh(true),
    );
  }

  get connected(): boolean {
    return this.manager.status === 'connected';
  }
  get serverUrl(): string | undefined {
    return this.manager.bearer()?.url;
  }
  get credentialScope(): string | undefined {
    return this.serverUrl;
  }

  /** True when the address answers like a Haus Hub (and not Home Assistant). */
  async probe(url: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${url.replace(/\/+$/, '')}/api/auth/identity`, {
        signal: AbortSignal.timeout(4000),
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
        if (!(error instanceof TypeError)) throw error;
        this.emit({ type: 'connection', status: 'reconnecting' });
      }
    } else if (this.manager.status === 'disconnected') {
      this.emit({ type: 'connection', status: 'reconnecting' });
    }
    this.start();
    return { url: bearer.url, name: this.hubName, kind: 'haus-hub' };
  }

  /** Asks the Hub to start pairing; it prints a one-time code that the user types in. */
  async startPairing(url: string): Promise<void> {
    const base = url.replace(/\/+$/, '');
    const identity = await this.loadIdentity(base);
    const response = await this.post(`${base}/api/auth/challenge`, {});
    const sessionId = isRecord(response) ? response.sessionId : undefined;
    if (typeof sessionId !== 'string') throw new Error('The Hub could not start pairing.');
    this.pending = { url: base, sessionId, homeId: identity.homeId };
  }

  /** Completes pairing with the code shown by the Hub. */
  async connect(url: string, code?: string): Promise<NativeSession> {
    const base = url.replace(/\/+$/, '');
    if (!code?.trim()) {
      await this.startPairing(base);
      throw new Error(PAIRING_REQUIRED);
    }
    const pending = this.pending;
    if (!pending || pending.url !== base) throw new Error('Start pairing again.');
    this.pending = undefined;
    const confirmed = await this.post(`${base}/api/auth/confirm`, {
      sessionId: pending.sessionId,
      challengeCode: code.trim(),
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
    await this.manager.logout();
    this.emit({ type: 'connection', status: 'disconnected' });
  }

  dispose(): void {
    this.stop();
  }

  async request<T = unknown>(message: Record<string, unknown>): Promise<T> {
    const result = await this.handle(message);
    return result as T;
  }

  async subscribe(): Promise<string> {
    return randomUUID();
  }
  async unsubscribe(): Promise<void> {}
  async cachedHome(): Promise<null> {
    return null;
  }
  cameraLastSnapshot(entityId: unknown) {
    return this.snapshotClient.last(entityId);
  }
  cameraSnapshot(entityId: unknown) {
    return this.snapshotClient.capture(entityId);
  }
  async getSceneConfig(): Promise<null> {
    return null;
  }
  async management(input: unknown): Promise<unknown> {
    if (isRecord(input) && typeof input.path === 'string' && /^apps(?:\/|$)/.test(input.path))
      return this.appClient.request(input);
    return this.flows.handleManagement(input);
  }
  nativeProviders(input: unknown): Promise<unknown> {
    return this.providerClient.request(input);
  }
  async addonSurface(): Promise<never> {
    throw new Error('Home Assistant add-ons are not available on a Haus Hub.');
  }
  async brandIcon(): Promise<null> {
    return null;
  }

  private async handle(message: Record<string, unknown>): Promise<unknown> {
    switch (message.type) {
      case 'get_states':
        await this.refresh(true);
        return this.view.states;
      case 'get_services':
        return SERVICES;
      case 'get_config':
        return {
          location_name: this.hubName,
          version: 'haus-hub',
          unit_system: { temperature: '°C' },
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      case 'auth/current_user':
        return {
          id: 'haus-desktop',
          name: 'Haus Desktop',
          is_owner: this.manager.getSession()?.clientRole === 'admin',
          is_admin: this.manager.getSession()?.clientRole === 'admin',
        };
      case 'config/area_registry/list':
        return this.view.areas;
      case 'config/device_registry/list':
        return this.view.devices;
      case 'config/entity_registry/list':
        return this.view.entities;
      case 'persistent_notification/get':
        return [];
      case 'config_entries/get':
        await this.flows.fetchDiscovery();
        return buildHubConfigEntries(this.devices, this.flows.getCachedPairings());
      case 'manifest/list':
        return buildHubManifests();
      case 'config_entries/flow/progress':
        return this.flows.listFlowProgress();
      case 'repairs/list_issues':
        return { issues: [] };
      case 'frontend/get_translations':
        return { resources: {} };
      case 'call_service':
        return this.callService(message);
      default:
        throw new Error('This command is not available on a Haus Hub yet.');
    }
  }

  private async callService(message: Record<string, unknown>): Promise<unknown> {
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

  private async post(url: string, body: unknown): Promise<unknown> {
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = isRecord(data) && typeof data.error === 'string' ? data.error : '';
      throw new Error(
        code === 'invalid_pairing_code'
          ? 'That pairing code is not correct. Start again.'
          : `The Hub refused the request (${code || response.status}).`,
      );
    }
    return data;
  }

  private async api(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bearer = this.manager.bearer();
      if (!bearer) throw new Error('Connect to your Haus Hub first.');
      const url = `${bearer.url}${path}`;
      const request: RequestInit = {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${bearer.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(10000),
      };
      const response =
        request.method === 'GET' ? await this.read(url, request) : await this.fetchFn(url, request);
      if (response.status === 401 && attempt === 0 && (await this.manager.reconnect())) continue;
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const code = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
        const safeCode = code && /^[a-z0-9_]{1,96}$/.test(code) ? `: ${code}` : '';
        throw new Error(`The Hub request failed (${response.status}${safeCode}).`);
      }
      return response.json().catch(() => ({}));
    }
    throw new Error('Your Hub session expired. Connect again.');
  }

  private async loadIdentity(base: string): Promise<{ homeId: string }> {
    const response = await this.read(`${base}/api/auth/identity`, {
      signal: AbortSignal.timeout(6000),
    });
    const body: unknown = await response.json().catch(() => ({}));
    const hub = isRecord(body) && isRecord(body.hub) ? body.hub : undefined;
    if (!response.ok || !hub || typeof hub.homeId !== 'string')
      throw new Error('That address is not a Haus Hub.');
    if (typeof hub.name === 'string' && hub.name) this.hubName = hub.name;
    return { homeId: hub.homeId };
  }

  /** Retry a read once when an idle keep-alive socket has been closed by the Hub. */
  private async read(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      try {
        return await this.fetchFn(url, init);
      } catch (retryError) {
        if (!(retryError instanceof TypeError)) throw retryError;
        const path = new URL(url).pathname;
        const cause = isRecord(retryError.cause) ? retryError.cause : undefined;
        const code =
          cause && typeof cause.code === 'string' && /^E[A-Z0-9_]{2,40}$/.test(cause.code)
            ? ` (${cause.code})`
            : '';
        const host = new URL(url).host;
        throw new Error(`Could not reach the Haus Hub at ${host} for ${path}${code}.`);
      }
    }
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
    const [devicesBody, statesBody] = await Promise.all([
      stale ? this.api('/api/devices') : Promise.resolve(undefined),
      this.api('/api/states'),
    ]);
    const before = this.view;
    let registryChanged = false;
    if (devicesBody !== undefined) {
      const devices = parseDevices(devicesBody);
      registryChanged =
        this.devicesAt > 0 && JSON.stringify(devices) !== JSON.stringify(this.devices);
      this.devices = devices;
      this.devicesAt = Date.now();
    }
    this.view = buildView(this.devices, parseStates(statesBody));
    if (registryChanged) {
      this.emit({
        type: 'ha-event',
        event: { event_type: 'device_registry_updated', data: {} },
      });
      return;
    }
    const previous = new Map(before.states.map((state) => [state.entity_id, state]));
    for (const next of this.view.states) {
      const old = previous.get(next.entity_id);
      if (
        old &&
        old.state === next.state &&
        JSON.stringify(old.attributes) === JSON.stringify(next.attributes)
      )
        continue;
      this.emit({
        type: 'ha-event',
        event: {
          event_type: 'state_changed',
          data: { entity_id: next.entity_id, new_state: next, old_state: old ?? null },
        },
      });
    }
  }
}

export const HUB_PAIRING_REQUIRED = PAIRING_REQUIRED;
