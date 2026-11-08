/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  createEufyTalkback,
  type EufyCameraDescriptor,
  type EufyDeviceRegistry,
  type EufyEndpointConfig,
} from '@haus/kitsune/native';
import { spawnTalkbackPipe } from '@haus/media';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

const privateIp = (host: string): boolean =>
  (isIP(host) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) ||
  host === '::1' ||
  (isIP(host) === 6 && /^(fc|fd)/i.test(host));

export function talkbackAddress(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'rtmp:' &&
      !url.hash &&
      String(value).length <= 2048 &&
      (privateIp(host) || host === 'localhost' || /\.(local|lan|home\.arpa)$/.test(host))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function customTalkback(
  value: unknown,
  registry: { states: { entity_id: string; state: string }[] },
): { url?: string; entityId?: string } | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  )
    throw new Error('invalid_talkback_source');
  const candidate = value as { url?: unknown; entityId?: unknown };
  if (typeof candidate.url === 'string' && talkbackAddress(candidate.url))
    return { url: candidate.url };
  if (
    typeof candidate.entityId === 'string' &&
    /^(sensor|text|input_text)\.[a-z0-9_]+$/.test(candidate.entityId) &&
    registry.states.some(
      (state) => state.entity_id === candidate.entityId && talkbackAddress(state.state),
    )
  )
    return { entityId: candidate.entityId };
  throw new Error('invalid_talkback_source');
}

export interface TalkbackCamera extends EufyCameraDescriptor {
  id: string;
  aliases?: string[];
  talkback?: { entityId?: string; url?: string } | null;
  nativeProvider?: unknown;
  nativeTalkback?: string;
}

/** A dedicated HA talkback sensor is authoritative; streaming support alone is not. */
export function talkbackTarget(
  camera: TalkbackCamera,
  registry: { states: { entity_id: string; state: string }[] },
): string | null {
  if (camera.talkback) {
    const value = camera.talkback.entityId
      ? registry.states.find((state) => state.entity_id === camera.talkback?.entityId)?.state
      : camera.talkback.url;
    return talkbackAddress(value);
  }
  if (camera.nativeProvider)
    return camera.nativeTalkback ? talkbackAddress(camera.nativeTalkback) : null;
  const stems = [camera.id, ...(camera.aliases ?? [])].map((id) =>
    id.split('.')[1].replace(/_internal$/, ''),
  );
  const sensor = registry.states.find((state) =>
    stems.some((stem) => state.entity_id === `sensor.${stem}_talkback_rtmp_stream`),
  );
  if (!sensor) return null;
  try {
    const url = new URL(sensor.state);
    const host = url.hostname;
    const local =
      (isIP(host) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.lan');
    return url.protocol === 'rtmp:' && local && url.pathname.startsWith('/talk/') ? url.href : null;
  } catch {
    return null;
  }
}

export function createTalkback({
  spawnProcess = spawn,
  config = {},
}: {
  spawnProcess?: typeof spawn;
  config?: EufyEndpointConfig;
} = {}) {
  const eufy = createEufyTalkback(config);
  const active = new Map<string, () => void>();
  const stopAll = () => {
    eufy.stopAll();
    for (const stop of active.values()) stop();
  };
  const stream = async (
    camera: TalkbackCamera,
    registry: EufyDeviceRegistry & { states: { entity_id: string; state: string }[] },
    req: IncomingMessage,
    res: ServerResponse,
  ) => {
    const target = talkbackTarget(camera, registry);
    if (camera.nativeProvider && !target) throw Error('talkback_unavailable');
    if (camera.talkback && !target) throw new Error('invalid_talkback_source');
    if (!target) {
      if (
        req.headers['x-haus-client'] !== '1' ||
        !String(req.headers['content-type']).startsWith('audio/webm')
      )
        throw new Error('invalid_audio');
      return eufy.stream(camera, registry, req, res);
    }
    if (active.has(camera.id)) throw new Error('talkback_busy');
    if (req.destroyed || res.destroyed) throw new Error('talkback_cancelled');
    if (
      req.headers['x-haus-client'] !== '1' ||
      !String(req.headers['content-type']).startsWith('audio/webm')
    )
      throw new Error('invalid_audio');
    const host = new URL(target).hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || addresses.some((item) => !privateIp(item.address)))
      throw new Error('invalid_private_talkback_address');
    if (active.has(camera.id)) throw new Error('talkback_busy');
    if (req.destroyed || res.destroyed) throw new Error('talkback_cancelled');
    const resolvedTarget = new URL(target);
    resolvedTarget.hostname = addresses[0].address.includes(':')
      ? `[${addresses[0].address}]`
      : addresses[0].address;
    const child = spawnTalkbackPipe({
      targetUrl: resolvedTarget.href,
      spawnProcess,
    });
    let closed = false;
    const stop = () => {
      if (closed) return;
      closed = true;
      active.delete(camera.id);
      clearTimeout(timer);
      child.stdin?.destroy();
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 1500).unref();
    };
    const timer = setTimeout(stop, 60000);
    timer.unref();
    active.set(camera.id, stop);
    child.stderr?.on('data', () => {}); // Camera credentials and FFmpeg command lines never enter logs.
    child.on('error', () => {
      stop();
      res.destroy();
    });
    child.on('close', () => {
      stop();
      if (!res.destroyed) res.end();
    });
    req.on('aborted', stop);
    res.on('close', stop);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4_000_000) {
        stop();
        req.destroy();
      }
    });
    try {
      if (child.stdin) await pipeline(req, child.stdin);
    } catch {
      stop();
    }
  };
  return {
    stream,
    stopAll,
    available: async (
      camera: TalkbackCamera,
      registry: EufyDeviceRegistry & { states: { entity_id: string; state: string }[] },
    ) =>
      camera.talkback || camera.nativeProvider
        ? Boolean(talkbackTarget(camera, registry))
        : Boolean(talkbackTarget(camera, registry)) || (await eufy.available(camera, registry)),
  };
}
