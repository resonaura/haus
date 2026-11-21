/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { FastifyRequest } from 'fastify';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

export const HUB_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const HUB_MAX_PARAM_LENGTH = 512;

type RawBodyFastifyRequest = FastifyRequest & { rawBody?: Buffer };

export function createHubFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: HUB_BODY_LIMIT_BYTES,
    // Fastify 5 defaults to a 72s keepAliveTimeout; force-closing connections during
    // Nest dispose (after onModuleDestroy drains storage/services) avoids shutdown hangs
    // on keep-alive sockets or streaming responses.
    forceCloseConnections: true,
    routerOptions: {
      maxParamLength: HUB_MAX_PARAM_LENGTH,
    },
  });
}

/**
 * Configures Fastify content-type parsers for Haus Hub:
 * - 16 MiB JSON & URL-encoded parsers (preserving req.rawBody and accepting empty JSON bodies).
 * - Unbuffered stream pass-through for camera talkback (audio/*) and HA file uploads (multipart/form-data).
 * - Raw text/binary webhook payloads without 415 Unsupported Media Type rejections.
 */
export function configureHubFastifyParsers(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();

  const parseJsonBody = (
    req: Parameters<ReturnType<typeof fastify.getDefaultJsonParser>>[0],
    body: Buffer,
    done: (err: Error | null, parsed?: unknown) => void,
  ) => {
    if (body.length === 0) {
      done(null, {});
      return;
    }
    const { onProtoPoisoning, onConstructorPoisoning } = fastify.initialConfig;
    const defaultJsonParser = fastify.getDefaultJsonParser(
      onProtoPoisoning || 'error',
      onConstructorPoisoning || 'error',
    );
    defaultJsonParser(req, body.toString('utf8'), done);
  };

  app.useBodyParser('application/json', { bodyLimit: HUB_BODY_LIMIT_BYTES }, parseJsonBody);
  app.useBodyParser(/^application\/.+\+json$/i, { bodyLimit: HUB_BODY_LIMIT_BYTES }, parseJsonBody);
  app.useBodyParser('application/x-www-form-urlencoded', { bodyLimit: HUB_BODY_LIMIT_BYTES });

  // Leave streaming uploads untouched so handlers read directly from req.raw (IncomingMessage).
  const passThroughStream = (
    _req: FastifyRequest,
    payload: FastifyRequest['raw'],
    done: (err: Error | null, body?: unknown) => void,
  ) => {
    done(null, payload);
  };
  fastify.addContentTypeParser(/^audio\//i, passThroughStream);
  fastify.addContentTypeParser(/^multipart\/form-data/i, passThroughStream);

  fastify.addContentTypeParser(
    ['application/octet-stream', 'application/xml', 'text/xml'],
    { parseAs: 'buffer', bodyLimit: HUB_BODY_LIMIT_BYTES },
    (req, body, done) => {
      if (Buffer.isBuffer(body)) {
        (req as RawBodyFastifyRequest).rawBody = body;
      }
      const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
      if (contentType.includes('xml') && Buffer.isBuffer(body)) {
        done(null, body.toString('utf8'));
        return;
      }
      done(null, body);
    },
  );
}
