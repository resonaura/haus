/*
 * Haus — A thoughtful home for Haus Hub.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createDecipheriv, randomUUID } from 'node:crypto';
import { open, link, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Offline kit decrypt: verifies, never overwrites an existing archive, never auto-applies. */
export async function decryptBackup(
  input: string,
  output: string,
  key: string,
): Promise<Record<string, unknown>> {
  const fd = await open(input, 'r');
  let header: Buffer;
  let tag: Buffer;
  let size: number;
  let offset: number;
  try {
    size = (await fd.stat()).size;
    const prefix = Buffer.alloc(4);
    await fd.read(prefix, 0, 4, 0);
    const length = prefix.readUInt32BE();
    if (length < 1 || length > 16384 || size < length + 20) throw new Error('Invalid backup');
    header = Buffer.alloc(length);
    await fd.read(header, 0, length, 4);
    offset = length + 4;
    tag = Buffer.alloc(16);
    await fd.read(tag, 0, 16, size - 16);
  } finally {
    await fd.close();
  }
  const metadata: unknown = JSON.parse(header.toString('utf8'));
  if (
    !isRecord(metadata) ||
    metadata.version !== 1 ||
    typeof metadata.iv !== 'string' ||
    !/^[a-f0-9]{24}$/.test(metadata.iv) ||
    !/^[a-f0-9]{64}$/.test(key)
  )
    throw new Error('Invalid recovery key or backup version');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(metadata.iv, 'hex'),
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const temporary = `${output}.unverified-${randomUUID()}`;
  try {
    await pipeline(
      createReadStream(input, { start: offset, end: size - 17 }),
      decipher,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    // Never overwrite an existing archive, and never extract/apply a backup automatically.
    await link(temporary, output);
    return metadata;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
