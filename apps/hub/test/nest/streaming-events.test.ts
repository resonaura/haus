/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createNestApp } from '../../src/nest.js';
import { STREAM_SERVICE } from '../../src/stream/tokens.js';
import type { StreamService, StreamSourceResult } from '../../src/stream/types.js';
import { EVENTS_SERVICE } from '../../src/events/tokens.js';
import type { EventsFilter, EventsService, MediaResult } from '../../src/events/types.js';
import { parseRange } from '../../src/events/range.js';

describe('NestJS Streaming & Events Integration', () => {
  let app: INestApplication;
  let baseUrl: string;

  const validToken = 'a'.repeat(48);
  const validResource = 'b'.repeat(24) + '.m3u8';
  const validSegment = 'c'.repeat(24) + '.ts';
  const mockMediaBytes = Buffer.alloc(1000, 0x42);

  const mockStreamService: StreamService = {
    async getSource(token: string, resource: string): Promise<StreamSourceResult> {
      if (token !== validToken) return { status: 404 };
      if (resource === validResource) {
        return {
          status: 200,
          mime: 'application/vnd.apple.mpegurl',
          baseUrl: 'http://ha.internal/hls/test/',
          body: '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\n' + validSegment + '\n',
        };
      }
      if (resource === validSegment) {
        return {
          status: 200,
          mime: 'video/mp2t',
          body: Buffer.from('synthetic-segment-bytes'),
        };
      }
      return { status: 404 };
    },
    async getLivePlaylist(cameraId: string): Promise<StreamSourceResult> {
      if (cameraId !== 'camera.porch') return { status: 404 };
      return {
        status: 200,
        mime: 'application/vnd.apple.mpegurl',
        body: '#EXTM3U\n#EXTINF:2,\nsegment-001.ts\n',
      };
    },
    async getLiveSegment(cameraId: string, segment: string): Promise<StreamSourceResult> {
      if (cameraId !== 'camera.porch' || segment !== 'segment-001.ts') return { status: 404 };
      return {
        status: 200,
        mime: 'video/mp2t',
        body: Buffer.from('live-segment-bytes'),
      };
    },
  };

  const mockEventsService: EventsService = {
    async list(filter: EventsFilter) {
      return {
        items: [
          {
            id: 'event-1',
            cameraId: filter.cameraId ?? 'camera.porch',
            kind: filter.kind ?? 'motion',
            status: filter.status ?? 'ready',
          },
        ],
        availability: { from: 1000, to: 2000, total: 1 },
      };
    },
    async recordedDays(cameraId: string, boundaries: number[]) {
      return { days: [`${cameraId}-${boundaries.length}-days`] };
    },
    async get(id: string) {
      if (id !== 'event-1') return null;
      return { id: 'event-1', status: 'ready', duration: 10, bytes: 1000 };
    },
    async getSource(id: string) {
      if (id !== 'event-1') return null;
      return { node: 'node-1', remoteEventId: 'remote-1' };
    },
    async getMedia(
      id: string,
      variant: 'video' | 'original' | 'thumbnail',
      rangeHeader?: string,
    ): Promise<MediaResult> {
      if (id !== 'event-1') {
        return { status: 404, mime: 'text/plain', error: 'event_not_found' };
      }
      if (variant === 'thumbnail') {
        return {
          status: 200,
          mime: 'image/jpeg',
          size: 100,
          stream: Buffer.alloc(100, 0xff),
        };
      }

      const totalSize = mockMediaBytes.length;
      let range;
      try {
        range = parseRange(rangeHeader, totalSize);
      } catch {
        return { status: 416, mime: 'video/mp4', size: totalSize };
      }

      if (range.partial) {
        const slice = mockMediaBytes.subarray(range.start, range.end + 1);
        return {
          status: 206,
          mime: 'video/mp4',
          start: range.start,
          end: range.end,
          size: totalSize,
          stream: slice,
        };
      }

      return {
        status: 200,
        mime: 'video/mp4',
        size: totalSize,
        stream: mockMediaBytes,
      };
    },
    async prepare(id: string, priority = 0) {
      return { id, priority, status: 'ready' };
    },
    async repair(id: string) {
      return { id, repaired: true };
    },
  };

  beforeAll(async () => {
    app = await createNestApp();
    const streamService = app.get<StreamService>(STREAM_SERVICE);
    Object.assign(streamService, mockStreamService);

    const eventsService = app.get<EventsService>(EVENTS_SERVICE);
    Object.assign(eventsService, mockEventsService);

    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Streams Controller', () => {
    it('rejects invalid cluster source token format with 400', async () => {
      const res = await fetch(`${baseUrl}/cluster/source/short-token/${validResource}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_resource');
    });

    it('rejects invalid cluster source resource format with 400', async () => {
      const res = await fetch(`${baseUrl}/cluster/source/${validToken}/invalid-format`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_resource');
    });

    it('rewrites playlist URIs to cluster source endpoints', async () => {
      const res = await fetch(`${baseUrl}/cluster/source/${validToken}/${validResource}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/vnd.apple.mpegurl');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const text = await res.text();
      expect(text).toContain(`/cluster/source/${validToken}/${validSegment}`);
      expect(text).not.toContain('http://ha.internal');
    });

    it('proxies binary video segment from cluster source', async () => {
      const res = await fetch(`${baseUrl}/cluster/source/${validToken}/${validSegment}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('video/mp2t');
      const text = await res.text();
      expect(text).toBe('synthetic-segment-bytes');
    });

    it('proxies live camera HLS playlist and segments', async () => {
      const playlistRes = await fetch(`${baseUrl}/api/cameras/camera.porch/live/index.m3u8`);
      expect(playlistRes.status).toBe(200);
      expect(playlistRes.headers.get('content-type')).toContain('application/vnd.apple.mpegurl');

      const segmentRes = await fetch(`${baseUrl}/api/cameras/camera.porch/live/segment-001.ts`);
      expect(segmentRes.status).toBe(200);
      expect(segmentRes.headers.get('content-type')).toContain('video/mp2t');
      expect(await segmentRes.text()).toBe('live-segment-bytes');
    });
  });

  describe('Events Controller', () => {
    it('GET /api/events queries event timeline with filters', async () => {
      const res = await fetch(`${baseUrl}/api/events?camera_id=camera.porch&limit=10&direction=older`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].cameraId).toBe('camera.porch');
      expect(body.availability.total).toBe(1);
    });

    it('GET /api/events/calendar returns recorded days within boundaries', async () => {
      const res = await fetch(`${baseUrl}/api/events/calendar?camera_id=camera.porch&boundaries=1000,2000,3000`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.days).toHaveLength(1);
    });

    it('GET /api/events/calendar rejects malformed boundaries with 400', async () => {
      const res = await fetch(`${baseUrl}/api/events/calendar?camera_id=camera.porch&boundaries=single`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_calendar');
    });

    it('GET /api/events/:id returns event details or 404', async () => {
      const okRes = await fetch(`${baseUrl}/api/events/event-1`);
      expect(okRes.status).toBe(200);
      const okBody = await okRes.json();
      expect(okBody.id).toBe('event-1');

      const missingRes = await fetch(`${baseUrl}/api/events/missing`);
      expect(missingRes.status).toBe(404);
    });

    it('GET /api/events/:id/source returns cluster source information', async () => {
      const res = await fetch(`${baseUrl}/api/events/event-1/source`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source.node).toBe('node-1');
    });

    it('GET /api/events/:id/thumbnail serves JPEG image', async () => {
      const res = await fetch(`${baseUrl}/api/events/event-1/thumbnail`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    });

    it('GET /api/events/:id/video serves full MP4 without range', async () => {
      const res = await fetch(`${baseUrl}/api/events/event-1/video`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(res.headers.get('content-length')).toBe('1000');
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBe(1000);
    });

    it('GET /api/events/:id/video supports byte-range seeks (206 Partial Content)', async () => {
      const res = await fetch(`${baseUrl}/api/events/event-1/video`, {
        headers: { Range: 'bytes=100-199' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
      expect(res.headers.get('content-length')).toBe('100');
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBe(100);
    });

    it('GET /api/events/:id/video rejects out-of-bounds range with 416', async () => {
      const res = await fetch(`${baseUrl}/api/events/event-1/video`, {
        headers: { Range: 'bytes=5000-6000' },
      });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */1000');
    });

    it('POST /api/events/:id/prepare and repair endpoints trigger playback preparation', async () => {
      const prepRes = await fetch(`${baseUrl}/api/events/event-1/prepare`, {
        method: 'POST',
      });
      expect(prepRes.status).toBe(200);
      const prepBody = await prepRes.json();
      expect(prepBody.status).toBe('ready');

      const repairRes = await fetch(`${baseUrl}/api/events/event-1/repair`, {
        method: 'POST',
      });
      expect(repairRes.status).toBe(200);
      const repairBody = await repairRes.json();
      expect(repairBody.repaired).toBe(true);
    });
  });

  describe('Postman Dynamic Documentation Reflection', () => {
    it('GET /api/docs/postman.json includes Cameras, Streams, and Events endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/docs/postman.json`);
      expect(res.status).toBe(200);
      const postman = await res.json();
      expect(postman.info.name).toBe('Haus Hub API');

      const itemNames = (items: Array<{ name: string; item?: unknown[] }>): string[] => {
        const result: string[] = [];
        for (const item of items) {
          result.push(item.name.toLowerCase());
          if (Array.isArray(item.item)) {
            result.push(...itemNames(item.item as Array<{ name: string; item?: unknown[] }>));
          }
        }
        return result;
      };

      const allNames = itemNames(postman.item);
      expect(allNames.some((n) => n.includes('camera'))).toBe(true);
      expect(allNames.some((n) => n.includes('event'))).toBe(true);
      expect(allNames.some((n) => n.includes('stream') || n.includes('cluster'))).toBe(true);
    });
  });
});
