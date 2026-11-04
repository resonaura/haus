/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** POSIX host adapter; other hosts need an OS credential-store/ACL adapter. */
export class PrivateFiles {
  constructor(private readonly directory: string) {}

  async prepare(): Promise<void> {
    if (typeof process.getuid !== 'function') throw Error('unsupported_private_storage_host');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o077) !== 0
    )
      throw Error('private_storage_permissions');
  }

  async read(name: 'identity' | 'key'): Promise<Buffer | undefined> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.size > 65536 ||
        (info.mode & 0o077) !== 0 ||
        info.uid !== process.getuid?.()
      )
        throw Error('private_file_permissions');
      return await handle.readFile();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw Error('private_file_unavailable');
    } finally {
      await handle?.close();
    }
  }

  async vaultExists(): Promise<boolean> {
    try {
      await lstat(join(this.directory, 'vault.sqlite'));
      return true;
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false;
      throw error;
    }
  }

  /** Publish only complete, fsynced files. Hard-link creation never replaces another writer's key. */
  async publish(name: 'identity' | 'key', bytes: Uint8Array): Promise<void> {
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      try {
        await link(temporary, join(this.directory, name));
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
    } finally {
      await handle.close();
      await rm(temporary, { force: true });
    }
    const directory = await open(
      this.directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
