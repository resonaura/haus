/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomBytes } from 'node:crypto';
import type { PrivateFiles } from './files.js';

export async function loadKey(files: PrivateFiles): Promise<Buffer> {
  let key = await files.read('key');
  if (!key) {
    if (await files.vaultExists()) throw Error('vault_key_missing');
    const candidate = randomBytes(32);
    try {
      await files.publish('key', candidate);
    } finally {
      candidate.fill(0);
    }
    key = await files.read('key');
  }
  if (!key || key.length !== 32) {
    key?.fill(0);
    throw Error('vault_key_invalid');
  }
  return key;
}
