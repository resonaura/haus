/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm, copyFile, link, unlink, open } from 'node:fs/promises';
import { createWriteStream, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { decryptBackup, isRecord } from '../nvr/recovery.js';
import { isErrCode } from '../nvr/blob-readers.js';
import { RecoveryClient, readRecoveryKit } from './client.js';
import { recoveryOptions, digestPattern } from './options.js';

export async function recover(
  args: string[],
  write: (value: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const options = recoveryOptions(args);
  const kit = await readRecoveryKit(options.kit, options.node);
  const client = new RecoveryClient(kit.node, signal);
  if (options.action === 'recordings' || options.action === 'backups') {
    const path =
      options.action === 'backups'
        ? '/v1/backups'
        : '/v1/recordings' +
          (options.cursor ? '?cursor=' + encodeURIComponent(options.cursor) : '');
    write(JSON.stringify(await client.json(path), null, 2));
    return;
  }
  let digest = options.digest;
  if (options.action === 'recording') {
    const record = await client.json('/v1/recordings/' + options.recording);
    if (!isRecord(record) || typeof record.digest !== 'string')
      throw Error('invalid_recording_metadata');
    digest = record.digest;
  }
  if (!digest || !digestPattern.test(digest) || !options.output)
    throw Error('invalid_recovery_export');
  if (options.action === 'backup' && (!kit.key || !digestPattern.test(kit.key)))
    throw Error('invalid_recovery_key');
  const directory = await mkdtemp(join(tmpdir(), 'haus-recovery-'));
  try {
    const response = await client.request('/v1/blobs/' + digest);
    if (!response.body) throw Error('missing_recovery_body');
    const hash = createHash('sha256');
    let bytes = 0;
    const file = join(directory, 'verified');
    await pipeline(
      Readable.from(response.body),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > 20 * 1024 ** 3) return callback(Error('recovery_budget_exceeded'));
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    if (hash.digest('hex') !== digest) throw Error('recovery_checksum_mismatch');
    signal?.throwIfAborted();
    const output = resolve(options.output);
    if (options.action === 'recording') {
      const temporary = output + '.verified-' + randomUUID();
      const errors: unknown[] = [];
      try {
        await copyFile(file, temporary, constants.COPYFILE_EXCL);
        const handle = await open(temporary, 'r+');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        signal?.throwIfAborted();
        await link(temporary, output);
      } catch (error) {
        errors.push(error);
      }
      try {
        await unlink(temporary);
      } catch (error) {
        if (!isErrCode(error, 'ENOENT')) errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'recording_export_failed');
      write('Verified recording exported. No home configuration was changed.');
    } else {
      if (!kit.key) throw Error('invalid_recovery_key');
      const metadata = await decryptBackup(file, output, kit.key);
      write(
        `Verified ${metadata.kind === 'ha' ? 'Home Assistant' : 'Haus'} backup exported. No system configuration was changed.`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
