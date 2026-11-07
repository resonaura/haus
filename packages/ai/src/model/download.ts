/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';

export const MAX_MODEL_BYTES = 64 * 1024 ** 2;

function manifest(value: unknown): { url: URL; sha256: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('url' in value) ||
    typeof value.url !== 'string' ||
    !('revision' in value) ||
    typeof value.revision !== 'string' ||
    !/^[a-f\d]{40}$/.test(value.revision) ||
    !('sha256' in value) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f\d]{64}$/.test(value.sha256)
  )
    throw Error('invalid_vision_model_manifest');
  const url = new URL(value.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.includes('/' + value.revision + '/')
  )
    throw Error('invalid_vision_model_origin');
  return { url, sha256: value.sha256 };
}

/** Verify a bounded download before replacing the current model on the same filesystem. */
export class ModelInstaller {
  constructor(private readonly request: typeof fetch = fetch) {}

  async install(value: unknown, output: string): Promise<void> {
    const source = manifest(value);
    const response = await this.request(source.url, {
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw Error('vision_model_download_failed');
    }
    const reader = response.body.getReader();
    const temporary = output + '.' + randomUUID() + '.tmp';
    let created = false;
    try {
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MODEL_BYTES))
        throw Error('vision_model_size_limit');
      const file = await open(temporary, 'wx', 0o644);
      created = true;
      try {
        const hash = createHash('sha256');
        let size = 0;
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          size += chunk.length;
          if (size > MAX_MODEL_BYTES) throw Error('vision_model_size_limit');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
        if (!size || hash.digest('hex') !== source.sha256)
          throw Error('vision_model_digest_mismatch');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, output);
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
        if (created) await rm(temporary, { force: true });
      }
    }
  }
}
