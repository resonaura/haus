/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { detectionKind, type DiscoveryState } from '@haus/ha/node/discovery';
import { nodeRequest } from '@haus/servers';
import { motionSettings, customTalkback } from '../../camera/index.js';
import { homekitSettings } from '../../homekit/index.js';
import { parseRange } from '../../events/index.js';
import { requestBody } from '../../http/index.js';
import { json, publicCamera, type CreateApiContext } from './types.js';

export async function handleCameraAndEventRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  ctx: CreateApiContext,
): Promise<boolean> {
  const {
    store,
    recorder,
    getRegistry,
    refresh,
    cluster,
    backups,
    warm,
    motion,
    activity,
    cameraSessions,
    homekit,
    operating,
    snapshots,
    talkback,
    preparation,
    cameraAccess,
  } = ctx;

  if (req.method === 'GET' && path === '/api/cameras') {
    json(res, 200, {
      cameras: await Promise.all(
        getRegistry().cameras.map(async (camera) => ({
          ...publicCamera(camera),
          ...(motion ? { motionStatus: motion.status(camera.id) } : {}),
          ...(activity ? { activity: activity.status(camera.id) } : {}),
          ...(homekit ? { homekit: homekit.status(camera.id) } : {}),
          ...(operating ? { operating: operating.read(camera.id) } : {}),
          talkAvailable: await talkback.available(camera, getRegistry()),
        })),
      ),
    });
    return true;
  }
  if (req.method === 'GET' && path === '/api/detectors') {
    json(res, 200, {
      detectors: getRegistry()
        .states.filter((state) => detectionKind(state as DiscoveryState))
        .map((state) => ({
          id: state.entity_id,
          name: state.attributes.friendly_name ?? state.entity_id,
          kind: detectionKind(state as DiscoveryState),
        })),
    });
    return true;
  }
  if (req.method === 'GET' && path === '/api/events/calendar') {
    const requestedId = url.searchParams.get('camera_id');
    if (!/^camera\.[a-z0-9_]+$/.test(requestedId ?? '')) throw new Error('invalid_camera');
    const boundaries = (url.searchParams.get('boundaries') ?? '').split(',').map(Number);
    if (
      boundaries.length < 2 ||
      boundaries.length > 32 ||
      boundaries.some(
        (at, index) =>
          !Number.isSafeInteger(at) ||
          at < 0 ||
          (index > 0 &&
            (at <= boundaries[index - 1]! || at - boundaries[index - 1]! > 48 * 3600000)),
      )
    )
      throw new Error('invalid_calendar');
    const reqId = requestedId!;
    const cameraId =
      getRegistry().cameras.find(
        (item) => item.id === reqId || item.aliases?.includes(reqId),
      )?.id ?? reqId;
    json(res, 200, {
      days: await store.recordedDays({ cameraId, boundaries }),
    });
    return true;
  }
  if (req.method === 'GET' && path === '/api/events') {
    const cameraId = url.searchParams.get('camera_id') || undefined;
    if (cameraId && !/^camera\.[a-z0-9_]+$/.test(cameraId)) throw new Error('invalid_camera');
    const number = (key: string, fallback: number) => {
      const raw = url.searchParams.get(key);
      const value = raw === null ? fallback : Number(raw);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_filter');
      return value;
    };
    const kind = url.searchParams.get('kind') || undefined;
    const status = url.searchParams.get('status') || undefined;
    if (status && !['ready', 'failed', 'interrupted', 'recording'].includes(status))
      throw new Error('invalid_status');
    if (kind && !['motion', 'person', 'pet', 'vehicle', 'doorbell', 'manual'].includes(kind))
      throw new Error('invalid_kind');
    const direction = url.searchParams.get('direction') ?? 'older';
    if (!['older', 'newer'].includes(direction)) throw new Error('invalid_direction');
    const filters = {
      direction,
      cameraId: cameraId
        ? (getRegistry().cameras.find((item) => item.id === cameraId || item.aliases?.includes(cameraId))?.id ?? cameraId)
        : undefined,
      from: number('from', 0),
      to: number('to', Date.now() + 60000),
      limit: Math.min(200, Math.max(1, number('limit', 60))),
      cursor: url.searchParams.get('cursor') || undefined,
      kind,
      status,
    };
    json(res, 200, { ...(await store.list(filters)), availability: await store.availability(filters) });
    return true;
  }
  const cameraMatch =
    /^\/api\/cameras\/(camera\.[a-z0-9_]+)(?:\/(record|snapshot|talk|warm|operating|viewer(?:\/close)?|homekit(?:\/(?:pair|close|reset))?))?$/.exec(path);
  if (cameraMatch) {
    const requestedId = cameraMatch[1]!;
    const camera = getRegistry().cameras.find((item) => item.id === requestedId || item.aliases?.includes(requestedId));
    const id = camera?.id as string | undefined;
    if (!camera || !id) {
      json(res, 404, { error: 'camera_not_found' });
      return true;
    }
    if (operating && req.method === 'POST' && cameraMatch[2] === 'operating') {
      const input = (await requestBody(req)) as Record<string, unknown>;
      if (
        Object.keys(input).sort().join(',') !== 'control,entityId,value' ||
        !['indicator', 'nightVision'].includes(String(input.control)) ||
        typeof input.entityId !== 'string' ||
        typeof input.value !== 'boolean'
      )
        throw Error('invalid_camera_control');
      await operating.write(id, input.control, input.entityId, input.value);
      json(res, 200, { accepted: true });
      return true;
    }
    if (homekit && req.method === 'POST' && cameraMatch[2]?.startsWith('homekit')) {
      const input = (await requestBody(req)) as Record<string, unknown>;
      if (cameraMatch[2] === 'homekit/pair') {
        if (Object.keys(input).length) throw Error('invalid_homekit_pairing');
        json(res, 200, await homekit.pairing(id));
        return true;
      }
      if (cameraMatch[2] === 'homekit/close' || cameraMatch[2] === 'homekit/reset') {
        if (Object.keys(input).length) throw Error('invalid_homekit_pairing');
        const action = cameraMatch[2] === 'homekit/close' ? 'close' : 'reset';
        const status = await homekit.managePairing(id, action);
        if (action === 'reset') backups?.markChanged();
        json(res, 200, status);
        return true;
      }
      const settings = homekitSettings(input);
      if (
        !['auto', 'home'].includes(settings.processor) &&
        !cluster
          ?.nodes()
          .some(
            (node: { id: string; roles: string[] }) =>
              node.id === settings.processor && node.roles.includes('stream'),
          )
      )
        throw Error('invalid_homekit_processor');
      const overrides = await store.overrides();
      await store.setCamera(id, { ...overrides[id], homekit: settings });
      backups?.markChanged();
      await homekit.tick();
      json(res, 200, homekit.status(id));
      return true;
    }
    if (cameraSessions && req.method === 'POST' && cameraMatch[2]?.startsWith('viewer')) {
      const input = (await requestBody(req)) as Record<string, unknown>;
      json(
        res,
        200,
        cameraMatch[2] === 'viewer/close'
          ? await cameraSessions.closeViewer(id, input.owner, input.viewerId)
          : await cameraSessions.viewer(camera, input.owner, input.viewerId, input.offer),
      );
      return true;
    }
    if (warm && req.method === 'POST' && cameraMatch[2] === 'warm') {
      const input = (await requestBody(req)) as Record<string, unknown>;
      if (typeof input.active !== 'boolean') throw new Error('invalid_warm_session');
      json(res, 200, await warm.touch(camera, input.owner, input.active, input.preview === true));
      return true;
    }
    if (req.method === 'POST' && cameraMatch[2] === 'talk') {
      await talkback.stream(camera, getRegistry(), req, res);
      return true;
    }
    if (req.method === 'GET' && cameraMatch[2] === 'snapshot') {
      if (!snapshots) throw Error('snapshot_unavailable');
      const image = await snapshots.snapshot(camera);
      res
        .writeHead(200, {
          'Content-Type': image.mime,
          'Cache-Control': 'no-store',
          'X-Haus-Snapshot-Stale': image.stale ? '1' : '0',
          'X-Haus-Snapshot-Captured-At': String(image.at),
        })
        .end(image.buffer);
      return true;
    }
    if (req.method === 'POST' && cameraMatch[2] === 'record') {
      await requestBody(req);
      json(res, 201, await recorder.trigger(id));
      return true;
    }
    if (req.method === 'PATCH' && !cameraMatch[2]) {
      const body = (await requestBody(req)) as Record<string, unknown>;
      const overrides = await store.overrides();
      const old = overrides[id] ?? {};
      const next: Record<string, unknown> = { ...old };
      if (body.talkback !== undefined) next.talkback = customTalkback(body.talkback, getRegistry());
      if (body.motionDetection !== undefined)
        next.motionDetection = motionSettings(body.motionDetection);
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') throw new Error('invalid_enabled');
        next.enabled = body.enabled;
      }
      if (body.sensorIds !== undefined) {
        if (body.sensorIds === null) delete next.sensorIds;
        else {
          if (
            !Array.isArray(body.sensorIds) ||
            body.sensorIds.length > 64 ||
            body.sensorIds.some(
              (sensor) =>
                !getRegistry().states.some(
                  (state) =>
                    state.entity_id === sensor && detectionKind(state as DiscoveryState),
                ),
            )
          )
            throw new Error('invalid_detectors');
          next.sensorIds = [...new Set(body.sensorIds)];
        }
      }
      await store.setCamera(id, next);
      backups?.markChanged();
      await refresh();
      await cameraAccess?.reconcile();
      await cameraSessions?.syncContinuity?.(true);
      json(res, 200, {
        camera: publicCamera(getRegistry().cameras.find((item) => item.id === id)),
      });
      return true;
    }
  }
  const liveMatch =
    /^\/api\/cameras\/(camera\.[a-z0-9_]+)\/live\/(index\.m3u8|segment-\d+\.ts)$/.exec(path);
  if (warm && liveMatch && req.method === 'GET') {
    const entry = warm.entries.get(liveMatch[1]!);
    if (!entry?.job) {
      json(res, 404, { error: 'stream_not_ready' });
      return true;
    }
    const response = await nodeRequest(
      entry.job.node,
      `/v1/streams/${entry.job.id}/${liveMatch[2]}`,
      { timeout: 15000 },
    );
    if (!response.ok) {
      await response.body?.cancel();
      json(res, 503, { error: 'stream_unavailable' });
      return true;
    }
    const mime = liveMatch[2]!.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    if (response.body) {
      await pipeline(Readable.from(response.body), res).catch(() => {});
    } else {
      res.end();
    }
    return true;
  }
  const eventMatch =
    /^\/api\/events\/([a-f0-9-]{36})(?:\/(video|thumbnail|prepare|prepare-next|source|original|repair))?$/.exec(
      path,
    );
  if (
    eventMatch &&
    ((['GET', 'HEAD'].includes(req.method ?? '') && eventMatch[2] !== 'repair') ||
      (req.method === 'POST' && eventMatch[2] === 'repair'))
  ) {
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
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length
          )
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
        (await stat(
          store.path(event.id, variant === 'prepared' ? 'playback.mp4' : 'mp4'),
        ).then(
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
          const remote = archived.response as Response;
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
      const file =
        type === 'mp4' && !original && recorder.preparePlayback
          ? await recorder.preparePlayback(event)
          : store.path(event.id, type);
      if (type === 'mp4' && !original && cluster && req.method === 'GET') {
        const remote = (await cluster.media(
          await store.get(event.id),
          req.headers.range,
          signal,
        )) as Response | null;
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
      if (range.partial)
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
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
  return false;
}
