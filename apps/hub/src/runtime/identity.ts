/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isErrCode } from '../nvr/blob-readers.js';

async function read(path: string): Promise<string | undefined> {
  try {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 256) throw Error('invalid_nvr_identity');
      const value = (await handle.readFile('utf8')).trim();
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
        throw Error('invalid_nvr_identity');
      return value;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isErrCode(error, 'ENOENT')) return undefined;
    throw error;
  }
}

/** Preserve the installed instance-id; publish complete new identities without replacing a winner. */
export async function nvrIdentity(root: string): Promise<string> {
  const target = join(root, 'instance-id');
  const existing = await read(target);
  if (existing !== undefined) return existing;
  const temporary = join(root, `.instance-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(randomUUID());
    await handle.sync();
    await handle.close();
    try {
      await link(temporary, target);
      if (process.platform !== 'win32') {
        const directory = await open(root, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      if (!isErrCode(error, 'EEXIST')) throw error;
    }
  } finally {
    try {
      await handle.close();
    } finally {
      await unlink(temporary);
    }
  }
  const value = await read(target);
  if (value === undefined) throw Error('nvr_identity_unavailable');
  return value;
}
