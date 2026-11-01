import { EntityActionQueue } from './command-queue.js';
import type { HassEntity, HausAction } from './types.js';

export type HaConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'auth-required';
export type HaMessage = { type: string } & Record<string, unknown>;
export class HaClientError extends Error {
  constructor(
    readonly code:
      'offline' | 'session-changed' | 'auth-required' | 'connection-failed' | 'timeout',
  ) {
    super(code);
    this.name = 'HaClientError';
  }
}

/** A secure platform session opens this port; credentials never enter the home store. */
export interface HaTransport {
  readonly connected: boolean;
  close(): void;
  request<T>(message: HaMessage): Promise<T>;
  watchState(callback: (state: HaConnectionState) => void): () => void;
  watchEntities(callback: (entities: readonly HassEntity[]) => void): () => void;
}
export interface HaClientObserver {
  state(homeId: string, state: HaConnectionState): void;
  entities(homeId: string, entities: readonly HassEntity[]): void;
  authRequired(homeId: string): void;
}

/** Reconnect subscriptions, but never replay physical commands after connectivity or account loss. */
export class HomeAssistantClient {
  private generation = 0;
  private connectivity = 0;
  private transport?: HaTransport;
  private cleanup: (() => void)[] = [];
  private homeId?: string;
  private readonly queue = new EntityActionQueue();

  constructor(
    private readonly open: (homeId: string) => Promise<HaTransport>,
    private readonly observer: HaClientObserver,
  ) {}

  async connect(homeId: string): Promise<void> {
    this.disconnect();
    const generation = this.generation;
    this.homeId = homeId;
    this.observer.state(homeId, 'connecting');
    let transport: HaTransport;
    try {
      transport = await this.open(homeId);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof HaClientError && error.code === 'auth-required') this.invalidate(homeId);
      else this.observer.state(homeId, 'disconnected');
      throw error instanceof HaClientError ? error : new HaClientError('connection-failed');
    }
    if (generation !== this.generation) {
      transport.close();
      return;
    }
    this.transport = transport;
    const current = () => generation === this.generation && this.transport === transport;
    const stopState = transport.watchState((state) => {
      if (!current()) return;
      if (state !== 'connected') ++this.connectivity;
      if (state === 'auth-required') this.invalidate(homeId);
      else this.observer.state(homeId, state);
    });
    if (!current()) {
      stopState();
      return;
    }
    this.cleanup.push(stopState);
    const stopEntities = transport.watchEntities((entities) => {
      if (current() && transport.connected) this.observer.entities(homeId, entities);
    });
    if (!current()) {
      stopEntities();
      return;
    }
    this.cleanup.push(stopEntities);
    if (current()) this.observer.state(homeId, transport.connected ? 'connected' : 'reconnecting');
  }

  request<T>(message: HaMessage): Promise<T> {
    const transport = this.transport;
    const generation = this.generation;
    if (!transport?.connected) return Promise.reject(new HaClientError('offline'));
    const current = () => {
      if (generation !== this.generation) throw new HaClientError('session-changed');
    };
    return transport.request<T>(message).then(
      (value) => {
        current();
        return value;
      },
      (error: unknown) => {
        current();
        throw error;
      },
    );
  }

  callService<T = unknown>(action: HausAction): Promise<T> {
    const transport = this.transport;
    const generation = this.generation;
    const connectivity = this.connectivity;
    if (!transport?.connected) return Promise.reject(new HaClientError('offline'));
    // Snapshot intent now; callers may reuse a mutable slider data object.
    const message: HaMessage = JSON.parse(
      JSON.stringify({
        type: 'call_service',
        domain: action.domain,
        service: action.service,
        target: action.target,
        service_data: action.service_data ?? {},
      }),
    ) as HaMessage;
    return this.queue.run(action.target.entity_id, async () => {
      if (generation !== this.generation || transport !== this.transport)
        throw new HaClientError('session-changed');
      if (!transport.connected || connectivity !== this.connectivity)
        throw new HaClientError('offline');
      return this.request<T>(message);
    });
  }

  private invalidate(homeId: string) {
    this.disconnect();
    this.observer.state(homeId, 'auth-required');
    this.observer.authRequired(homeId);
  }

  disconnect(): void {
    ++this.generation;
    ++this.connectivity;
    const transport = this.transport;
    this.transport = undefined;
    for (const dispose of this.cleanup.splice(0)) dispose();
    transport?.close();
    if (this.homeId) this.observer.state(this.homeId, 'disconnected');
    this.homeId = undefined;
  }
}
