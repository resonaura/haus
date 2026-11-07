/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NvrOptions } from './types.js';
import { reply, objectBody } from './reply.js';
import { mediaGrant } from '../grants.js';
export async function metadataRoutes(
  options: NvrOptions,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  grant: string | null,
): Promise<boolean> {
  const { key, blobs, settings, catalog, recordings, cameras, streams, detectors, playback } =
    options;
  const path = url.pathname;
  if (!grant && settings && path === '/v1/settings') {
    if (req.method === 'GET') return reply(res, 200, settings.status());
    if (req.method === 'PATCH')
      return reply(res, 200, await settings.update(await objectBody(req, 4096)));
  }
  if (!grant && path === '/v1/grants' && req.method === 'POST') {
    const input = await objectBody(req);
    if (typeof input.digest !== 'string') throw Error('invalid_digest');
    await blobs.info(input.digest);
    return reply(res, 201, mediaGrant(key, input.digest));
  }
  if (!grant && catalog && path === '/v1/backups') {
    if (req.method === 'GET') return reply(res, 200, { items: catalog.list() });
    if (req.method === 'POST') {
      await catalog.add(await objectBody(req));
      return reply(res, 201, { saved: true });
    }
  }
  if (!grant && recordings && path === '/v1/recordings') {
    if (req.method === 'GET') {
      return reply(res, 200, await recordings.list(url.searchParams.get('cursor') || undefined));
    }
    if (req.method === 'POST') {
      await recordings.add(await objectBody(req));
      return reply(res, 201, { saved: true });
    }
  }
  if (
    !grant &&
    recordings &&
    /^\/v1\/recordings\/[a-f0-9-]{36}$/.test(path) &&
    req.method === 'GET'
  ) {
    const item = await recordings.get(path.slice(path.lastIndexOf('/') + 1));
    return reply(res, item ? 200 : 404, item ?? { error: 'not_found' });
  }
  if (!grant && cameras && (await cameras.handle(req, res, path))) return true;
  if (streams && (await streams.handle(req, res, path))) return true;
  if (!grant && detectors && (await detectors.handle(req, res, path))) return true;
  if (!grant && playback && (await playback.handle(req, res, path))) return true;

  return false;
}
