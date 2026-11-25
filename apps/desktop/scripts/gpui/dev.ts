/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();

const bunBinary = join(
  process.env.HOME ?? '',
  '.bun/bin',
  process.platform === 'win32' ? 'bun.exe' : 'bun',
);
const executable = process.versions.bun ? process.execPath : bunBinary;
const result = spawnSync(
  executable,
  ['--hot', '--conditions=development', 'src/gpui/index.tsx', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? (result.signal ? 1 : 0));
