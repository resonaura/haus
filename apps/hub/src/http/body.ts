/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage } from 'node:http';

/** Bound raw bytes before decoding; a split UTF-8 character must survive stream chunks. */
export async function requestBody(request: IncomingMessage): Promise<unknown> {
  if (
    !String(request.headers['content-type']).startsWith('application/json') ||
    request.headers['x-haus-client'] !== '1'
  )
    throw Error('json_required');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    if (!Buffer.isBuffer(value) && typeof value !== 'string') throw Error('invalid_json');
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > 65536) throw Error('body_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8') || '{}') as unknown;
  } catch {
    throw Error('invalid_json');
  }
}
