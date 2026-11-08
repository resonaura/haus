/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
  directRecordingInput,
  type RecordingInputCamera,
  type RecordingInputEntity,
  type RecordingInputState,
} from './recording-input.js';

export interface HaNodeClientConfig {
  ws: string;
  base: string;
  token: string;
  [key: string]: unknown;
}

export interface HaNodeRecordingInput {
  url: string;
  kind: 'rtsp' | 'ha';
  token?: string;
  inputArguments: string[];
}

export class HaClient extends EventEmitter {
  config: HaNodeClientConfig;
  id = 0;
  pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  connected = false;
  stopped = false;
  inputRegistry: { states: RecordingInputState[]; entities: RecordingInputEntity[] } = {
    states: [],
    entities: [],
  };
  retry = 0;
  socket?: WebSocket;
  reconnect?: ReturnType<typeof setTimeout>;

  constructor(config: HaNodeClientConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.stopped || this.socket) return;
    const socket = new WebSocket(this.config.ws, {
      maxPayload: 32 * 1024 * 1024,
    });
    this.socket = socket;
    const timeout = setTimeout(() => socket.terminate(), 15000);
    socket.on('message', (bytes) => {
      let data: {
        type?: string;
        id?: number;
        success?: boolean;
        result?: unknown;
        error?: { code?: string };
        event?: unknown;
      };
      try {
        data = JSON.parse(bytes.toString());
      } catch {
        return;
      }
      if (data.type === 'auth_required')
        socket.send(JSON.stringify({ type: 'auth', access_token: this.config.token }));
      else if (data.type === 'auth_ok') {
        clearTimeout(timeout);
        this.connected = true;
        this.retry = 0;
        void this.request({
          type: 'subscribe_events',
          event_type: 'state_changed',
        }).catch(() => {});
        for (const event_type of [
          'entity_registry_updated',
          'device_registry_updated',
          'area_registry_updated',
        ])
          void this.request({ type: 'subscribe_events', event_type }).catch(() => {});
        this.emit('ready');
      } else if (data.type === 'auth_invalid') {
        socket.terminate();
        this.emit('status', 'Authentication rejected');
      } else if (data.type === 'result' && typeof data.id === 'number') {
        const item = this.pending.get(data.id);
        if (!item) return;
        this.pending.delete(data.id);
        clearTimeout(item.timer);
        if (data.success) item.resolve(data.result);
        else item.reject(new Error(String(data.error?.code || 'ha_error')));
      } else if (data.type === 'event' && data.event) this.emit('event', data.event);
    });
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) socket.terminate();
      else {
        alive = false;
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }
    }, 25000);
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.connected = false;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('ha_disconnected'));
      }
      this.pending.clear();
      this.emit('status', 'Reconnecting');
      if (!this.stopped)
        this.reconnect = setTimeout(
          () => this.start(),
          Math.min(30000, 1000 * 2 ** Math.min(this.retry++, 5)),
        );
    });
  }

  request(message: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('ha_disconnected'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('ha_timeout'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ ...message, id }));
    });
  }

  async registry(): Promise<{
    states: RecordingInputState[];
    entities: RecordingInputEntity[];
    devices: unknown[];
    areas: unknown[];
  }> {
    const [states, entities, devices, areas] = (await Promise.all([
      this.request({ type: 'get_states' }),
      this.request({ type: 'config/entity_registry/list' }),
      this.request({ type: 'config/device_registry/list' }),
      this.request({ type: 'config/area_registry/list' }),
    ])) as [RecordingInputState[], RecordingInputEntity[], unknown[], unknown[]];
    this.inputRegistry = { states, entities };
    return { states, entities, devices, areas };
  }

  primaryRecordingInput(camera: RecordingInputCamera): HaNodeRecordingInput | undefined {
    const direct = directRecordingInput(
      camera,
      this.inputRegistry?.states ?? [],
      this.inputRegistry?.entities ?? [],
    );
    return direct
      ? {
          url: direct,
          kind: 'rtsp',
          inputArguments: ['-rtsp_transport', 'tcp'],
        }
      : undefined;
  }

  async recordingInput(
    camera: RecordingInputCamera,
    allowDirect = true,
  ): Promise<HaNodeRecordingInput> {
    return (
      (allowDirect && this.primaryRecordingInput(camera)) || {
        url: await this.stream(camera.id),
        kind: 'ha',
        token: this.config.token,
        inputArguments: ['-live_start_index', '-1', '-re'],
      }
    );
  }

  async stream(cameraId: string): Promise<string> {
    const result = (await this.request({
      type: 'camera/stream',
      entity_id: cameraId,
      format: 'hls',
    })) as { url: string };
    const base = new URL(this.config.base);
    const url = new URL(result.url, base);
    if (url.origin !== base.origin || !/^\/api\/hls\/[a-zA-Z0-9_-]+\//.test(url.pathname))
      throw new Error('unsupported_stream_address');
    if (base.pathname !== '/') url.pathname = base.pathname.replace(/\/$/, '') + url.pathname;
    return url.href;
  }

  async media(value: string): Promise<Response> {
    const base = new URL(this.config.base),
      url = new URL(value);
    const prefix = base.pathname.replace(/\/$/, '') + '/api/hls/';
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(prefix) ||
      url.username ||
      url.password
    )
      throw new Error('invalid_stream_address');
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.config.token}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  }

  async snapshot(cameraId: string): Promise<{ buffer: Buffer; mime: string }> {
    const result = await fetch(
      `${this.config.base}/api/camera_proxy/${encodeURIComponent(cameraId)}`,
      {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    if (!result.ok) throw new Error('snapshot_unavailable');
    const mime = result.headers.get('content-type')?.split(';')[0] ?? '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
      throw new Error('invalid_snapshot');
    const buffer = Buffer.from(await result.arrayBuffer());
    if (buffer.length > 6 * 1024 * 1024) throw new Error('snapshot_too_large');
    return { buffer, mime };
  }

  async migrationScene(id: string): Promise<unknown> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error('invalid_scene_id');
    const response = await fetch(`${this.config.base}/api/config/scene/config/${id}`, {
      headers: { Authorization: `Bearer ${this.config.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) throw Error('migration_reference_scan_incomplete');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw Error('migration_reference_scan_too_large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.socket?.terminate();
  }
}
