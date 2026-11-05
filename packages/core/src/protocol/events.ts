/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type ProtocolEventListener<T = unknown> = (data: T) => void;

/**
 * Lightweight, isomorphic event dispatcher that runs without Node-specific @types/node dependencies.
 */
export class ProtocolEventDispatcher {
  private readonly listeners = new Map<string, Set<ProtocolEventListener<unknown>>>();

  public on<T = unknown>(event: string, listener: ProtocolEventListener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as ProtocolEventListener<unknown>);
    return () => this.off(event, listener);
  }

  public off<T = unknown>(event: string, listener: ProtocolEventListener<T>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as ProtocolEventListener<unknown>);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public emit<T = unknown>(event: string, data: T): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch (err) {
          console.error(`Error in event listener for '${event}':`, err);
        }
      }
    }
  }

  public removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  public listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
