/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import WebSocket from 'ws';
import type { HassEntity } from '../types.js';
import type { HaConnectionState, HaMessage, HaTransport } from '../ha-client.js';
import type { HaCredential } from './credential.js';
import type { HaProviderAddress } from './address.js';

export class HaResponseError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HaResponseError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  sent: boolean;
  command: boolean;
}

interface EntityDiff {
  a?: Record<string, { s?: string; a?: Record<string, unknown>; lc?: number; lu?: number }>;
  c?: Record<
    string,
    {
      '+'?: { s?: string; a?: Record<string, unknown>; lc?: number; lu?: number };
      '-'?: { a?: string[] };
    }
  >;
  r?: string[];
}

export interface OwnedTransportOptions {
  readonly commandTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly backoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly socketFactory?: (url: string) => WebSocket;
  readonly refresh?: () => Promise<HaCredential>;
}

function applyDiff(cache: Map<string, HassEntity>, diff: EntityDiff): readonly HassEntity[] {
  if (diff.a) {
    for (const [entityId, item] of Object.entries(diff.a)) {
      const lastChanged = item.lc
        ? new Date(item.lc * 1000).toISOString()
        : new Date().toISOString();
      const lastUpdated = item.lu ? new Date(item.lu * 1000).toISOString() : lastChanged;
      cache.set(entityId, {
        entity_id: entityId,
        state: String(item.s ?? ''),
        attributes: item.a && typeof item.a === 'object' ? { ...item.a } : {},
        last_changed: lastChanged,
        last_updated: lastUpdated,
      });
    }
  }
  if (diff.c) {
    for (const [entityId, change] of Object.entries(diff.c)) {
      const existing = cache.get(entityId);
      if (!existing) continue;
      const updated: HassEntity = {
        ...existing,
        attributes: { ...existing.attributes },
      };
      if (change['+']) {
        const add = change['+'];
        if (add.s !== undefined) updated.state = String(add.s);
        if (add.a) Object.assign(updated.attributes, add.a);
        if (add.lc) updated.last_changed = new Date(add.lc * 1000).toISOString();
        if (add.lu) updated.last_updated = new Date(add.lu * 1000).toISOString();
      }
      if (change['-']?.a) {
        for (const key of change['-'].a) {
          delete updated.attributes[key];
        }
      }
      cache.set(entityId, updated);
    }
  }
  if (diff.r) {
    for (const entityId of diff.r) {
      cache.delete(entityId);
    }
  }
  return Array.from(cache.values());
}

/** Owned HA WebSocket transport with explicit fencing, no independent refresh, and zero command replays. */
export class OwnedHaTransport implements HaTransport {
  private socket?: WebSocket;
  private currentState: HaConnectionState = 'disconnected';
  private currentCredential?: HaCredential;
  private isConnected = false;
  private isClosed = false;
  private generation = 0;
  private nextId = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private backoff: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly requests = new Map<number, PendingRequest>();
  private readonly stateListeners = new Set<(state: HaConnectionState) => void>();
  private readonly entityListeners = new Set<(entities: readonly HassEntity[]) => void>();
  private readonly entities = new Map<string, HassEntity>();
  private entitySubId?: number;

  constructor(
    private readonly address: HaProviderAddress,
    private readonly options: OwnedTransportOptions = {},
  ) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 15_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.backoffMs = options.backoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 5000;
    this.backoff = this.backoffMs;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get state(): HaConnectionState {
    return this.currentState;
  }

  async open(credential: HaCredential, signal?: AbortSignal): Promise<void> {
    if (this.isClosed) throw Error('transport_closed');
    signal?.throwIfAborted();
    this.currentCredential = credential;
    this.generation++;
    const gen = this.generation;
    await this.connectSocket(credential, gen, signal);
  }

  request<T>(message: HaMessage, signal?: AbortSignal): Promise<T> {
    if (this.isClosed) return Promise.reject(Error('transport_closed'));
    if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(Error('endpoint_offline'));
    }
    if (signal?.aborted) return Promise.reject(Error('request_aborted'));
    const id = ++this.nextId;
    const isCommand = message.type === 'call_service';
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const pending: PendingRequest = {
        resolve: (val) => {
          if (timer) clearTimeout(timer);
          resolve(val as T);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
        sent: false,
        command: isCommand,
      };
      timer = setTimeout(() => {
        if (this.requests.delete(id)) {
          pending.reject(Error(isCommand && pending.sent ? 'ha_command_timeout' : 'timeout'));
        }
      }, this.commandTimeoutMs);
      if (signal) {
        const onAbort = () => {
          if (this.requests.delete(id)) {
            if (timer) clearTimeout(timer);
            pending.reject(
              Error(isCommand && pending.sent ? 'ha_command_timeout' : 'request_aborted'),
            );
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.requests.set(id, pending);
      try {
        this.socket!.send(JSON.stringify({ id, ...message }));
        pending.sent = true;
      } catch {
        if (this.requests.delete(id)) {
          if (timer) clearTimeout(timer);
          reject(Error('endpoint_offline'));
        }
      }
    });
  }

  watchState(callback: (state: HaConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    callback(this.currentState);
    return () => this.stateListeners.delete(callback);
  }

  watchEntities(callback: (entities: readonly HassEntity[]) => void): () => void {
    this.entityListeners.add(callback);
    if (this.entities.size > 0) callback(Array.from(this.entities.values()));
    if (this.isConnected && this.entitySubId === undefined) {
      this.subscribeEntities();
    }
    return () => {
      this.entityListeners.delete(callback);
      if (this.entityListeners.size === 0 && this.entitySubId !== undefined) {
        const subId = this.entitySubId;
        this.entitySubId = undefined;
        if (this.isConnected) {
          void this.request({ type: 'unsubscribe_events', subscription: subId }).catch(() => {});
        }
      }
    };
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    this.generation++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    for (const [id, pending] of this.requests.entries()) {
      this.requests.delete(id);
      pending.reject(Error('transport_closed'));
    }
    this.entityListeners.clear();
    this.stateListeners.clear();
    this.entities.clear();
    const sock = this.socket;
    this.socket = undefined;
    this.isConnected = false;
    this.entitySubId = undefined;
    if (sock) {
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | undefined;
        const done = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };
        sock.once('close', done);
        timer = setTimeout(() => {
          try {
            sock.terminate();
          } catch {}
          done();
        }, 1000);
        try {
          sock.close();
        } catch {
          done();
        }
      });
    }
    this.setState('disconnected');
  }

  private setState(state: HaConnectionState) {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {}
    }
  }

  private connectSocket(
    credential: HaCredential,
    generation: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.isClosed || generation !== this.generation) {
        return reject(Error('transport_closed'));
      }
      signal?.throwIfAborted();
      this.setState('connecting');
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      timer = setTimeout(() => {
        finish(Error('ha_connection_timeout'));
        try {
          sock.terminate();
        } catch {}
      }, this.connectTimeoutMs);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            finish(Error('ha_connection_aborted'));
            try {
              sock.terminate();
            } catch {}
          },
          { once: true },
        );
      }
      const sock = this.options.socketFactory
        ? this.options.socketFactory(this.address.websocket.href)
        : new WebSocket(this.address.websocket.href);
      let authPending = false;
      sock.on('message', (raw: WebSocket.RawData) => {
        if (this.isClosed || generation !== this.generation) {
          sock.close();
          return;
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!authPending) {
          if (data.type !== 'auth_required') {
            finish(Error('invalid_ha_handshake'));
            sock.close();
            return;
          }
          authPending = true;
          sock.send(JSON.stringify({ type: 'auth', access_token: credential.accessToken }));
          return;
        }
        if (data.type === 'auth_ok') {
          this.socket = sock;
          this.isConnected = true;
          this.backoff = this.backoffMs;
          this.setState('connected');
          finish();
          if (this.entityListeners.size > 0 && this.entitySubId === undefined) {
            this.subscribeEntities();
          }
          return;
        }
        if (data.type === 'auth_invalid') {
          this.setState('auth-required');
          finish(Error('ha_auth_invalid'));
          sock.close();
          return;
        }
        this.handleMessage(data);
      });
      sock.once('error', (err: Error) => {
        if (!settled) finish(err);
        else this.onSocketClosed();
      });
      sock.once('close', () => {
        if (!settled) finish(Error('ha_connection_failed'));
        else this.onSocketClosed();
      });
    });
  }

  private handleMessage(data: Record<string, unknown>) {
    if (data.type === 'result') {
      const id = typeof data.id === 'number' ? data.id : undefined;
      if (id !== undefined) {
        const pending = this.requests.get(id);
        if (pending) {
          this.requests.delete(id);
          if (data.success) {
            pending.resolve(data.result);
          } else {
            const err = data.error && typeof data.error === 'object' ? data.error : {};
            const message =
              'message' in err && typeof err.message === 'string'
                ? err.message
                : 'ha_request_failed';
            const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined;
            pending.reject(new HaResponseError(message, code));
          }
        }
      }
      return;
    }
    if (data.type === 'event' && typeof data.id === 'number' && data.id === this.entitySubId) {
      const event = data.event as EntityDiff | undefined;
      if (event && typeof event === 'object') {
        const updated = applyDiff(this.entities, event);
        for (const listener of this.entityListeners) {
          try {
            listener(updated);
          } catch {}
        }
      }
    }
  }

  private subscribeEntities() {
    if (!this.isConnected || this.entitySubId !== undefined) return;
    const subId = ++this.nextId;
    this.entitySubId = subId;
    void this.request({ type: 'subscribe_entities' })
      .then(() => {})
      .catch(() => {
        if (this.entitySubId === subId) this.entitySubId = undefined;
      });
  }

  private onSocketClosed() {
    this.socket = undefined;
    this.isConnected = false;
    this.entitySubId = undefined;
    for (const [id, pending] of this.requests.entries()) {
      this.requests.delete(id);
      if (pending.command && pending.sent) {
        pending.reject(Error('ha_command_lost'));
      } else {
        pending.reject(Error('transport_lost'));
      }
    }
    if (this.isClosed) {
      this.setState('disconnected');
      return;
    }
    this.setState('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.isClosed || this.reconnectTimer) return;
    const gen = this.generation;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      if (this.isClosed || gen !== this.generation) return;
      try {
        let cred = this.currentCredential;
        if (this.currentState === 'auth-required' && this.options.refresh) {
          try {
            cred = await this.options.refresh();
            this.currentCredential = cred;
          } catch {
            return;
          }
        }
        if (!cred) return;
        await this.connectSocket(cred, gen);
      } catch (err: unknown) {
        if (this.isClosed || gen !== this.generation) return;
        if (err instanceof Error && err.message === 'ha_auth_invalid') {
          this.setState('auth-required');
          if (this.options.refresh) {
            try {
              const renewed = await this.options.refresh();
              this.currentCredential = renewed;
              if (!this.isClosed && gen === this.generation) {
                this.backoff = this.backoffMs;
                await this.connectSocket(renewed, gen);
              }
              return;
            } catch {}
          }
          return;
        }
        this.backoff = Math.min(this.backoff * 2, this.maxBackoffMs);
        this.scheduleReconnect();
      }
    }, this.backoff);
  }
}
