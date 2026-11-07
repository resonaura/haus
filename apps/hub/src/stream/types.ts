/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { Readable } from 'node:stream';

export interface StreamSourceResult {
  status: number;
  mime?: string;
  body?: string | Buffer | Readable | ReadableStream;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export interface StreamService {
  getSource(token: string, resource: string): Promise<StreamSourceResult>;
  getLivePlaylist(cameraId: string): Promise<StreamSourceResult>;
  getLiveSegment(cameraId: string, segment: string): Promise<StreamSourceResult>;
}
