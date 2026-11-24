/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { requireGpuiBun } from '../../src/gpui/bun.js';

requireGpuiBun();

const reopen = process.argv.includes('--reopen');
const recover = process.argv.includes('--recover');
assert(!(reopen && recover), 'Run camera reopening and stalled-stream recovery separately.');
const worker = fileURLToPath(new URL(reopen ? './reopen.tsx' : './video.tsx', import.meta.url));
const { stdout, stderr } = await promisify(execFile)(
  process.execPath,
  ['--conditions=development', worker, ...process.argv.slice(2)],
  { timeout: 45_000 },
);
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
assert.doesNotMatch(stderr, /\[gpuix\] runtime error:/, 'GPUIX reported a runtime error.');
// AppKit can exit successfully before Bun runs any assertions after closing the window.
assert(
  stdout.includes('Desktop shutdown released its camera stream.'),
  'GPUIX exited before camera shutdown was verified.',
);
if (recover) {
  assert(
    stdout.includes('A stalled HLS stream recovered in the same window.'),
    'GPUIX exited before recovery was verified.',
  );
}
if (reopen) {
  assert(
    stdout.includes('Camera playback reopened after the previous lease was released.'),
    'GPUIX exited before camera reopening was verified.',
  );
}
