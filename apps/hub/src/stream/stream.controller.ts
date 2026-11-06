/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { STREAM_SERVICE } from './tokens.js';
import type { StreamService } from './types.js';
import { rewritePlaylist } from './playlist.js';

@ApiTags('Streams')
@Controller()
export class StreamController {
  constructor(@Inject(STREAM_SERVICE) private readonly streamService: StreamService) {}

  @Get('cluster/source/:token/:resource')
  @ApiOperation({ summary: 'Proxy opaque camera resource or playlist across cluster boundary' })
  @ApiParam({
    name: 'token',
    description: 'Cryptographic lease token (48-char hex)',
    example: 'a'.repeat(48),
  })
  @ApiParam({
    name: 'resource',
    description: 'Resource identifier (24-char hex with optional extension)',
    example: 'b'.repeat(24) + '.m3u8',
  })
  async getClusterSource(
    @Param('token') token: string,
    @Param('resource') resource: string,
    @Res() res: Response,
  ) {
    if (
      !/^[a-f0-9]{48}$/.test(token) ||
      !/^[a-f0-9]{24}(?:\.(?:m3u8|ts|m4s|mp4|aac|key))?$/.test(resource)
    ) {
      throw new BadRequestException({ error: 'invalid_resource' });
    }

    const upstream = await this.streamService.getSource(token, resource);
    if (upstream.status !== 200) {
      if (upstream.status === 404) {
        throw new NotFoundException({ error: 'source_not_found' });
      }
      if (upstream.status === 400) {
        throw new BadRequestException({ error: 'invalid_resource' });
      }
      throw new ServiceUnavailableException({ error: 'source_unavailable' });
    }

    const mime = upstream.mime ?? 'application/octet-stream';
    const isPlaylist = resource.endsWith('.m3u8') || /mpegurl/i.test(mime);

    if (isPlaylist) {
      let text: string;
      if (typeof upstream.body === 'string') {
        text = upstream.body;
      } else if (Buffer.isBuffer(upstream.body)) {
        text = upstream.body.toString('utf8');
      } else if (
        upstream.body &&
        typeof (upstream.body as ReadableStream).getReader === 'function'
      ) {
        const response = new Response(upstream.body as ReadableStream);
        text = await response.text();
      } else if (upstream.body instanceof Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of upstream.body) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        text = Buffer.concat(chunks).toString('utf8');
      } else {
        text = '';
      }

      const body = rewritePlaylist(
        text,
        upstream.baseUrl ?? 'http://haus.invalid',
        (val: string) => {
          const match = /\/([a-f0-9]{24}(?:\.(?:m3u8|ts|m4s|mp4|aac|key))?)(?:\?|$)/.exec(val);
          const targetResource = match ? match[1] : resource;
          return `/cluster/source/${token}/${targetResource}`;
        },
      );

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(body);
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');

    if (Buffer.isBuffer(upstream.body)) {
      return res.status(200).send(upstream.body);
    }
    if (typeof upstream.body === 'string') {
      return res.status(200).send(Buffer.from(upstream.body));
    }
    if (upstream.body && typeof (upstream.body as ReadableStream).getReader === 'function') {
      const nodeStream = Readable.fromWeb(
        upstream.body as import('node:stream/web').ReadableStream,
      );
      await pipeline(nodeStream, res).catch(() => {});
      return;
    }
    if (upstream.body instanceof Readable) {
      await pipeline(upstream.body, res).catch(() => {});
      return;
    }
    return res.status(200).end();
  }

  @Get('api/cameras/:id/live/index.m3u8')
  @ApiOperation({ summary: 'Proxy active HLS live stream playlist for camera' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  async getLivePlaylist(@Param('id') id: string, @Res() res: Response) {
    const upstream = await this.streamService.getLivePlaylist(id);
    if (upstream.status === 404) {
      throw new NotFoundException({ error: 'stream_not_ready' });
    }
    if (upstream.status !== 200) {
      throw new ServiceUnavailableException({ error: 'stream_unavailable' });
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    if (typeof upstream.body === 'string' || Buffer.isBuffer(upstream.body)) {
      return res.status(200).send(upstream.body);
    }
    if (upstream.body instanceof Readable) {
      await pipeline(upstream.body, res).catch(() => {});
      return;
    }
    return res.status(200).end();
  }

  @Get('api/cameras/:id/live/:segment')
  @ApiOperation({ summary: 'Proxy active HLS live stream video segment for camera' })
  @ApiParam({ name: 'id', description: 'Camera entity ID', example: 'camera.porch' })
  @ApiParam({ name: 'segment', description: 'HLS segment filename', example: 'segment-001.ts' })
  async getLiveSegment(
    @Param('id') id: string,
    @Param('segment') segment: string,
    @Res() res: Response,
  ) {
    const upstream = await this.streamService.getLiveSegment(id, segment);
    if (upstream.status === 404) {
      throw new NotFoundException({ error: 'segment_not_found' });
    }
    if (upstream.status !== 200) {
      throw new ServiceUnavailableException({ error: 'stream_unavailable' });
    }
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-store');
    if (Buffer.isBuffer(upstream.body) || typeof upstream.body === 'string') {
      return res.status(200).send(upstream.body);
    }
    if (upstream.body instanceof Readable) {
      await pipeline(upstream.body, res).catch(() => {});
      return;
    }
    return res.status(200).end();
  }
}
