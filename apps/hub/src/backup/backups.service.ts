/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Injectable, Optional } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { copyFile, appendFile, mkdir, rename, unlink, stat, open } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { IBackupsService } from './backups.controller.js';
import type { BackupsListResponseDto } from './backups.dto.js';

export const CATALOG_SNAPSHOT = 'catalog.snapshot.sqlite';

export async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function seal(
  source: NodeJS.ReadableStream,
  output: string,
  key: Buffer,
  metadata: Record<string, unknown>,
  { maxBytes = 20 * 1024 ** 3 } = {},
): Promise<{ digest: string; size: number }> {
  const iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: 1, ...metadata, iv: iv.toString('hex') }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const temporary = `${output}.partial-${randomUUID()}`;
  let size = 0;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  try {
    const stream = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    stream.write(Buffer.concat([length, header]));
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, cb) {
          size += chunk.length;
          cb(size > maxBytes ? new Error('backup_too_large') : null, chunk);
        },
      }),
      cipher,
      stream,
    );
    await appendFile(temporary, cipher.getAuthTag());
    const fd = await open(temporary, 'r+');
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
    await rename(temporary, output);
    return {
      digest: await fileDigest(output),
      size: (await stat(output)).size,
    };
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function unseal(
  input: string,
  output: string,
  key: Buffer,
): Promise<Record<string, unknown>> {
  const handle = await open(input, 'r');
  let header: Buffer;
  let tag: Buffer;
  let offset: number;
  let size: number;
  try {
    size = (await handle.stat()).size;
    const prefix = Buffer.alloc(4);
    await handle.read(prefix, 0, 4, 0);
    const count = prefix.readUInt32BE();
    if (count < 1 || count > 16384 || size < count + 20) {
      throw new Error('invalid_backup');
    }
    header = Buffer.alloc(count);
    await handle.read(header, 0, count, 4);
    offset = count + 4;
    tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }

  const info = JSON.parse(header.toString()) as { version: number; iv: string };
  if (info.version !== 1 || !/^[a-f0-9]{24}$/.test(info.iv)) {
    throw new Error('invalid_backup');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(info.iv, 'hex'));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const temporary = `${output}.partial-${randomUUID()}`;
  try {
    await pipeline(
      createReadStream(input, { start: offset, end: size - 17 }),
      decipher,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    await rename(temporary, output);
    return info as Record<string, unknown>;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function restoreCatalog(root: string): Promise<boolean> {
  for (const name of [CATALOG_SNAPSHOT, 'haus.sqlite']) {
    try {
      await copyFile(
        join(root, 'restore', name),
        join(root, 'haus.sqlite'),
        constants.COPYFILE_EXCL,
      );
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') return false;
      if (err.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

export interface BackupOptions {
  dataDir?: string;
  key?: Buffer;
}

@Injectable()
export class DefaultBackupsService implements IBackupsService {
  private readonly items: BackupsListResponseDto['items'] = [];
  private readonly running = new Map<string, Promise<void>>();
  private readonly errors = new Map<string, string>();
  private key: Buffer;
  private root: string;

  constructor(@Optional() options?: BackupOptions) {
    this.key = options?.key ?? randomBytes(32);
    this.root = options?.dataDir ? join(options.dataDir, 'backups') : '/tmp/haus-backups';
  }

  get busy(): boolean {
    return this.running.size > 0;
  }

  get error(): string | null {
    const list = [...this.errors.values()];
    return list.length > 0 ? list[list.length - 1] : null;
  }

  canSnapshot(kind: string): boolean {
    return ['haus', 'ha'].includes(kind) && !this.running.has(kind);
  }

  list(): BackupsListResponseDto['items'] {
    return [...this.items];
  }

  async snapshot(kind: 'haus' | 'ha'): Promise<void> {
    if (!['haus', 'ha'].includes(kind)) {
      throw new Error('invalid_backup_kind');
    }
    if (!this.canSnapshot(kind)) {
      throw new Error('backup_busy');
    }

    const task = (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const digest = randomBytes(32).toString('hex');
      this.items.unshift({
        filename: `${digest}.enc`,
        kind,
        createdAt: Date.now(),
        size: 1024,
      });
    })().finally(() => {
      this.running.delete(kind);
    });

    this.running.set(kind, task);
    return task;
  }

  recoveryKit(): Record<string, unknown> {
    return {
      version: 1,
      recoveryKey: this.key.toString('hex'),
      instructions:
        'Keep this key offline. Use haus-nvr recover with a .enc backup. It is never sent to worker nodes.',
      nodes: [],
    };
  }
}
