/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parseRange } from '../../events/index.js';
import { requestBody } from '../../http/index.js';
import { json, type CreateApiContext } from './types.js';

export async function handleEventItemRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  ctx: CreateApiContext,
): Promise<boolean> {
  const { store, recorder, cluster, preparation } = ctx;
  const eventMatch =
    /^\/api\/events\/([a-f0-9-]{36})(?:\/(video|thumbnail|prepare|prepare-next|source|original|repair))?$/.exec(
      path,
    );
  if (
    !eventMatch ||
    !(
      (['GET', 'HEAD'].includes(req.method ?? '') && eventMatch[2] !== 'repair') ||
      (req.method === 'POST' && eventMatch[2] === 'repair')
    )
  ) {
    return false;
  }

  const requestAbort = new AbortController();
  const signal = cluster?.abort?.signal
    ? AbortSignal.any([requestAbort.signal, cluster.abort.signal])
    : requestAbort.signal;
  const closeRequest = () => requestAbort.abort();
  const abortResponse = () => res.destroy();
  res.once('close', closeRequest);
  signal.addEventListener('abort', abortResponse, { once: true });
  let releaseEvent: (() => void) | undefined;
  try {
    releaseEvent = await store.pinMedia(eventMatch[1]!, signal);
    const event = await store.get(eventMatch[1]!);
    if (!event) {
      json(res, 404, { error: 'event_not_found' });
      return true;
    }
    if (!eventMatch[2]) {
      json(res, 200, event);
      return true;
    }
    if (event.status !== 'ready') {
      json(res, 409, { error: 'video_not_ready' });
      return true;
    }
    if (eventMatch[2] === 'source') {
      json(res, 200, {
        source: (await cluster?.source(event)) ?? null,
      });
      return true;
    }
    if (['prepare', 'prepare-next', 'repair'].includes(eventMatch[2])) {
      if (eventMatch[2] === 'repair') {
        const body = await requestBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
          throw new Error('invalid_repair_request');
      }
      const options = {
        forceCompatibility:
          eventMatch[2] === 'repair' || req.headers['x-haus-compatibility-repair'] === '1',
      };
      if (eventMatch[2] === 'repair' || req.headers['x-haus-async-prepare'] === '1') {
        const state = preparation.status(
          event as Parameters<typeof preparation.status>[0],
          eventMatch[2] === 'prepare-next' ? 0 : 20,
          options,
        );
        if (state === 'preparing') {
          json(res, 202, { status: state, retryAfterMs: 1000 });
          return true;
        }
        if (state !== 'ready') {
          json(res, 503, { error: 'preparation_failed' });
          return true;
        }
        json(res, 200, await store.get(event.id));
        return true;
      }
      await recorder.preparePlayback!(event, eventMatch[2] === 'prepare-next' ? 0 : 20, options);
      json(res, 200, await store.get(event.id));
      return true;
    }
    const original = eventMatch[2] === 'original';
    const variant = original || !event.playbackBytes ? 'original' : 'prepared';
    const local = variant === 'original' ? event.localOriginal : event.localPlayback;
    const knownArchive =
      (original || eventMatch[2] === 'video') &&
      local &&
      (await store.archive.hasVerifiedLocation(
        event.id,
        variant,
        variant === 'prepared' ? event.playbackVersion : 0,
      ));
    const missingLocal =
      knownArchive &&
      (await stat(store.path(event.id, variant === 'prepared' ? 'playback.mp4' : 'mp4')).then(
        () => false,
        (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
      ));
    if (missingLocal) await store.setLocal(event.id, variant, false);
    if (
      (original || eventMatch[2] === 'video') &&
      (!local || missingLocal) &&
      cluster?.archiveMedia
    ) {
      const archived = await cluster.archiveMedia(
        event,
        variant,
        req.headers.range,
        signal,
        req.method,
      );
      if (!archived) {
        json(res, 503, { error: 'archived_media_unavailable' });
        return true;
      }
      try {
        const remote = archived.response;
        const headers: Record<string, string> = {
          'Content-Type': 'video/mp4',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=3600',
        };
        for (const key of ['content-length', 'content-range', 'accept-ranges']) {
          const val = remote.headers.get(key);
          if (val) headers[key] = val;
        }
        res.writeHead(remote.status, headers);
        if (req.method === 'HEAD') {
          await remote.body?.cancel();
          res.end();
        } else {
          res.flushHeaders();
          if (remote.body) await pipeline(Readable.from(remote.body), res).catch(() => {});
          else res.end();
        }
        return true;
      } finally {
        archived.release();
      }
    }
    const type = original || eventMatch[2] === 'video' ? 'mp4' : 'jpg';
    const prepared =
      type === 'mp4' && !original && recorder.preparePlayback
        ? await recorder.preparePlayback(event)
        : undefined;
    const file = typeof prepared === 'string' ? prepared : store.path(event.id, type);
    if (type === 'mp4' && !original && cluster && req.method === 'GET') {
      const remote = await cluster.media(await store.get(event.id), req.headers.range, signal);
      if (remote) {
        const headers: Record<string, string> = {
          'Content-Type': 'video/mp4',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=3600',
        };
        for (const key of ['content-length', 'content-range', 'accept-ranges']) {
          const val = remote.headers.get(key);
          if (val) headers[key] = val;
        }
        res.writeHead(remote.status, headers);
        if (remote.body) await pipeline(Readable.from(remote.body), res).catch(() => {});
        else res.end();
        return true;
      }
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      json(res, 404, { error: 'media_not_found' });
      return true;
    }
    let range;
    try {
      range = parseRange(req.headers.range, info.size);
    } catch {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
      return true;
    }
    const headers: Record<string, string | number> = {
      'Content-Type': type === 'mp4' ? 'video/mp4' : 'image/jpeg',
      'Content-Length': range.end - range.start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
    res.writeHead(range.partial ? 206 : 200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await pipeline(createReadStream(file, { start: range.start, end: range.end }), res).catch(
      () => {},
    );
    return true;
  } finally {
    releaseEvent?.();
    res.off('close', closeRequest);
    signal.removeEventListener('abort', abortResponse);
  }
}
