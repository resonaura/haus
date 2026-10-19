import WebSocket, { type RawData } from 'ws';
import { randomUUID } from 'node:crypto';
import type { NativeEvent, NativeSession } from '../shared/native';
import {
  authorize,
  InvalidSessionError,
  refreshAccessToken,
  revokeSession,
  type AccessToken,
} from './auth-protocol';
import type { SecureStore, StoredSession } from './secure-store';
import { isRecord, normalizeServerUrl, validateRequest, validateManagement } from './validation';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface Subscription {
  message: Record<string, unknown>;
  wireId?: number;
}

class AccessTokenRejectedError extends Error {}

/** One authenticated main-process connection; no OAuth token crosses IPC. */
export class HomeAssistantConnection {
  private readonly snapshots = new Map<string, Promise<string>>();
  private readonly iconCache = new Map<string, string | null>();
  private sessionValue: StoredSession | null = null;
  private token: AccessToken | null = null;
  private socket: WebSocket | null = null;
  private ready = false;
  private generation = 0;
  private nextId = 1;
  private retry = 0;
  private restoring?: Promise<void>;
  private restored = false;
  private opening?: Promise<void>;
  private refreshing?: Promise<AccessToken>;
  private authAbort?: AbortController;
  private reconnectTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private readonly store: SecureStore,
    private readonly emit: (event: NativeEvent) => void,
    private readonly openBrowser: (url: string) => Promise<void>,
  ) {}

  async getSession(): Promise<NativeSession | null> {
    await this.restore();
    if (this.sessionValue && !this.ready) void this.establish().catch(() => undefined);
    return this.publicSession();
  }

  get serverUrl(): string | undefined {
    return this.sessionValue?.url;
  }

  async connect(input: unknown): Promise<NativeSession> {
    const url = normalizeServerUrl(input);
    this.store.assertAvailable();
    if (this.authAbort) throw new Error('Sign-in is already open in your browser.');
    this.stopTransport();
    this.restored = true;
    const controller = new AbortController();
    this.authAbort = controller;
    this.emit({ type: 'connection', status: 'connecting' });
    try {
      const result = await authorize(url, this.openBrowser, controller.signal);
      if (controller.signal.aborted) {
        void revokeSession(result.session).catch(() => undefined);
        throw new Error('Home Assistant sign-in was cancelled.');
      }
      this.sessionValue = result.session;
      this.token = result.token;
      this.scheduleRefresh(result.token);
      await this.store.saveSession(result.session);
      if (controller.signal.aborted) throw new Error('Home Assistant sign-in was cancelled.');
      await this.establish();
      try {
        const config = await this.request<Record<string, unknown>>({ type: 'get_config' });
        if (typeof config.location_name === 'string') {
          this.sessionValue = { ...result.session, name: config.location_name };
          await this.store.saveSession(this.sessionValue);
        }
      } catch {
        /* A readable hostname is enough if config is restricted. */
      }
      return this.publicSession()!;
    } catch (error) {
      this.emit({
        type: 'connection',
        status: this.sessionValue ? 'reconnecting' : 'disconnected',
        error: readableError(error),
      });
      throw error;
    } finally {
      if (this.authAbort === controller) this.authAbort = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.authAbort?.abort();
    this.authAbort = undefined;
    const oldSession = this.sessionValue;
    this.sessionValue = null;
    this.token = null;
    this.restored = true;
    this.stopTransport();
    this.subscriptions.clear();
    await this.store.clearSession();
    // Local sign-out remains responsive when the HA server is offline.
    if (oldSession) void revokeSession(oldSession).catch(() => undefined);
    this.emit({ type: 'connection', status: 'disconnected' });
  }

  dispose(): void {
    this.authAbort?.abort();
    this.sessionValue = null;
    this.stopTransport();
  }

  async request<T = unknown>(message: Record<string, unknown>): Promise<T> {
    validateRequest(message);
    await this.restore();
    await this.establish();
    return this.sendRequest(message) as Promise<T>;
  }

  async subscribe(message: Record<string, unknown>): Promise<string> {
    validateRequest(message);
    if (
      !['camera/webrtc/offer', 'persistent_notification/subscribe'].includes(String(message.type))
    ) {
      throw new Error('This command does not support native subscriptions.');
    }
    await this.restore();
    await this.establish();
    const subscriptionId = randomUUID();
    const subscription: Subscription = { message };
    this.subscriptions.set(subscriptionId, subscription);
    try {
      await this.startSubscription(subscription);
      return subscriptionId;
    } catch (error) {
      this.subscriptions.delete(subscriptionId);
      throw error;
    }
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    this.subscriptions.delete(subscriptionId);
    if (subscription?.wireId && this.ready) {
      await this.sendRequest({
        type: 'unsubscribe_events',
        subscription: subscription.wireId,
      }).catch(() => undefined);
    }
  }

  async cameraLastSnapshot(entityId: unknown) {
    if (typeof entityId !== 'string' || !/^camera\.[a-z0-9_]+$/.test(entityId))
      throw new Error('Select a valid camera.');
    await this.restore();
    const home = this.sessionValue?.url;
    if (!home) return null;
    const frame = await this.store.cameraSnapshots.get(home, entityId);
    return this.sessionValue?.url === home ? frame : null;
  }
  async cameraSnapshot(entityId: unknown): Promise<string> {
    if (typeof entityId !== 'string' || !/^camera\.[a-z0-9_]+$/.test(entityId)) {
      throw new Error('Select a valid camera.');
    }
    await this.restore();
    if (!this.sessionValue) throw new Error('Connect to Home Assistant first.');
    const home = this.sessionValue.url;
    const key = home + '\0' + entityId;
    const existing = this.snapshots.get(key);
    if (existing) return existing;
    if (this.snapshots.size >= 8) throw new Error('Camera snapshots are busy; try again shortly.');
    const task = this.downloadSnapshot(entityId, home).finally(() => this.snapshots.delete(key));
    this.snapshots.set(key, task);
    return task;
  }
  private async downloadSnapshot(entityId: string, home: string): Promise<string> {
    let token = await this.getAccessToken();
    const download = () =>
      fetch(new URL(`/api/camera_proxy/${entityId}`, home), {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    let response = await download();
    if (response.status === 401) {
      token = await this.getAccessToken(true);
      response = await download();
    }
    if (!response.ok) throw new Error('This camera is not providing a snapshot right now.');
    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    const limit = 6 * 1024 * 1024;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
      Number(response.headers.get('content-length') ?? 0) > limit
    ) {
      await response.body?.cancel();
      throw new Error('The camera returned an unsupported snapshot.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The camera returned an empty snapshot.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error('The camera snapshot is too large.');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (home !== this.sessionValue?.url) throw new Error('The connected home changed.');
    const image = `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
    this.store.cameraSnapshots.put(home, entityId, { image, receivedAt: Date.now() });
    return image;
  }

  /** Authenticated management stays on the configured server; credentials never cross IPC. */
  async management(input: unknown): Promise<unknown> {
    const request = validateManagement(input);
    await this.restore();
    if (!this.sessionValue) throw new Error('Connect to Home Assistant first.');
    let token = await this.getAccessToken();
    const download = () =>
      fetch(new URL(`/api/${request.path}`, this.sessionValue!.url), {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: request.data === undefined ? undefined : JSON.stringify(request.data),
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
    let response = await download();
    if (response.status === 401) {
      token = await this.getAccessToken(true);
      response = await download();
    }
    const body = await boundedBody(response, 4_000_000);
    const text = body.toString('utf8');
    let result: unknown;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = text;
    }
    if (!response.ok)
      throw new Error(
        isRecord(result) && typeof result.message === 'string'
          ? result.message
          : `Home Assistant returned ${response.status}.`,
      );
    return result;
  }

  async brandIcon(kind: unknown, id: unknown, dark = false): Promise<string | null> {
    if (
      !['integration', 'addon'].includes(String(kind)) ||
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id)
    )
      throw new Error('Invalid brand icon.');
    const key = `${kind}:${id}:${kind === 'integration' && dark ? 'dark' : 'light'}`;
    if (this.iconCache.has(key)) return this.iconCache.get(key)!;
    try {
      let url: URL;
      let headers: Record<string, string> = {};
      if (kind === 'integration')
        url = new URL(`https://brands.home-assistant.io/${id}/${dark ? 'dark_' : ''}icon@2x.png`);
      else {
        await this.restore();
        if (!this.sessionValue) return null;
        url = new URL(`/api/hassio/addons/${id}/icon`, this.sessionValue.url);
        const token = await this.getAccessToken();
        headers = { Authorization: `Bearer ${token.accessToken}` };
      }
      const response = await fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(mime)) {
        await response.body?.cancel();
        return null;
      }
      const result = `data:${mime};base64,${(await boundedBody(response, 2_000_000)).toString('base64')}`;
      this.iconCache.set(key, result);
      return result;
    } catch {
      return null;
    }
  }

  /** Only main receives the short-lived ingress credential, for a separate isolated web surface. */
  async addonSurface(slug: unknown): Promise<{ url: string; title: string; cookie?: string }> {
    if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(slug))
      throw new Error('Invalid add-on.');
    const info = await this.request<Record<string, unknown>>({
      type: 'supervisor/api',
      endpoint: `/addons/${slug}/info`,
      method: 'get',
    });
    if (info.state !== 'started')
      throw new Error('Start the add-on before opening its web interface.');
    const server = new URL(this.sessionValue!.url);
    if (
      info.ingress === true &&
      typeof info.ingress_url === 'string' &&
      /^\/api\/hassio_ingress\/[a-zA-Z0-9_-]+\/?$/.test(info.ingress_url)
    ) {
      const user = await this.sendRequest({ type: 'auth/current_user' });
      if (!isRecord(user) || typeof user.id !== 'string')
        throw new Error('Could not identify the signed-in user.');
      const result = await this.sendRequest({
        type: 'supervisor/api',
        endpoint: '/ingress/session',
        method: 'post',
        data: { user_id: user.id },
      });
      if (!isRecord(result) || typeof result.session !== 'string')
        throw new Error('Could not open an ingress session.');
      return {
        url: new URL(info.ingress_url.replace(/\/?$/, '/'), server).href,
        title: String(info.name ?? slug),
        cookie: result.session,
      };
    }
    if (typeof info.webui === 'string') {
      const network = isRecord(info.network) ? info.network : {};
      const resolved = info.webui
        .replace('[HOST]', server.hostname)
        .replace(/\[PORT:(\d+)\]/g, (_match, port: string) =>
          String(network[`${port}/tcp`] ?? port),
        );
      const url = new URL(resolved);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.hostname === server.hostname &&
        !url.username &&
        !url.password
      )
        return { url: url.href, title: String(info.name ?? slug) };
    }
    throw new Error('This add-on does not provide a web interface.');
  }

  async getSceneConfig(
    entityId: unknown,
    sceneId: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (
      typeof entityId !== 'string' ||
      !/^scene\.[a-z0-9_]+$/.test(entityId) ||
      typeof sceneId !== 'string' ||
      !/^[a-z0-9_-]{1,128}$/i.test(sceneId)
    ) {
      throw new Error('Select a valid Home Assistant scene.');
    }
    await this.restore();
    if (!this.sessionValue) throw new Error('Connect to Home Assistant first.');
    const serverUrl = this.sessionValue.url;
    let token = await this.getAccessToken();
    const download = () =>
      fetch(new URL(`/api/config/scene/config/${encodeURIComponent(sceneId)}`, serverUrl), {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    let response = await download();
    if (response.status === 401) {
      token = await this.getAccessToken(true);
      response = await download();
    }
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1_000_000) {
      await response.body?.cancel();
      return null;
    }
    try {
      const body = await response.text();
      if (body.length > 1_000_000) return null;
      const result: unknown = JSON.parse(body);
      if (!isRecord(result)) return null;
      const config = isRecord(result.config) ? result.config : result;
      return isRecord(config.entities) ? config : null;
    } catch {
      return null;
    }
  }

  private publicSession(): NativeSession | null {
    return this.sessionValue ? { url: this.sessionValue.url, name: this.sessionValue.name } : null;
  }

  private async restore(): Promise<void> {
    if (this.restored) return;
    if (!this.restoring) {
      const generation = this.generation;
      this.restoring = this.store
        .loadSession()
        .then((session) => {
          if (generation === this.generation) {
            this.sessionValue = session;
            this.restored = true;
          }
        })
        .finally(() => {
          this.restoring = undefined;
        });
    }
    await this.restoring;
  }

  private establish(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.opening) return this.opening;
    if (!this.sessionValue) return Promise.reject(new Error('Connect to Home Assistant first.'));
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const generation = this.generation;
    this.opening = this.openSocket(generation)
      .catch(async (error: unknown) => {
        if (error instanceof AccessTokenRejectedError && generation === this.generation) {
          this.token = null;
          await this.getAccessToken(true);
          return this.openSocket(generation);
        }
        throw error;
      })
      .catch(async (error: unknown) => {
        if (generation !== this.generation) throw error;
        if (error instanceof InvalidSessionError || error instanceof AccessTokenRejectedError) {
          await this.invalidate();
        } else {
          this.scheduleReconnect(readableError(error));
        }
        throw error;
      })
      .finally(() => {
        if (generation === this.generation) this.opening = undefined;
      });
    return this.opening;
  }

  private async openSocket(generation: number): Promise<void> {
    const token = await this.getAccessToken();
    if (generation !== this.generation || !this.sessionValue)
      throw new Error('Connection cancelled.');
    const url = new URL('/api/websocket', this.sessionValue.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, {
      handshakeTimeout: 15_000,
      maxPayload: 32 * 1024 * 1024,
      followRedirects: false,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let authenticated = false;
      let alive = true;
      const authTimeout = setTimeout(() => {
        reject(new Error('Home Assistant did not respond in time.'));
        socket.terminate();
      }, 20_000);
      socket.on('pong', () => {
        alive = true;
      });
      socket.on('error', () => {
        if (!authenticated)
          reject(
            new Error('Could not connect to Home Assistant. Check your network or certificate.'),
          );
      });
      socket.on('close', () => {
        clearTimeout(authTimeout);
        if (!authenticated) reject(new Error('Home Assistant closed the connection.'));
        if (generation !== this.generation || this.socket !== socket) return;
        this.ready = false;
        clearInterval(this.heartbeatTimer);
        this.rejectPending(new Error('Home Assistant disconnected.'));
        this.scheduleReconnect();
      });
      socket.on('message', (raw: RawData) => {
        if (generation !== this.generation || this.socket !== socket) return;
        let message: Record<string, unknown>;
        try {
          const value: unknown = JSON.parse(raw.toString());
          if (!isRecord(value)) return;
          message = value;
        } catch {
          return;
        }
        if (message.type === 'auth_required') {
          socket.send(JSON.stringify({ type: 'auth', access_token: token.accessToken }));
          return;
        }
        if (message.type === 'auth_invalid') {
          clearTimeout(authTimeout);
          this.token = null;
          reject(new AccessTokenRejectedError('Home Assistant rejected the access token.'));
          socket.terminate();
          return;
        }
        if (message.type === 'auth_ok') {
          authenticated = true;
          clearTimeout(authTimeout);
          this.ready = true;
          this.retry = 0;
          this.heartbeatTimer = setInterval(() => {
            if (!alive) {
              socket.terminate();
              return;
            }
            alive = false;
            socket.ping();
          }, 25_000);
          resolve();
          return;
        }
        this.receiveMessage(message);
      });
    });
    if (generation !== this.generation) return;
    await Promise.all(
      [
        'state_changed',
        'area_registry_updated',
        'device_registry_updated',
        'entity_registry_updated',
        'floor_registry_updated',
        'label_registry_updated',
        'repairs_issue_registry_updated',
      ].map((eventType) =>
        this.sendRequest({ type: 'subscribe_events', event_type: eventType }).catch(
          () => undefined,
        ),
      ),
    );
    for (const subscription of this.subscriptions.values()) {
      await this.startSubscription(subscription).catch(() => undefined);
    }
    if (generation === this.generation && this.ready)
      this.emit({ type: 'connection', status: 'connected' });
  }

  private receiveMessage(message: Record<string, unknown>): void {
    if (typeof message.id === 'number' && message.type === 'result') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.success === true) pending.resolve(message.result);
      else {
        const detail =
          isRecord(message.error) && typeof message.error.message === 'string'
            ? message.error.message
            : 'Home Assistant could not complete this action.';
        pending.reject(new Error(detail));
      }
    }
    if (message.type !== 'event') return;
    const subscription = [...this.subscriptions.entries()].find(
      ([, value]) => value.wireId === message.id,
    );
    if (subscription) {
      this.emit({
        type: 'ha-event',
        event: {
          event_type: 'haus_subscription',
          data: { subscriptionId: subscription[0], payload: message.event },
        },
      });
    } else if (
      isRecord(message.event) &&
      typeof message.event.event_type === 'string' &&
      isRecord(message.event.data)
    ) {
      this.emit({
        type: 'ha-event',
        event: {
          event_type: message.event.event_type,
          data: message.event.data,
          ...(isRecord(message.event.context) ? { context: message.event.context } : {}),
        },
      });
    }
  }

  private sendRequest(message: Record<string, unknown>, id = this.nextId++): Promise<unknown> {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Home Assistant is reconnecting. Try again shortly.'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error('Home Assistant took too long to respond.'));
        },
        message.type === 'supervisor/api' || message.type === 'hassio/update/addon'
          ? 600_000
          : 15_000,
      );
      this.pending.set(id, { resolve, reject, timeout });
      this.socket!.send(JSON.stringify({ ...message, id }), (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error('Could not send the Home Assistant command.'));
      });
    });
  }

  private startSubscription(subscription: Subscription): Promise<unknown> {
    subscription.wireId = this.nextId++;
    return this.sendRequest(subscription.message, subscription.wireId);
  }

  private async getAccessToken(force = false): Promise<AccessToken> {
    if (!force && this.token && this.token.expiresAt > Date.now() + 60_000) return this.token;
    if (!this.sessionValue) throw new Error('Connect to Home Assistant first.');
    if (!this.refreshing) {
      const session = this.sessionValue;
      const generation = this.generation;
      const refreshing = refreshAccessToken(session)
        .then((token) => {
          if (generation !== this.generation) throw new Error('Connection cancelled.');
          this.token = token;
          this.scheduleRefresh(token);
          return token;
        })
        .finally(() => {
          if (this.refreshing === refreshing) this.refreshing = undefined;
        });
      this.refreshing = refreshing;
    }
    return this.refreshing;
  }

  private scheduleRefresh(token: AccessToken): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => {
        void this.getAccessToken(true).catch((error: unknown) => {
          if (error instanceof InvalidSessionError) void this.invalidate();
          else if (this.sessionValue)
            this.refreshTimer = setTimeout(
              () => this.scheduleRefresh({ ...token, expiresAt: Date.now() + 61_000 }),
              30_000,
            );
        });
      },
      Math.max(1000, token.expiresAt - Date.now() - 60_000),
    );
  }

  private scheduleReconnect(error?: string): void {
    if (!this.sessionValue || this.reconnectTimer) return;
    this.emit({ type: 'connection', status: 'reconnecting', ...(error ? { error } : {}) });
    const delay =
      Math.min(30_000, 1000 * 2 ** Math.min(this.retry++, 5)) + Math.floor(Math.random() * 400);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.establish().catch(() => undefined);
    }, delay);
  }

  private async invalidate(): Promise<void> {
    this.sessionValue = null;
    this.token = null;
    this.stopTransport();
    await this.store.clearSession();
    this.emit({
      type: 'connection',
      status: 'disconnected',
      error: 'Your Home Assistant session expired. Sign in again.',
    });
  }

  private stopTransport(): void {
    this.generation += 1;
    this.ready = false;
    this.opening = undefined;
    this.refreshing = undefined;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    clearTimeout(this.refreshTimer);
    clearInterval(this.heartbeatTimer);
    this.socket?.terminate();
    this.socket = null;
    this.rejectPending(new Error('Home Assistant connection closed.'));
    for (const subscription of this.subscriptions.values()) subscription.wireId = undefined;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not connect to Home Assistant.';
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('The server response is too large.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
