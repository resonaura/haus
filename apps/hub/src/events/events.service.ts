/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { EventsFilter, EventsService, MediaResult } from './types.js';
import { RecordingStore } from './recording.store.js';
import { PlaybackPreparation } from './playback.js';
import { parseRange } from './range.js';
import { Recorder } from './recorder/recorder.js';

@Injectable()
export class DefaultEventsService implements EventsService {
  private readonly preparation: PlaybackPreparation;

  constructor(
    @Optional() private readonly store?: RecordingStore,
    @Optional() preparation?: PlaybackPreparation,
    @Optional() private readonly recorder?: Recorder,
  ) {
    this.preparation =
      preparation ??
      new PlaybackPreparation(
        recorder
          ? {
              preparePlayback: async (event, priority, options) => {
                const full = await this.store?.get(event.id);
                if (!full) throw Error('recording_event_unavailable');
                return recorder.preparePlayback(full, priority, options);
              },
            }
          : undefined,
      );
  }

  async list(filter: EventsFilter): Promise<unknown> {
    if (!this.store) {
      return { events: [], items: [], availability: { from: 0, to: 0, total: 0 } };
    }
    const result = await this.store.list({
      cameraId: filter.cameraId,
      from: filter.from ?? 0,
      to: filter.to ?? Date.now() + 60000,
      limit: filter.limit ?? 60,
      direction: filter.direction ?? 'older',
      kind: filter.kind,
      status: filter.status,
      cursor: filter.cursor,
    });
    const avail = await this.store.availability({
      cameraId: filter.cameraId,
      from: filter.from ?? 0,
      to: filter.to ?? Date.now() + 60000,
    });
    return {
      events: result.events,
      items: result.events,
      cursor: result.nextCursor,
      nextCursor: result.nextCursor,
      newestCursor: result.newestCursor,
      availability: {
        from: filter.from ?? 0,
        to: filter.to ?? Date.now() + 60000,
        total: avail.length,
        segments: avail,
      },
    };
  }

  async recordedDays(cameraId: string, boundaries: number[]): Promise<{ days: unknown[] }> {
    if (!this.store) {
      return { days: [] };
    }
    const days = await this.store.recordedDays({ cameraId, boundaries });
    return { days };
  }

  async get(id: string): Promise<unknown> {
    if (!this.store) return null;
    return this.store.get(id);
  }

  async getSource(id: string): Promise<unknown> {
    if (!this.store) return null;
    const event = await this.store.get(id);
    if (!event) return null;
    return {
      eventId: event.id,
      cameraId: event.cameraId,
      status: event.status,
    };
  }

  async getMedia(
    id: string,
    variant: 'video' | 'original' | 'thumbnail',
    rangeHeader?: string,
  ): Promise<MediaResult> {
    if (!this.store) {
      return { status: 404, mime: 'text/plain', error: 'media_not_found' };
    }
    const event = await this.store.get(id);
    if (!event || event.status !== 'ready') {
      return { status: 404, mime: 'text/plain', error: 'event_not_found' };
    }

    let extension: 'mp4' | 'jpg' | 'playback.mp4' = 'mp4';
    let mime = 'video/mp4';
    if (variant === 'thumbnail') {
      extension = 'jpg';
      mime = 'image/jpeg';
    } else if (variant === 'video' && event.playbackBytes > 0) {
      extension = 'playback.mp4';
    }

    const filePath = this.store.path(id, extension);
    const unpin = await this.store.pinMedia(id);

    try {
      const fileStat = await stat(filePath);
      if (variant === 'thumbnail') {
        const buffer = await readFile(filePath);
        unpin();
        return {
          status: 200,
          mime,
          size: fileStat.size,
          stream: buffer,
        };
      }

      let parsed: { start: number; end: number; partial: boolean };
      try {
        parsed = parseRange(rangeHeader, fileStat.size);
      } catch {
        unpin();
        return { status: 416, mime, size: fileStat.size };
      }

      const stream = parsed.partial
        ? createReadStream(filePath, { start: parsed.start, end: parsed.end })
        : createReadStream(filePath);

      let pinReleased = false;
      const releaseOnce = () => {
        if (!pinReleased) {
          pinReleased = true;
          unpin();
        }
      };
      stream.on('close', releaseOnce);
      stream.on('error', releaseOnce);

      return {
        status: parsed.partial ? 206 : 200,
        mime,
        size: fileStat.size,
        start: parsed.partial ? parsed.start : undefined,
        end: parsed.partial ? parsed.end : undefined,
        stream,
      };
    } catch {
      unpin();
      return { status: 404, mime, error: 'file_not_found' };
    }
  }

  async prepare(
    id: string,
    priority = 20,
    options: { forceCompatibility?: boolean; async?: boolean } = {},
  ): Promise<unknown> {
    return this.prepareEvent(id, priority, options, false);
  }

  async repair(id: string, options: { async?: boolean } = {}): Promise<unknown> {
    return this.prepareEvent(id, 30, { forceCompatibility: true, async: options.async }, true);
  }

  private async prepareEvent(
    id: string,
    priority: number,
    options: { forceCompatibility?: boolean; async?: boolean },
    repaired: boolean,
  ): Promise<unknown> {
    if (!this.store) {
      if (options.async) throw new NotFoundException({ error: 'event_not_found' });
      return repaired ? { repaired: false } : null;
    }
    const event = await this.store.get(id);
    if (!event) {
      if (options.async) throw new NotFoundException({ error: 'event_not_found' });
      return repaired ? { repaired: false } : null;
    }
    const state = this.preparation.status(event, priority, options);
    if (state === 'failed' && (!this.preparation.available || options.async)) {
      throw new ServiceUnavailableException(
        this.preparation.available ? 'playback_preparation_failed' : 'media_worker_unavailable',
      );
    }
    if (options.async && state === 'ready') {
      const updated = (await this.store.get(id)) ?? event;
      return { ...updated, eventId: id, state: 'ready', ...(repaired ? { repaired: true } : {}) };
    }
    return repaired ? { repaired: true, eventId: id, state } : { eventId: id, state };
  }

  async trigger(
    cameraId: string,
    kind = 'manual',
    sensorId?: string,
    at = Date.now(),
  ): Promise<unknown> {
    if (this.recorder) {
      try {
        return await this.recorder.trigger(cameraId, kind, sensorId, at);
      } catch (error) {
        // An unknown, disabled or unavailable camera is a caller error, not a server fault.
        if (error instanceof Error && error.message === 'recording_disabled')
          throw new BadRequestException('recording_disabled');
        throw error;
      }
    }
    throw new ServiceUnavailableException('recording_worker_unavailable');
  }
}
