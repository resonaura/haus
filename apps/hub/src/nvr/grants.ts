/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { digestPattern } from './blobs.js';

export interface MediaGrant {
  path: string;
  expiresAt: number;
}

const signature = (key: string, digest: string, expires: string, nonce: string) =>
  createHmac('sha256', key).update(['media', digest, expires, nonce].join('\n')).digest('hex');

export function mediaGrant(key: string, digest: string, now = Date.now()): MediaGrant {
  if (!digestPattern.test(digest)) throw new Error('invalid_digest');
  const expires = String(now + 120000);
  const nonce = randomBytes(16).toString('hex');
  return {
    path: `/media/${digest}?expires=${expires}&nonce=${nonce}&signature=${signature(key, digest, expires, nonce)}`,
    expiresAt: Number(expires),
  };
}

export function verifyGrant(key: string, url: URL, now = Date.now()): string | null {
  const match = /^\/media\/([a-f0-9]{64})$/.exec(url.pathname);
  if (!match) return null;
  const expires = url.searchParams.get('expires');
  const nonce = url.searchParams.get('nonce');
  const sig = url.searchParams.get('signature');
  if (
    expires === null ||
    nonce === null ||
    sig === null ||
    !/^\d{13}$/.test(expires) ||
    Number(expires) < now ||
    Number(expires) > now + 120000 ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !digestPattern.test(sig)
  )
    return null;
  const expected = signature(key, match[1], expires, nonce);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? match[1] : null;
}
