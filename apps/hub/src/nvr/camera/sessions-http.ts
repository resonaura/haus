/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { describeRecording } from '@haus/media/recording';
import { pipeMediaFile } from '@haus/media/pipeline';
import { body, json } from '../http.js';
import { parseRange } from '../blobs.js';
import { captureMetadata } from './recordings.js';
import type { CameraSessions, CameraSessionsSession } from './sessions.js';
import { viewerSessionId } from './viewer.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function handleCameraSessions(
  service: CameraSessions,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (path === '/v1/cameras/sessions' && req.method === 'POST') {
    json(res, 201, await service.acquire(await body(req, 8192)));
    return true;
  }
  const match =
    /^\/v1\/cameras\/sessions\/([a-f0-9-]{36})(?:\/(lease|webrtc(?:\/candidate)?|viewers\/([a-f0-9-]{36})|recordings(?:\/([a-f0-9-]{36})(?:\/(status|media))?)?))?$/.exec(
      path,
    );
  if (!match) return false;
  const method = req.method;
  if (method !== 'POST' && method !== 'DELETE') {
    json(res, 405, { error: 'method_not_allowed' });
    return true;
  }
  const input = await body(req, 72000);
  const inputRecord = isRecord(input) ? input : {};
  const inputOwner = typeof inputRecord.owner === 'string' ? inputRecord.owner : '';
  const inputOffer = typeof inputRecord.offer === 'string' ? inputRecord.offer : '';
  const inputEventId = typeof inputRecord.eventId === 'string' ? inputRecord.eventId : '';
  const inputStartAt = typeof inputRecord.startAt === 'number' ? inputRecord.startAt : 0;
  const inputEndAt = typeof inputRecord.endAt === 'number' ? inputRecord.endAt : 0;
  const inputEvent = inputRecord.event;
  const inputViewerId = typeof inputRecord.viewerId === 'string' ? inputRecord.viewerId : '';
  const found = service.sessions.get(match[1]);
  const recordJob = match[4] && found ? found.ring?.jobs.get(match[4]) : undefined;
  let session: CameraSessionsSession;
  if (recordJob && found && recordJob.owner === inputOwner) session = found;
  else session = service.owned(match[1], inputOwner);
  if (!match[2] && req.method === 'DELETE') {
    await service.release(session.id, inputOwner);
    json(res, 200, { released: true });
    return true;
  }
  if (match[2] === 'lease' && req.method === 'POST') {
    json(res, 200, service.renew(session.id, inputOwner));
    return true;
  }
  if (match[2] === 'webrtc' && req.method === 'POST') {
    json(res, 200, await service.offer(session.id, inputOwner, inputOffer));
    return true;
  }
  if (match[2] === 'webrtc/candidate' && req.method === 'POST') {
    const viewer = service.engine.viewers.get(inputViewerId);
    if (viewerSessionId(viewer) !== session.id) throw new Error('camera_session_not_found');
    service.engine.candidate(inputViewerId, inputOwner, inputRecord.candidate);
    json(res, 200, { accepted: true });
    return true;
  }
  if (match[3] && req.method === 'DELETE') {
    const viewerId = match[3];
    if (viewerSessionId(service.engine.viewers.get(viewerId)) !== session.id)
      throw new Error('camera_session_not_found');
    service.engine.closeViewer(viewerId, inputOwner);
    json(res, 200, { closed: true });
    return true;
  }
  if (match[2] === 'recordings' && req.method === 'POST') {
    const prior = session.ring?.jobs.get(inputEventId);
    if (prior && prior.owner !== inputOwner) throw new Error('camera_recording_not_found');
    const metadata = captureMetadata(inputEvent, session.cameraId, inputStartAt, inputEndAt);
    if (metadata && metadata.id !== inputEventId) throw new Error('invalid_camera_recording');
    const ring = session.ring;
    if (!ring) throw new Error('camera_session_not_found');
    const result = await ring.record({
      eventId: inputEventId,
      startAt: inputStartAt - session.preRollSeconds * 1000,
      endAt: inputEndAt,
      metadata,
    });
    const job = ring.jobs.get(inputEventId);
    if (!job) throw new Error('camera_recording_not_found');
    job.owner = inputOwner;
    json(res, 202, result);
    return true;
  }
  if (match[4]) {
    const job = session.ring?.jobs.get(match[4]);
    if (!job || job.owner !== inputOwner) throw new Error('camera_recording_not_found');
    if (!match[5] && req.method === 'DELETE') {
      await session.ring?.removeRecording(job.id);
      json(res, 200, { removed: true });
      return true;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    session.owners.set(inputOwner, service.now() + 60000);
    if (match[5] === 'status') {
      json(res, 200, describeRecording(job));
      return true;
    }
    if (match[5] === 'media') {
      if (job.state !== 'ready') {
        json(res, 409, { error: 'camera_recording_not_ready' });
        return true;
      }
      if (service.serving >= 4) throw new Error('camera_viewer_busy');
      const range = parseRange(req.headers.range, job.result?.bytes ?? 0);
      service.serving++;
      res.setTimeout(30000, () => res.destroy());
      res.writeHead(range.partial ? 206 : 200, {
        'Content-Type': 'video/mp4',
        'Content-Length': range.end - range.start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...(range.partial
          ? { 'Content-Range': `bytes ${range.start}-${range.end}/${job.result?.bytes ?? 0}` }
          : {}),
      });
      try {
        await pipeMediaFile(job.output ?? '', res, { start: range.start, end: range.end }).catch(
          () => {},
        );
      } finally {
        service.serving--;
      }
      return true;
    }
  }
  json(res, 405, { error: 'method_not_allowed' });
  return true;
}
