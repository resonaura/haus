/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 only; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-only.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { spawnTalkbackPipe } from '@haus/media/audio';
import { eufyEndpoint, type EufyEndpointConfig } from './eufy-endpoint.js';
import {
  EufySession,
  eufySerial,
  type EufyCameraDescriptor,
  type EufyDeviceRegistry,
} from './eufy-session.js';

export interface EufyTalkbackSessionLike {
  socket?: { bufferedAmount: number };
  connect(): Promise<void>;
  command(command: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  wait(serial: string, event: string): { promise: Promise<void>; cancel: () => void };
  once(event: string, listener: () => void): unknown;
  close(): void;
}

export function createEufyTalkback(
  config: EufyEndpointConfig,
  {
    sessionFactory = (url: string): EufyTalkbackSessionLike => new EufySession(url),
    spawnProcess = spawn,
  }: {
    sessionFactory?: (url: string) => EufyTalkbackSessionLike;
    spawnProcess?: typeof spawn;
  } = {},
) {
  const endpoint = eufyEndpoint(config);
  const active = new Map<string, () => void>();
  const capabilities = new Map<string, { supported: boolean; until: number }>();

  const available = async (
    camera: EufyCameraDescriptor,
    registry: EufyDeviceRegistry,
  ): Promise<boolean> => {
    const serial = eufySerial(camera, registry);
    if (!serial) return false;
    const url = await endpoint();
    if (!url) return false;
    const key = `${url}:${serial}`;
    const cached = capabilities.get(key);
    if (cached && cached.until > Date.now()) return cached.supported;
    const session = sessionFactory(url);
    try {
      await session.connect();
      const result = await session.command('device.has_command', {
        serialNumber: serial,
        commandName: 'deviceStartTalkback',
      });
      const supported = result.exists === true;
      capabilities.set(key, {
        supported,
        until: Date.now() + 60000,
      });
      return supported;
    } catch {
      return false;
    } finally {
      session.close();
    }
  };

  const stream = async (
    camera: EufyCameraDescriptor & { id: string },
    registry: EufyDeviceRegistry,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (!(await available(camera, registry))) throw new Error('talkback_unavailable');
    if (active.has(camera.id)) throw new Error('talkback_busy');
    const serial = eufySerial(camera, registry)!;
    const url = (await endpoint())!;
    const session = sessionFactory(url);
    let child: ChildProcess | undefined;
    let closed = false;
    let ownsLive = false;
    let ownsTalk = false;
    const waits: Array<{ promise: Promise<void>; cancel: () => void }> = [];
    const stop = () => {
      closed = true;
      child?.stdin?.destroy();
      child?.kill('SIGTERM');
    };
    const timer = setTimeout(stop, 60000);
    timer.unref();
    active.set(camera.id, stop);
    req.once('aborted', stop);
    res.once('close', stop);
    const check = () => {
      if (closed || req.aborted) throw new Error('talkback_cancelled');
    };
    const start = async (command: string, event: string) => {
      const wait = session.wait(serial, event);
      waits.push(wait);
      await session.command(command, { serialNumber: serial });
      if (command === 'device.start_livestream') ownsLive = true;
      else ownsTalk = true;
      await wait.promise;
      check();
    };
    try {
      await session.connect();
      check();
      const inUse = await session.command('device.is_talkback_ongoing', {
        serialNumber: serial,
      });
      check();
      if (inUse.talkbackOngoing) throw new Error('talkback_busy');
      const live = await session.command('device.is_livestreaming', {
        serialNumber: serial,
      });
      check();
      if (!live.livestreaming) await start('device.start_livestream', 'livestream started');
      await start('device.start_talkback', 'talkback started');
      child = spawnTalkbackPipe({
        targetUrl: 'pipe:1',
        inputFormat: 'webm',
        outputFormat: 'adts',
        sampleRate: 16000,
        channels: 1,
        bitrate: '16k',
        spawnProcess,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr?.on('data', () => {});
      child.once('error', () => {
        stop();
        res.destroy();
      });
      session.once('disconnected', stop);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      let bytes = 0;
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4000000) {
          stop();
          req.destroy();
        }
      });
      const audio = (async () => {
        if (!child?.stdout) return;
        for await (const chunk of child.stdout) {
          check();
          if ((session.socket?.bufferedAmount ?? 0) > 256000) {
            throw new Error('talkback_backpressure');
          }
          await session.command('device.talkback_audio_data', {
            serialNumber: serial,
            buffer: { type: 'Buffer', data: Array.from(chunk as Uint8Array) },
          });
        }
      })();
      await Promise.all([pipeline(req, child.stdin!), audio]);
    } finally {
      stop();
      clearTimeout(timer);
      for (const wait of waits) wait.cancel();
      if (ownsTalk) {
        await session.command('device.stop_talkback', { serialNumber: serial }).catch(() => {});
      }
      if (ownsLive) {
        await session.command('device.stop_livestream', { serialNumber: serial }).catch(() => {});
      }
      session.close();
      active.delete(camera.id);
      req.off('aborted', stop);
      res.off('close', stop);
      if (!res.destroyed) res.end();
    }
  };

  return {
    available,
    stream,
    stopAll: () => {
      for (const stop of active.values()) stop();
    },
  };
}
