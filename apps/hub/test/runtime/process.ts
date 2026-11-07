/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute, dirname, join } from 'node:path';
import { port } from '../nvr/support/values.js';

// Process fixtures must run the compiled application, regardless of Vitest's development condition.
export const hubEntrypoint =
  process.env.HAUS_HUB_TEST_ENTRYPOINT ??
  fileURLToPath(new URL('../../dist/main.js', import.meta.url));
if (!isAbsolute(hubEntrypoint)) throw Error('fixture_entrypoint_must_be_absolute');

export function healthProbe(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [join(dirname(hubEntrypoint), 'cli/health.js')],
      { env, timeout: 5000, maxBuffer: 1024 },
      (error, stdout, stderr) => {
        const code = error?.code;
        if (error && (typeof code !== 'number' || error.killed)) reject(error);
        else resolve({ code: typeof code === 'number' ? code : 0, stdout, stderr });
      },
    ),
  );
}

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
