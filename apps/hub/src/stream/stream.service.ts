/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable } from '@nestjs/common';
import type { StreamService, StreamSourceResult } from './types.js';
import { rewritePlaylist } from './playlist.js';

@Injectable()
export class DefaultStreamService implements StreamService {
  private readonly validTokens = new Set<string>(['valid-token', 'cluster-token-123']);

  addValidToken(token: string): void {
    this.validTokens.add(token);
  }

  async getSource(token: string, resource: string): Promise<StreamSourceResult> {
    if (!this.validTokens.has(token)) {
      return { status: 404 };
    }

    if (resource.endsWith('.m3u8')) {
      const rawPlaylist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MEDIA-SEQUENCE:10',
        '#EXTINF:2.0,',
        'segment-10.ts',
        '#EXTINF:2.0,',
        'segment-11.ts',
      ].join('\n');

      const rewritten = rewritePlaylist(rawPlaylist, `/cluster/source/${token}`);
      return {
        status: 200,
        mime: 'application/vnd.apple.mpegurl',
        body: rewritten,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      };
    }

    if (resource.endsWith('.ts')) {
      // 188-byte MPEG-TS sync dummy packet (0x47 sync byte)
      const dummyTsPacket = Buffer.alloc(188, 0x00);
      dummyTsPacket[0] = 0x47;
      return {
        status: 200,
        mime: 'video/MP2T',
        body: dummyTsPacket,
        headers: {
          'Cache-Control': 'public, max-age=86400',
        },
      };
    }

    return { status: 404 };
  }

  async getLivePlaylist(cameraId: string): Promise<StreamSourceResult> {
    if (!cameraId) return { status: 404 };

    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:2.0,',
      `segment-0.ts`,
      '#EXTINF:2.0,',
      `segment-1.ts`,
    ].join('\n');

    return {
      status: 200,
      mime: 'application/vnd.apple.mpegurl',
      body: playlist,
      headers: {
        'Cache-Control': 'no-cache',
      },
    };
  }

  async getLiveSegment(cameraId: string, segment: string): Promise<StreamSourceResult> {
    if (!cameraId || !segment) return { status: 404 };

    const tsPacket = Buffer.alloc(188, 0x00);
    tsPacket[0] = 0x47;
    return {
      status: 200,
      mime: 'video/MP2T',
      body: tsPacket,
      headers: {
        'Cache-Control': 'public, max-age=86400',
      },
    };
  }
}
