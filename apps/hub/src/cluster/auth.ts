/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function sign(
  key: string,
  method: string,
  path: string,
  digest = EMPTY_DIGEST,
  now = Date.now(),
  nonce = randomBytes(16).toString('hex'),
): {
  'x-haus-time': string;
  'x-haus-nonce': string;
  'x-haus-digest': string;
  'x-haus-signature': string;
} {
  const time = String(now);
  const signature = createHmac('sha256', key)
    .update([method, path, time, nonce, digest].join('\n'))
    .digest('hex');
  return {
    'x-haus-time': time,
    'x-haus-nonce': nonce,
    'x-haus-digest': digest,
    'x-haus-signature': signature,
  };
}

export interface AuthenticatableRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}

export function authenticator(
  key: string,
  clock: () => number = () => Date.now(),
): (req: AuthenticatableRequest) => boolean {
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32)
    throw new Error('A unique node key of at least 32 bytes is required');
  const nonces = new Map<string, number>();
  return (req: AuthenticatableRequest) => {
    const time = req.headers['x-haus-time'];
    const nonce = req.headers['x-haus-nonce'];
    const digest = req.headers['x-haus-digest'];
    const signature = req.headers['x-haus-signature'];
    const now = clock();
    if (
      typeof time !== 'string' ||
      typeof nonce !== 'string' ||
      typeof digest !== 'string' ||
      typeof signature !== 'string' ||
      !/^\d{13}$/.test(time) ||
      Math.abs(now - Number(time)) > 60000 ||
      !/^[a-f0-9]{32}$/.test(nonce) ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      return false;
    for (const [id, at] of nonces) if (now - at > 65000) nonces.delete(id);
    if (nonces.has(nonce) || nonces.size >= 10000) return false;
    const expected = sign(key, req.method ?? '', req.url ?? '', digest, Number(time), nonce)[
      'x-haus-signature'
    ];
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
    nonces.set(nonce, now);
    return true;
  };
}
