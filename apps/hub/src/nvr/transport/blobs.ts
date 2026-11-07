/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NvrOptions } from './types.js';
import { reply } from './reply.js';
import { pipeline } from 'node:stream/promises';
import { EMPTY_DIGEST } from '../auth.js';
import { parseRange } from '../blobs.js';
export class BlobRoutes {
  serving = 0;
  constructor(private readonly options: NvrOptions) {}
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    grant: string | null,
  ): Promise<boolean> {
    const { blobs, cameraRecordings, catalog, recordings, maxStreams = 4 } = this.options;
    const match = grant ?? /^\/v1\/blobs\/([a-f0-9]{64})$/.exec(path)?.[1];
    if (match) {
      const id = match;
      if (grant && !['GET', 'HEAD'].includes(req.method ?? ''))
        return reply(res, 403, { error: 'read_only_grant' });
      if (req.method === 'PUT') {
        if (req.headers['x-haus-digest'] !== id) throw new Error('digest_mismatch');
        const result = await blobs.put(id, req, Number(req.headers['content-length']));
        if (result.existing) req.resume();
        return reply(res, result.existing ? 200 : 201, { digest: id });
      }
      if (!grant && req.headers['x-haus-digest'] !== EMPTY_DIGEST) throw new Error('invalid_body');
      if (req.method === 'DELETE') {
        if (await cameraRecordings?.pending(id)) throw Error('blob_in_use');
        await blobs.remove(id);
        await catalog?.remove(id);
        await recordings?.remove(id);
        return reply(res, 200, { deleted: true });
      }
      if (['GET', 'HEAD'].includes(req.method ?? '')) {
        let reader;
        try {
          reader = await blobs.openRead(id);
        } catch {
          return reply(res, 404, { error: 'media_not_found' });
        }
        try {
          const info = reader.info;
          let range;
          try {
            range = parseRange(req.headers.range, info.size);
          } catch {
            res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
            return true;
          }
          if (req.method === 'GET' && this.serving >= Math.max(4, maxStreams * 2))
            return reply(res, 503, { error: 'stream_busy' });
          res.setTimeout(30000, () => res.destroy());
          res.writeHead(range.partial ? 206 : 200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': range.end - range.start + 1,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
            ...(range.partial
              ? {
                  'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
                }
              : {}),
          });
          if (req.method === 'HEAD') {
            res.end();
            return true;
          }
          this.serving++;
          try {
            await pipeline(reader.stream({ start: range.start, end: range.end }), res);
          } finally {
            this.serving--;
          }
          return true;
        } finally {
          await reader.close();
        }
      }
    }

    return false;
  }
}
