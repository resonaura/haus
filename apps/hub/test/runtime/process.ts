/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { port } from '../nvr/support/values.js';

// Process fixtures must run the compiled application, regardless of Vitest's development condition.
export const hubEntrypoint =
  process.env.HAUS_HUB_TEST_ENTRYPOINT ??
  fileURLToPath(new URL('../../dist/main.js', import.meta.url));
if (!isAbsolute(hubEntrypoint)) throw Error('fixture_entrypoint_must_be_absolute');

export async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const value = port(listener);
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return value;
}
