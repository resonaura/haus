/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { EVENTS_SERVICE } from './tokens.js';
import type { EventsService, MediaResult } from './types.js';
import { CalendarQueryDto, EventsQueryDto } from './events.dto.js';

@ApiTags('Events')
@ApiBearerAuth('bearer')
@Controller()
export class EventsController {
  constructor(@Inject(EVENTS_SERVICE) private readonly eventsService: EventsService) {}

  @Get('api/events')
  @ApiOperation({
    summary: 'Query recording events timeline with pagination and availability bounds',
  })
  async listEvents(@Query() query: EventsQueryDto) {
    return this.eventsService.list({
      cameraId: query.camera_id,
      from: query.from ?? 0,
      to: query.to ?? Date.now() + 60000,
      limit: query.limit ?? 60,
      direction: query.direction ?? 'older',
      kind: query.kind,
      status: query.status,
      cursor: query.cursor,
    });
  }

  @Get('api/events/calendar')
  @ApiOperation({
    summary: 'Retrieve calendar summary of recorded days for camera within boundaries',
  })
  async calendar(@Query() query: CalendarQueryDto) {
    const boundaries = query.boundaries.split(',').map(Number);
    if (
      boundaries.length < 2 ||
      boundaries.length > 32 ||
      boundaries.some(
        (at, index) =>
          !Number.isSafeInteger(at) ||
          at < 0 ||
          (index > 0 && (at <= boundaries[index - 1] || at - boundaries[index - 1] > 48 * 3600000)),
      )
    ) {
      throw new BadRequestException({ error: 'invalid_calendar' });
    }
    return this.eventsService.recordedDays(query.camera_id, boundaries);
  }

  @Get('api/events/:id')
  @ApiOperation({ summary: 'Get recording event metadata' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getEvent(@Param('id') id: string) {
    const event = await this.eventsService.get(id);
    if (!event) {
      throw new NotFoundException({ error: 'event_not_found' });
    }
    return event;
  }

  @Get('api/events/:id/source')
  @ApiOperation({ summary: 'Get cluster source metadata for event' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getEventSource(@Param('id') id: string) {
    const source = await this.eventsService.getSource(id);
    return { source };
  }

  @Get('api/events/:id/thumbnail')
  @ApiOperation({ summary: 'Get JPEG thumbnail image for event' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getThumbnail(
    @Param('id') id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.eventsService.getMedia(id, 'thumbnail', rangeHeader);
    return this.sendMediaResult(result, res);
  }

  @Get('api/events/:id/video')
  @ApiOperation({ summary: 'Stream MP4 video playback for event with byte-range seeks' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getVideo(
    @Param('id') id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.eventsService.getMedia(id, 'video', rangeHeader);
    return this.sendMediaResult(result, res);
  }

  @Get('api/events/:id/original')
  @ApiOperation({ summary: 'Stream original unmodified MP4 video recording for event' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getOriginal(
    @Param('id') id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.eventsService.getMedia(id, 'original', rangeHeader);
    return this.sendMediaResult(result, res);
  }

  @Get('api/events/:id/prepare')
  @ApiOperation({ summary: 'Check playback preparation for event' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getPrepare(
    @Param('id') id: string,
    @Headers('x-haus-async-prepare') asyncHeader: string | undefined,
    @Headers('x-haus-compatibility-repair') repairHeader: string | undefined,
  ) {
    return this.eventsService.prepare(id, 20, {
      async: asyncHeader === '1',
      forceCompatibility: repairHeader === '1',
    });
  }

  @Post('api/events/:id/prepare')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger playback preparation for event' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async postPrepare(
    @Param('id') id: string,
    @Headers('x-haus-async-prepare') asyncHeader: string | undefined,
    @Headers('x-haus-compatibility-repair') repairHeader: string | undefined,
  ) {
    return this.eventsService.prepare(id, 20, {
      async: asyncHeader === '1',
      forceCompatibility: repairHeader === '1',
    });
  }

  @Get('api/events/:id/prepare-next')
  @ApiOperation({ summary: 'Check background preparation for sequential event playback' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async getPrepareNext(
    @Param('id') id: string,
    @Headers('x-haus-async-prepare') asyncHeader: string | undefined,
  ) {
    return this.eventsService.prepare(id, 0, {
      async: asyncHeader === '1',
    });
  }

  @Post('api/events/:id/prepare-next')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pre-warm background preparation for sequential event playback' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async postPrepareNext(
    @Param('id') id: string,
    @Headers('x-haus-async-prepare') asyncHeader: string | undefined,
  ) {
    return this.eventsService.prepare(id, 0, {
      async: asyncHeader === '1',
    });
  }

  @Post('api/events/:id/repair')
  @HttpCode(200)
  @ApiOperation({ summary: 'Repair fragmented or timestamp-skewed event recording' })
  @ApiParam({
    name: 'id',
    description: 'Event UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  async repair(@Param('id') id: string) {
    return this.eventsService.repair(id);
  }

  private async sendMediaResult(result: MediaResult, res: Response) {
    if (result.status === 404) {
      throw new NotFoundException({ error: result.error ?? 'media_not_found' });
    }
    if (result.status === 409) {
      throw new ConflictException({ error: result.error ?? 'video_not_ready' });
    }
    if (result.status === 416) {
      res.setHeader('Content-Range', `bytes */${result.size ?? 0}`);
      return res.status(416).end();
    }
    if (result.status === 503) {
      throw new ServiceUnavailableException({ error: result.error ?? 'media_unavailable' });
    }

    res.setHeader('Content-Type', result.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, String(value));
      }
    }

    if (
      result.status === 206 &&
      result.start !== undefined &&
      result.end !== undefined &&
      result.size !== undefined
    ) {
      res.setHeader('Content-Range', `bytes ${result.start}-${result.end}/${result.size}`);
      res.setHeader('Content-Length', result.end - result.start + 1);
    } else if (result.size !== undefined && !res.getHeader('Content-Length')) {
      res.setHeader('Content-Length', result.size);
    }

    res.status(result.status);

    if (Buffer.isBuffer(result.stream)) {
      return res.send(result.stream);
    }
    if (result.stream instanceof Readable) {
      await pipeline(result.stream, res).catch(() => {});
      return;
    }
    return res.end();
  }
}
