/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { spawn } from 'node:child_process';
import { HlsStreams } from '@haus/media/stream';
import type { HlsStreamJob } from '@haus/media/stream';
import type { MediaRuntime } from '@haus/media/pipeline';
import { body, json } from '../http.js';

export interface WorkerStreamsOptions {
  max?: number;
  spawnProcess?: typeof spawn;
  runtime?: MediaRuntime;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Hub-owned route adapter for the media package's bounded HLS engine. */
export class WorkerStreams {
  readonly engine: HlsStreams;

  constructor(root: string, origin: string, options: WorkerStreamsOptions = {}) {
    this.engine = new HlsStreams(root, origin, options);
  }

  get jobs(): Map<string, HlsStreamJob> {
    return this.engine.jobs;
  }

  get origin(): string {
    return this.engine.origin;
  }

  get capacity(): () => number {
    return this.engine.capacity;
  }

  set capacity(value: () => number) {
    this.engine.capacity = value;
  }

  get size(): number {
    return this.engine.size;
  }

  async initialize(): Promise<this> {
    await this.engine.initialize();
    return this;
  }

  start(source: string): Promise<{ id: string }> {
    return this.engine.start(source);
  }

  remove(id: string): Promise<void> {
    return this.engine.remove(id);
  }

  prune(): Promise<void> {
    return this.engine.prune();
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path === '/v1/streams' && req.method === 'POST') {
      const input: unknown = await body(req);
      if (!isRecord(input) || typeof input.source !== 'string')
        throw new Error('invalid_stream_source');
      json(res, 201, await this.start(input.source));
      return true;
    }
    const match = /^\/v1\/streams\/([a-f0-9-]{36})(?:\/(index\.m3u8|segment-\d+\.ts))?$/.exec(path);
    if (!match) return false;
    if (req.method === 'DELETE' && !match[2]) {
      await this.remove(match[1]);
      json(res, 200, { stopped: true });
      return true;
    }
    if (req.method === 'GET' && match[2]) {
      const served = await this.engine.serve(match[1], match[2], res);
      if (!served) json(res, 404, { error: 'segment_not_found' });
      return true;
    }
    if (!this.jobs.has(match[1])) {
      json(res, 404, { error: 'stream_not_found' });
      return true;
    }
    return false;
  }

  stop(): Promise<void> {
    return this.engine.stop();
  }
}
