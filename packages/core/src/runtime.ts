/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { EntityActionQueue } from './command-queue.js';
import type { CommandReceipt } from './types.js';

export type ConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'auth-required';
export class RuntimeError extends Error {
  constructor(
    readonly code:
      'offline' | 'session-changed' | 'auth-required' | 'connection-failed' | 'timeout',
  ) {
    super(code);
    this.name = 'RuntimeError';
  }
}
export interface RuntimeTransport<Value, Action> {
  readonly connected: boolean;
  close(): void;
  execute(action: Action): Promise<CommandReceipt>;
  watchState(callback: (state: ConnectionState) => void): () => void;
  watchValues(callback: (values: readonly Value[]) => void): () => void;
}
export interface RuntimeObserver<Value> {
  state(homeId: string, state: ConnectionState): void;
  values(homeId: string, values: readonly Value[]): void;
  authRequired(homeId: string): void;
}

/** Owns session fencing and command ordering; adapters own wire formats and credentials. */
export class HomeRuntime<Value, Action> {
  private generation = 0;
  private connectivity = 0;
  private transport?: RuntimeTransport<Value, Action>;
  private cleanup: (() => void)[] = [];
  private homeId?: string;
  private readonly queue = new EntityActionQueue();
  constructor(
    private readonly open: (homeId: string) => Promise<RuntimeTransport<Value, Action>>,
    private readonly observer: RuntimeObserver<Value>,
    private readonly subject: (action: Action) => string,
  ) {}
  async connect(homeId: string): Promise<void> {
    this.disconnect();
    const generation = this.generation;
    this.homeId = homeId;
    this.observer.state(homeId, 'connecting');
    let transport: RuntimeTransport<Value, Action>;
    try {
      transport = await this.open(homeId);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof RuntimeError && error.code === 'auth-required') this.invalidate(homeId);
      else this.observer.state(homeId, 'disconnected');
      throw error instanceof RuntimeError ? error : new RuntimeError('connection-failed');
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
    const stopValues = transport.watchValues((values) => {
      if (current() && transport.connected) this.observer.values(homeId, values);
    });
    if (!current()) {
      stopValues();
      return;
    }
    this.cleanup.push(stopValues);
    this.observer.state(homeId, transport.connected ? 'connected' : 'reconnecting');
  }
  execute(action: Action): Promise<CommandReceipt> {
    const transport = this.transport,
      generation = this.generation,
      connectivity = this.connectivity;
    if (!transport?.connected) return Promise.reject(new RuntimeError('offline'));
    const intent = JSON.parse(JSON.stringify(action)) as Action;
    return this.queue.run(this.subject(intent), async () => {
      if (generation !== this.generation || transport !== this.transport)
        throw new RuntimeError('session-changed');
      if (!transport.connected || connectivity !== this.connectivity)
        throw new RuntimeError('offline');
      try {
        const result = await transport.execute(intent);
        if (generation !== this.generation || transport !== this.transport)
          throw new RuntimeError('session-changed');
        return result;
      } catch (error) {
        if (generation !== this.generation || transport !== this.transport)
          throw new RuntimeError('session-changed');
        throw error;
      }
    });
  }
  private invalidate(homeId: string) {
    this.disconnect();
    this.observer.state(homeId, 'auth-required');
    this.observer.authRequired(homeId);
  }
  disconnect() {
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
