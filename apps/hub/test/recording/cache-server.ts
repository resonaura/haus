/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parseRange } from '../../src/events/range.js';
import type { RecordingStore } from '../../src/events/recording.store.js';
import type { Cluster } from '../../src/cluster/cluster.js';

export interface CacheTestServerOptions {
  config: { apiToken: string };
  store: RecordingStore;
  cluster?: Cluster;
  recorder?: {
    preparePlayback?: (event: unknown) => Promise<string>;
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createCacheTestServer(options: CacheTestServerOptions): Server {
  const { config, store, cluster, recorder } = options;

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== 'Bearer ' + config.apiToken) {
      res.writeHead(401).end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    const eventMatch =
      /^\/api\/events\/([a-f0-9-]{36})(?:\/(video|thumbnail|prepare|prepare-next|source|original|repair))?$/.exec(
        path,
      );
    if (!eventMatch || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(404).end();
      return;
    }

    const eventId = eventMatch[1]!;
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
      releaseEvent = await store.pinMedia(eventId, signal);
      const event = await store.get(eventId);
      if (!event) {
        json(res, 404, { error: 'event_not_found' });
        return;
      }
      if (!eventMatch[2]) {
        json(res, 200, event);
        return;
      }
      if (event.status !== 'ready') {
        json(res, 409, { error: 'video_not_ready' });
        return;
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
          return;
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
          return;
        } finally {
          archived.release();
        }
      }

      const type = original || eventMatch[2] === 'video' ? 'mp4' : 'jpg';
      const prepared =
        type === 'mp4' && !original && recorder?.preparePlayback
          ? await recorder.preparePlayback(event)
          : undefined;
      const file = typeof prepared === 'string' ? prepared : store.path(event.id, type);

      let info;
      try {
        info = await stat(file);
      } catch {
        json(res, 404, { error: 'media_not_found' });
        return;
      }

      let range;
      try {
        range = parseRange(req.headers.range, info.size);
      } catch {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }

      const headers: Record<string, string | number> = {
        'Content-Type': type === 'mp4' ? 'video/mp4' : 'image/jpeg',
        'Content-Length': range.end - range.start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      };
      if (range.partial)
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
      res.writeHead(range.partial ? 206 : 200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      await pipeline(createReadStream(file, { start: range.start, end: range.end }), res).catch(
        () => {},
      );
    } finally {
      releaseEvent?.();
      res.off('close', closeRequest);
      signal.removeEventListener('abort', abortResponse);
    }
  });
}
