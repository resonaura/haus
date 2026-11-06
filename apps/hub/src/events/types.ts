/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Readable } from 'node:stream';

export interface EventsFilter {
  cameraId?: string;
  from?: number;
  to?: number;
  limit?: number;
  direction?: 'older' | 'newer';
  kind?: string;
  status?: string;
  cursor?: string;
}

export interface MediaResult {
  status: number;
  mime: string;
  size?: number;
  start?: number;
  end?: number;
  headers?: Record<string, string | number>;
  stream?: Buffer | Readable;
  error?: string;
}

export interface EventsService {
  list(filter: EventsFilter): Promise<unknown>;
  recordedDays(cameraId: string, boundaries: number[]): Promise<{ days: unknown[] }>;
  get(id: string): Promise<unknown>;
  getSource(id: string): Promise<unknown>;
  getMedia(
    id: string,
    variant: 'video' | 'original' | 'thumbnail',
    rangeHeader?: string,
  ): Promise<MediaResult>;
  prepare(
    id: string,
    priority?: number,
    options?: { forceCompatibility?: boolean; async?: boolean },
  ): Promise<unknown>;
  repair(id: string): Promise<unknown>;
}
