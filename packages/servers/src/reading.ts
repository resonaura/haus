/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { readFile } from 'node:fs/promises';

/** Binary firmware stays byte-exact; textual proc/sys files request their encoding explicitly. */
export async function readHostFile(path: string, encoding?: string): Promise<string | Buffer> {
  if (encoding === undefined) return readFile(path);
  if (!Buffer.isEncoding(encoding)) throw Error('invalid_host_file_encoding');
  return readFile(path, encoding);
}
