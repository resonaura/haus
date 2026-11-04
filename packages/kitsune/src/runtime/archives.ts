/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { Parser } from 'tar';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unzipSync } from 'fflate';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const limit = 128 * 1024 ** 2;
export function archivePath(path: string) {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.includes(':') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..')
  )
    throw Error('kitsune_unsafe_archive_path');
  return path.replace(/^\.\//, '');
}
/** Link-free bounded tar reader, also used by the declaration-only compatibility checker. */
export async function tarFiles(bytes: Buffer, select: (path: string) => boolean = () => true) {
  const files = new Map<string, Buffer>();
  let total = 0,
    count = 0;
  const parser = new Parser({
    strict: true,
    onReadEntry(entry) {
      let path: string;
      try {
        path = archivePath(entry.path);
      } catch {
        parser.abort(Error('kitsune_unsafe_archive_path'));
        entry.resume();
        return;
      }
      if (
        ++count > 20000 ||
        !['File', 'Directory', 'ExtendedHeader', 'GlobalExtendedHeader'].includes(entry.type)
      ) {
        parser.abort(Error('kitsune_unsupported_archive_entry'));
        entry.resume();
        return;
      }
      if (entry.type !== 'File' || !select(path)) {
        entry.resume();
        return;
      }
      total += entry.size;
      if (total > limit || files.has(path)) {
        parser.abort(Error('kitsune_archive_limit'));
        entry.resume();
        return;
      }
      const chunks: Buffer[] = [];
      entry.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      entry.on('end', () => files.set(path, Buffer.concat(chunks)));
    },
  });
  await pipeline(Readable.from(bytes), parser);
  return files;
}
export function zipFiles(bytes: Buffer) {
  let total = 0,
    count = 0;
  return new Map(
    Object.entries(
      unzipSync(bytes, {
        filter(file) {
          archivePath(file.name);
          if (++count > 20000 || (total += file.originalSize) > limit)
            throw Error('kitsune_archive_limit');
          return !file.name.endsWith('/');
        },
      }),
    ).map(([name, data]) => [name, Buffer.from(data)]),
  );
}
export async function writeArchive(directory: string, files: Map<string, Buffer>, prefix = '') {
  for (const [path, data] of files) {
    if (/(?:^|\/)node_modules\/@scrypted\/(?:sdk|server)(?:\/|$)/.test(path))
      throw Error('kitsune_forbidden_package');
    if (prefix && !path.startsWith(prefix)) continue;
    const relative = archivePath(path.slice(prefix.length));
    if (!relative) continue;
    const target = join(directory, relative);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { mode: 0o600, flag: 'wx' });
  }
}
