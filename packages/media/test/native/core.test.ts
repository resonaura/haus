/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const native = fileURLToPath(new URL('../../native/', import.meta.url));
const compiler = process.env.CXX || 'c++';
const available = spawnSync(compiler, ['--version']);
const regressions = [
  ['continuity', 'preserves RTP sequence and media clocks across restarts and burst ingress'],
  ['writer', 'completes partial interleaved frames and bounds stalled readers'],
  ['pacer', 'spreads frame bursts and resumes promptly after an idle interval'],
];
for (const [file, behavior] of regressions) {
  it(
    behavior,
    async (context) => {
      if (
        process.platform === 'win32' ||
        (available.error && 'code' in available.error && available.error.code === 'ENOENT')
      ) {
        context.skip('POSIX C++ fixture requires an available compiler');
        return;
      }
      const directory = await mkdtemp(join(tmpdir(), 'haus-media-native-'));
      try {
        const binary = join(directory, 'regression');
        // Release-mode assertions must remain active: several fixture operations live in assert().
        const compile = spawnSync(
          compiler,
          [
            '-std=c++17',
            '-O2',
            '-DNDEBUG',
            '-pthread',
            '-I',
            join(native, 'src'),
            join(native, 'tests', file + '.cpp'),
            '-o',
            binary,
          ],
          { encoding: 'utf8', timeout: 30000 },
        );
        expect(compile.error, compile.stderr).toBeUndefined();
        expect(compile.status, compile.stderr).toBe(0);
        const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
        expect(result.error, result.stderr).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    45000,
  );
}
