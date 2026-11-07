/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const json = (res: ServerResponse, status: number, value: unknown): void => {
  res
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify(value));
};

export async function body(req: IncomingMessage, max = 65536): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const value of req) {
    if (!Buffer.isBuffer(value) && typeof value !== 'string') throw Error('invalid_body');
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > max) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const header = req.headers['x-haus-digest'];
  const expected = typeof header === 'string' ? header : undefined;
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('digest_mismatch');
  try {
    return JSON.parse(bytes.toString()) as unknown;
  } catch {
    throw Error('invalid_json');
  }
}
