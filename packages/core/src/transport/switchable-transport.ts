/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ConnectionState, RuntimeTransport } from '../runtime.js';
import type { CommandReceipt } from '../types.js';
import type {
  DemoModeStorage,
  HomeTransport,
  HomeTransportEvent,
  HomeTransportMode,
  HomeTransportRequest,
  SwitchModeOptions,
  TransportAction,
  TransportSnapshot,
} from './contract.js';
import type { DemoHomeTransport } from './demo-transport.js';

export interface SwitchableHomeTransportOptions<
  TSnapshot extends TransportSnapshot = TransportSnapshot,
  TAction extends TransportAction = TransportAction,
> {
  readonly live: HomeTransport<TSnapshot['states'][number]> | null;
  readonly demo: DemoHomeTransport<TSnapshot, TAction>;
  readonly storage?: DemoModeStorage;
  readonly initialMode?: HomeTransportMode;
}

function toConnectionState(status: string): ConnectionState {
  switch (status) {
    case 'connected':
    case 'demo':
      return 'connected';
    case 'connecting':
    case 'restoring':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

/**
 * Composable OOP transport router shared across Desktop, Mobile, and Web.
 * Seamlessly switches between the live Hub/IPC transport and local `DemoHomeTransport`
 * without altering UI components or discarding saved live home credentials.
 */
export class SwitchableHomeTransport<
  TSnapshot extends TransportSnapshot = TransportSnapshot,
  TAction extends TransportAction = TransportAction,
> implements HomeTransport<TSnapshot['states'][number]> {
  private _mode: HomeTransportMode;
  private readonly live: HomeTransport<TSnapshot['states'][number]> | null;
  readonly demo: DemoHomeTransport<TSnapshot, TAction>;
  private readonly storage?: DemoModeStorage;
  private readonly listeners = new Set<
    (event: HomeTransportEvent<TSnapshot['states'][number]>) => void
  >();
  private readonly detachLive?: () => void;
  private readonly detachDemo: () => void;

  constructor(options: SwitchableHomeTransportOptions<TSnapshot, TAction>) {
    this.live = options.live;
    this.demo = options.demo;
    this.storage = options.storage;

    const storedDemo = options.storage?.read() ?? false;
    this._mode = !options.live || storedDemo || options.initialMode === 'demo' ? 'demo' : 'live';

    if (this.live) {
      this.detachLive = this.live.onEvent((event) => {
        if (this._mode === 'live') this.emit(event);
      });
    }
    this.detachDemo = this.demo.onEvent((event) => {
      if (this._mode === 'demo') this.emit(event);
    });
  }

  get mode(): HomeTransportMode {
    return this._mode;
  }

  get hasLiveTransport(): boolean {
    return this.live !== null;
  }

  private get active(): HomeTransport<TSnapshot['states'][number]> {
    return this._mode === 'live' && this.live ? this.live : this.demo;
  }

  setMode(nextMode: HomeTransportMode, options: SwitchModeOptions = {}): void {
    const targetMode: HomeTransportMode = nextMode === 'live' && !this.live ? 'demo' : nextMode;
    if (options.persist !== false) {
      this.storage?.write(targetMode === 'demo');
    }
    const changed = this._mode !== targetMode;
    this._mode = targetMode;
    if (targetMode === 'demo' && options.resetDemo !== false) {
      this.demo.reset();
    }
    if (changed) {
      this.emit({ type: 'mode_changed', mode: targetMode });
    }
  }

  request<T = unknown>(message: HomeTransportRequest): Promise<T> {
    return this.active.request<T>(message);
  }

  subscribe<T = unknown>(
    message: HomeTransportRequest,
    onEvent: (event: T) => void,
  ): Promise<() => void> {
    return this.active.subscribe<T>(message, onEvent);
  }

  onEvent(listener: (event: HomeTransportEvent<TSnapshot['states'][number]>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSceneConfig(entityId: string, sceneId: string): Promise<Record<string, unknown> | null> {
    return this.active.getSceneConfig(entityId, sceneId);
  }

  /**
   * Adapts this switchable transport to `@haus/core`'s `RuntimeTransport` port so
   * Mobile / Zustand `HomeRuntime` stores can seamlessly switch Live <-> Demo too.
   */
  asRuntimeTransport(): RuntimeTransport<TSnapshot['states'][number], TAction> {
    let closed = false;
    return {
      get connected() {
        return !closed;
      },
      close: () => {
        closed = true;
      },
      execute: async (action: TAction): Promise<CommandReceipt> => {
        const result = await this.request<{ context?: { id?: string } }>({
          type: 'call_service',
          domain: action.domain,
          service: action.service,
          target: action.target,
          ...(action.service_data ? { service_data: action.service_data } : {}),
        });
        const correlationId =
          result && typeof result === 'object' && typeof result.context?.id === 'string'
            ? result.context.id
            : undefined;
        return { status: 'accepted', ...(correlationId ? { correlationId } : {}) };
      },
      watchState: (callback) =>
        this.onEvent((event) => {
          if (event.type === 'connection') {
            callback(toConnectionState(event.status));
          } else if (event.type === 'mode_changed') {
            callback(event.mode === 'demo' ? 'connected' : 'reconnecting');
          }
        }),
      watchValues: (callback) =>
        this.onEvent((event) => {
          if (event.type === 'state_changed' && this._mode === 'demo') {
            callback(this.demo.getSnapshot().states);
          } else if (event.type === 'mode_changed' && event.mode === 'demo') {
            callback(this.demo.getSnapshot().states);
          }
        }),
    };
  }

  dispose(): void {
    this.detachLive?.();
    this.detachDemo();
    this.live?.dispose();
    this.demo.dispose();
    this.listeners.clear();
  }

  private emit(event: HomeTransportEvent<TSnapshot['states'][number]>): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
