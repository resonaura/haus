/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NvrOptions } from './types.js';
import { reply, objectBody } from './reply.js';
import { pipeline } from 'node:stream/promises';
import { mediaCommand } from '@haus/homekit/media';
export async function cameraRoutes(
  options: NvrOptions,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  grant: string | null,
): Promise<boolean> {
  const {
    roles = ['storage', 'stream'],
    peers,
    homekit,
    cameraRecordings,
    cameraActivity,
    continuity,
    cameraAccess,
  } = options;
  const path = url.pathname;
  if (
    !grant &&
    roles.includes('stream') &&
    peers &&
    path === '/v1/rtsp-peer/grant' &&
    req.method === 'POST'
  )
    return reply(res, 200, peers.grant(await peerInput(req)));
  if (
    !grant &&
    roles.includes('stream') &&
    homekit &&
    path === '/v1/homekit' &&
    req.method === 'POST'
  ) {
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    const value = await homekit.command(
      mediaCommand(await objectBody(req, 32768)),
      controller.signal,
    );
    if (('buffer' in value && value.buffer) || ('stream' in value && value.stream)) {
      res.writeHead(200, { 'Content-Type': value.mime, 'Cache-Control': 'no-store' });
      if ('buffer' in value && value.buffer) {
        res.end(value.buffer);
        return true;
      }
      if ('stream' in value && value.stream) await pipeline(value.stream, res);
      return true;
    }
    return reply(res, 200, value);
  }
  if (!grant && roles.includes('stream') && cameraRecordings) {
    if (path === '/v1/camera-activity/interrupted' && req.method === 'GET')
      return reply(
        res,
        200,
        await cameraRecordings.interruptedActivities(url.searchParams.get('cursor') ?? '0'),
      );
    const interrupted = /^\/v1\/camera-activity\/interrupted\/([a-f0-9-]{36})$/.exec(path);
    if (interrupted && req.method === 'POST') {
      await objectBody(req, 4096);
      return reply(res, 200, await cameraRecordings.acknowledgeInterrupted(interrupted[1]));
    }
  }
  if (
    !grant &&
    roles.includes('stream') &&
    cameraActivity &&
    path === '/v1/camera-activity/trigger' &&
    req.method === 'POST'
  )
    return reply(res, 200, await cameraActivity.trigger(await objectBody(req, 4096)));
  if (!grant && roles.includes('stream') && cameraActivity && path === '/v1/camera-activity') {
    if (req.method === 'GET') return reply(res, 200, cameraActivity.status());
    if (req.method === 'PUT')
      return reply(res, 200, await cameraActivity.update((await objectBody(req, 300000)).cameras));
  }
  if (!grant && roles.includes('stream') && cameraRecordings) {
    if (path === '/v1/camera-recordings' && req.method === 'GET')
      return reply(res, 200, await cameraRecordings.list(url.searchParams.get('cursor') ?? '0'));
    const receipt = /^\/v1\/camera-recordings\/([a-f0-9-]{36})$/.exec(path);
    if (receipt && req.method === 'GET') {
      const value = await cameraRecordings.get(receipt[1]);
      return reply(res, value ? 200 : 404, value ?? { error: 'camera_recording_not_found' });
    }
    if (receipt && req.method === 'POST')
      return reply(
        res,
        200,
        await cameraRecordings.acknowledge(receipt[1], await receiptDigest(req)),
      );
  }
  if (
    !grant &&
    roles.includes('stream') &&
    continuity &&
    path === '/v1/camera-continuity' &&
    req.method === 'PUT'
  )
    return reply(res, 200, await continuity.update((await objectBody(req, 300000)).cameras));
  if (
    !grant &&
    roles.includes('stream') &&
    cameraAccess &&
    path === '/v1/camera-access/reconcile' &&
    req.method === 'POST'
  )
    return reply(res, 200, await cameraAccess.reconcile(await objectBody(req, 16000)));
  if (
    roles.includes('stream') &&
    cameraAccess &&
    path === '/v1/camera-access' &&
    req.method === 'POST'
  )
    return reply(res, 201, await cameraAccess.provision(await objectBody(req, 8192)));
  const revokedAccess = /^\/v1\/camera-access\/([a-f0-9]{32})$/.exec(path);
  if (roles.includes('stream') && cameraAccess && revokedAccess && req.method === 'DELETE')
    return reply(res, 200, await cameraAccess.revoke(revokedAccess[1]));

  return false;
}
async function peerInput(req: IncomingMessage) {
  const value = await objectBody(req, 4096);
  if (
    typeof value.sessionId !== 'string' ||
    (value.owner !== undefined && typeof value.owner !== 'string')
  )
    throw Error('invalid_camera_session');
  return {
    sessionId: value.sessionId,
    ...(typeof value.owner === 'string' ? { owner: value.owner } : {}),
  };
}

async function receiptDigest(req: IncomingMessage): Promise<string> {
  const value = await objectBody(req, 4096);
  if (typeof value.sha256 !== 'string') throw Error('invalid_camera_recording');
  return value.sha256;
}
