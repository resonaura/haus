/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 only; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-only.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

interface PendingEufyRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface EufyDeviceEventMessage {
  serialNumber?: string;
  event?: string;
  [key: string]: unknown;
}

export interface EufyCameraDescriptor {
  id?: string;
  deviceId?: string;
  deviceIds?: readonly string[];
}

export interface EufyDeviceRegistry {
  devices?: ReadonlyArray<{
    id?: string;
    identifiers?: ReadonlyArray<readonly [string, string]>;
  }>;
}

export class EufySession extends EventEmitter {
  readonly url: string;
  readonly pending = new Map<string, PendingEufyRequest>();
  socket?: WebSocket;

  constructor(url: string) {
    super();
    this.url = url;
  }

  async connect(): Promise<void> {
    this.socket = new WebSocket(this.url, { maxPayload: 8 * 1024 ** 2 });
    const socket = this.socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('eufy_timeout')), 10000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      socket.on('error', () => finish(new Error('eufy_unavailable')));
      socket.on('close', () => {
        for (const item of this.pending.values()) {
          clearTimeout(item.timer);
          item.reject(new Error('eufy_disconnected'));
        }
        this.pending.clear();
        this.emit('disconnected');
        finish(new Error('eufy_disconnected'));
      });
      socket.on('message', (bytes: WebSocket.RawData) => {
        let message: {
          type?: string;
          maxSchemaVersion?: number;
          minSchemaVersion?: number;
          event?: EufyDeviceEventMessage;
          messageId?: string;
          success?: boolean;
          result?: Record<string, unknown>;
        };
        try {
          message = JSON.parse(String(bytes)) as typeof message;
        } catch {
          return;
        }
        if (message.type === 'version') {
          const version = Math.min(21, message.maxSchemaVersion ?? 13);
          if (version < (message.minSchemaVersion ?? 13) || version < 13) {
            finish(new Error('eufy_schema_unsupported'));
            return;
          }
          void this.command('set_api_schema', { schemaVersion: version })
            .then(() => this.command('start_listening'))
            .then(() => finish())
            .catch((error: unknown) =>
              finish(error instanceof Error ? error : new Error(String(error))),
            );
        } else if (message.type === 'event') {
          this.emit('device-event', message.event);
        } else if (message.messageId && this.pending.has(message.messageId)) {
          const item = this.pending.get(message.messageId)!;
          this.pending.delete(message.messageId);
          clearTimeout(item.timer);
          if (message.success === false) item.reject(new Error('eufy_command_failed'));
          else item.resolve(message.result ?? {});
        }
      });
    });
  }

  command(command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('eufy_disconnected'));
    }
    const messageId = randomUUID();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error('eufy_timeout'));
      }, 10000);
      this.pending.set(messageId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ messageId, command, ...params }));
    });
  }

  wait(serial: string, event: string): { promise: Promise<void>; cancel: () => void } {
    let listener!: (message?: EufyDeviceEventMessage) => void;
    let timer!: NodeJS.Timeout;
    const promise = new Promise<void>((resolve, reject) => {
      listener = (message?: EufyDeviceEventMessage) => {
        if (message?.serialNumber === serial && message.event === event) {
          clearTimeout(timer);
          this.off('device-event', listener);
          resolve();
        }
      };
      this.on('device-event', listener);
      timer = setTimeout(() => {
        this.off('device-event', listener);
        reject(new Error('eufy_event_timeout'));
      }, 10000);
    });
    promise.catch(() => {});
    return {
      promise,
      cancel: () => {
        clearTimeout(timer);
        this.off('device-event', listener);
      },
    };
  }

  close(): void {
    this.socket?.terminate();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('eufy_disconnected'));
    }
    this.pending.clear();
    this.removeAllListeners('device-event');
  }
}

export function eufySerial(
  camera: EufyCameraDescriptor,
  registry: EufyDeviceRegistry,
): string | null {
  const ids = new Set([camera.deviceId, ...(camera.deviceIds ?? [])]);
  const serials = new Set(
    (registry.devices ?? [])
      .filter((device) => device.id !== undefined && ids.has(device.id))
      .flatMap((device) =>
        (device.identifiers ?? [])
          .filter(([domain]) => /eufy/i.test(domain))
          .map(([, value]) => value),
      )
      .filter((value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,40}$/.test(value)),
  );
  return serials.size === 1 ? ([...serials][0] ?? null) : null;
}
