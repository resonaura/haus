/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import WebSocket from 'ws';
import { parseHelperLiveMessage } from '@haus/core/helper-protocol';
import type { NativeEvent } from '../shared/native';

type Surface = { url: string; cookie?: string; token?: string };
/** The credentials stay in main; renderer receives scoped invalidations only. */
export class HelperLive {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private failures = 0;
  private opening = false;
  private ready = false;
  private instance = '';
  private sequence = 0;
  private previous = '';
  constructor(
    private surface: () => Promise<Surface>,
    private scope: () => string | undefined,
    private emit: (event: NativeEvent) => void,
  ) {}
  get connected() {
    return this.ready;
  }
  start() {
    if (this.socket || this.opening || this.retry || !this.scope()) return;
    const epoch = this.epoch,
      scope = this.scope()!;
    this.opening = true;
    void this.surface()
      .then((surface) => {
        if (epoch !== this.epoch || scope !== this.scope()) return;
        const url = new URL('api/live', surface.url);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(url, {
          headers: {
            'X-Haus-Client': '1',
            ...(surface.cookie ? { Cookie: `ingress_session=${surface.cookie}` } : {}),
            ...(surface.token ? { Authorization: `Bearer ${surface.token}` } : {}),
          },
          handshakeTimeout: 10000,
          maxPayload: 65536,
          perMessageDeflate: false,
          followRedirects: false,
        });
        this.socket = socket;
        const touch = () => {
          clearTimeout(this.heartbeat);
          this.heartbeat = setTimeout(() => socket.terminate(), 50000);
        };
        socket.on('ping', touch);
        socket.on('message', (bytes) => {
          if (epoch !== this.epoch || scope !== this.scope()) return;
          let data;
          try {
            data = JSON.parse(bytes.toString());
          } catch {
            return socket.terminate();
          }
          const message = parseHelperLiveMessage(data);
          if (!message) return socket.terminate();
          if (message.instance === this.instance && message.sequence <= this.sequence) return;
          const reconnected = !this.ready;
          this.ready = true;
          this.failures = 0;
          this.instance = message.instance;
          this.sequence = message.sequence;
          touch();
          const signature = `${message.instance}:${message.sequence}:${message.topic}:${message.revision}:${message.connected}:${JSON.stringify(message.sources)}`;
          if (reconnected || signature !== this.previous) {
            this.previous = signature;
            if (message.topic !== 'heartbeat' || reconnected) {
              this.emit({
                type: 'helper-live',
                scope,
                online: true,
                haConnected: message.connected,
                revision: message.revision,
                topic: message.topic === 'heartbeat' ? 'home' : message.topic,
                ...(message.sources ? { sources: message.sources } : {}),
              });
            }
          }
        });
        socket.on('error', () => {});
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          socket.terminate();
        });
        socket.on('close', () => {
          if (this.socket !== socket) return;
          this.socket = undefined;
          clearTimeout(this.heartbeat);
          if (this.ready) this.emit({ type: 'helper-live', scope, online: false });
          this.ready = false;
          this.schedule(epoch);
        });
      })
      .catch(() => this.schedule(epoch))
      .finally(() => {
        if (epoch === this.epoch) this.opening = false;
      });
  }
  private schedule(epoch: number) {
    if (epoch !== this.epoch || this.retry || !this.scope()) return;
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        this.start();
      },
      Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)) + Math.random() * 300,
    );
  }
  stop() {
    ++this.epoch;
    this.opening = false;
    this.ready = false;
    this.previous = '';
    this.instance = '';
    this.sequence = 0;
    this.failures = 0;
    clearTimeout(this.retry);
    clearTimeout(this.heartbeat);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
  }
}
