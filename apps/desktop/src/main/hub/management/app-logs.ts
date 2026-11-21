/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import type { NativeEvent } from '../../../shared/native';

export interface AppLogStreamBearer {
  readonly url: string;
  readonly token: string;
}

export type AppLogStreamEvent =
  | { readonly kind: 'log'; readonly line: string }
  | { readonly kind: 'status'; readonly status: 'connected' | 'ended' }
  | { readonly kind: 'error'; readonly error: string };

/**
 * Manages authenticated SSE connections from Electron's main process to Haus Hub's
 * `/api/apps/:id/logs/stream` endpoint and forwards live log events over `haus_subscription`.
 */
export class HubAppLogStreamManager {
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  subscribe(
    message: Record<string, unknown>,
    bearer: AppLogStreamBearer | null | undefined,
    emit: (event: NativeEvent) => void,
  ): string {
    const subscriptionId = randomUUID();
    if (message.type !== 'apps/logs' || typeof message.appId !== 'string' || !bearer) {
      return subscriptionId;
    }
    const appId = message.appId;
    const rawTail =
      typeof message.tail === 'number' && Number.isFinite(message.tail) ? message.tail : 200;
    const tail = Math.max(1, Math.min(2000, Math.floor(rawTail)));
    const controller = new AbortController();
    this.active.set(subscriptionId, controller);

    const publish = (payload: AppLogStreamEvent) => {
      emit({
        type: 'ha-event',
        event: {
          event_type: 'haus_subscription',
          data: { subscriptionId, payload },
        },
      });
    };

    const url = `${bearer.url.replace(/\/+$/, '')}/api/apps/${encodeURIComponent(appId)}/logs/stream?tail=${tail}`;
    void this.consumeStream(subscriptionId, url, bearer.token, controller, publish);
    return subscriptionId;
  }

  unsubscribe(subscriptionId?: string): void {
    if (!subscriptionId) return;
    const controller = this.active.get(subscriptionId);
    if (!controller) return;
    this.active.delete(subscriptionId);
    controller.abort();
  }

  dispose(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
    this.active.clear();
  }

  private async consumeStream(
    subscriptionId: string,
    url: string,
    token: string,
    controller: AbortController,
    publish: (payload: AppLogStreamEvent) => void,
  ): Promise<void> {
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        if (!controller.signal.aborted) {
          publish({ kind: 'error', error: `http_${response.status}` });
          publish({ kind: 'status', status: 'ended' });
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            this.dispatchFrame(frame, publish);
          }
        }
        if (buffer.trim()) this.dispatchFrame(buffer, publish);
      } finally {
        reader.releaseLock();
      }
      if (!controller.signal.aborted) {
        publish({ kind: 'status', status: 'ended' });
      }
    } catch {
      if (!controller.signal.aborted) {
        publish({ kind: 'error', error: 'log_stream_disconnected' });
        publish({ kind: 'status', status: 'ended' });
      }
    } finally {
      if (this.active.get(subscriptionId) === controller) {
        this.active.delete(subscriptionId);
      }
    }
  }

  private dispatchFrame(frame: string, publish: (payload: AppLogStreamEvent) => void): void {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split(/\r?\n/)) {
      if (!rawLine || rawLine.startsWith(':')) continue;
      if (rawLine.startsWith('event:')) {
        eventName = rawLine.slice(6).trim();
      } else if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLines.join('\n')) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const record = parsed as Record<string, unknown>;
    if (eventName === 'log' && typeof record.line === 'string') {
      publish({ kind: 'log', line: record.line });
    } else if (
      eventName === 'status' &&
      (record.status === 'connected' || record.status === 'ended')
    ) {
      publish({ kind: 'status', status: record.status });
    } else if (eventName === 'error' && typeof record.error === 'string') {
      publish({ kind: 'error', error: record.error });
    }
  }
}
