/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import { HubAuthService } from '../auth/service.js';
import { HUB_AUTH_SERVICE } from '../auth/tokens.js';
import type { LivePublishOptions, LiveService, LiveState } from './types.js';

const MAX_LIVE_FRAME_BYTES = 48 * 1024;
const MAX_LIVE_ENDPOINTS_PER_FRAME = 64;
const SENSITIVE_LIVE_KEY =
  /(?:token|secret|password|auth|cookie|credential|bindkey|private|sdp|stream_url|rtsp)/i;

function redactLiveValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => redactLiveValue(item, depth + 1)).filter((v) => v !== undefined);
  }
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_LIVE_KEY.test(key)) continue;
    const safe = redactLiveValue(item, depth + 1);
    if (safe !== undefined) clean[key] = safe;
  }
  return clean;
}

function redactStateChanges(
  raw: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!raw) return undefined;
  const entries = Object.entries(raw);
  if (entries.length === 0 || entries.length > MAX_LIVE_ENDPOINTS_PER_FRAME) return undefined;
  const clean: Record<string, Record<string, unknown>> = {};
  for (const [endpointId, state] of entries) {
    const safeState = redactLiveValue(state, 0);
    if (safeState && typeof safeState === 'object' && !Array.isArray(safeState)) {
      clean[endpointId] = safeState as Record<string, unknown>;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

interface WebSocketWithAlive extends WebSocket {
  isAlive?: boolean;
}

export interface HubLiveOptions {
  token?: string;
  authValidator?: (header: string | undefined) => boolean;
  heartbeatMs?: number;
}

@Injectable()
export class HubLiveService implements LiveService, OnModuleDestroy {
  private readonly instance = randomUUID();
  private sequence = 0;
  private revision = '0';
  private connected = true;
  private sourcesProvider?: () => unknown[];
  private configuredToken?: string;
  private authValidator: (header: string | undefined) => boolean;
  private readonly clients = new Set<WebSocketWithAlive>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    @Optional()
    @Inject(HUB_AUTH_SERVICE)
    private readonly authService?: HubAuthService,
  ) {
    this.authValidator = (header: string | undefined) => this.validateBearerHeader(header);
    this.authService?.onPendingPairingChange?.(() => {
      this.publish('pairing');
    });

    this.heartbeatTimer = setInterval(() => {
      for (const socket of this.clients) {
        if (socket.isAlive === false) {
          socket.terminate();
          this.clients.delete(socket);
        } else {
          socket.isAlive = false;
          try {
            socket.ping();
          } catch {
            socket.terminate();
            this.clients.delete(socket);
          }
        }
      }
      this.publish('heartbeat');
    }, 5000);
    this.heartbeatTimer.unref();
  }

  private validateBearerHeader(header: string | undefined): boolean {
    if (!header || !header.startsWith('Bearer ')) return false;
    const token = header.slice(7).trim();
    if (!token) return false;
    if (this.configuredToken) {
      const expected = `Bearer ${this.configuredToken}`;
      if (header.length === expected.length) {
        try {
          if (timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
            return true;
          }
        } catch {
          // Fall through to authService
        }
      }
    }
    if (this.authService && typeof this.authService.verifyToken === 'function') {
      return Boolean(this.authService.verifyToken(token));
    }
    return false;
  }

  configure(options: HubLiveOptions): void {
    if (options.token) {
      this.configuredToken = options.token;
      this.authValidator = (header: string | undefined) => this.validateBearerHeader(header);
    }
    if (options.authValidator) {
      this.authValidator = options.authValidator;
    }
    if (options.heartbeatMs) {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.publish('heartbeat');
      }, options.heartbeatMs);
      this.heartbeatTimer.unref();
    }
  }

  publish(topic: string, options?: LivePublishOptions): void {
    if (this.clients.size === 0) {
      this.sequence += 1;
      return;
    }
    const state = this.getState(topic, options);
    let payload = JSON.stringify(state);
    if (state.stateChanges && Buffer.byteLength(payload, 'utf8') > MAX_LIVE_FRAME_BYTES) {
      const { stateChanges: _omitted, ...compact } = state;
      payload = JSON.stringify(compact);
    }
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.clients.delete(socket);
        continue;
      }
      if (socket.bufferedAmount > 65536) {
        socket.terminate();
        this.clients.delete(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        socket.terminate();
        this.clients.delete(socket);
      }
    }
  }

  getState(topic = 'home', options?: LivePublishOptions): LiveState {
    this.sequence += 1;
    const stateChanges = redactStateChanges(options?.stateChanges);
    return {
      protocol: 1,
      instance: this.instance,
      sequence: this.sequence,
      topic,
      revision: this.revision,
      connected: this.connected,
      ...(this.sourcesProvider ? { sources: this.sourcesProvider() } : {}),
      ...(stateChanges ? { stateChanges } : {}),
      ...(options?.registryChanged !== undefined
        ? { registryChanged: options.registryChanged }
        : {}),
    };
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.publish('home');
  }

  setRevision(revision: string): void {
    this.revision = revision;
    this.publish('preferences');
  }

  setSourcesProvider(provider: () => unknown[]): void {
    this.sourcesProvider = provider;
  }

  setAuthValidator(validator: (header: string | undefined) => boolean): void {
    this.authValidator = validator;
  }

  authorize(header: string | undefined): boolean {
    return this.authValidator(header);
  }

  addClient(socket: WebSocketWithAlive): void {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    socket.on('close', () => {
      this.clients.delete(socket);
    });
    this.clients.add(socket);
  }

  removeClient(socket: WebSocketWithAlive): void {
    this.clients.delete(socket);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const socket of this.clients) {
      try {
        socket.terminate();
      } catch {}
    }
    this.clients.clear();
  }
}
