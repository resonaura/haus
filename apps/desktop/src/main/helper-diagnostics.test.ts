/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HelperDiagnostics } from './helper-diagnostics';
import { sanitizeHelperDiagnostic } from '../shared/helper-diagnostics';

it('stores only bounded, redacted Helper failures and rotates safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-helper-log-'));
  try {
    const log = new HelperDiagnostics(directory, 500);
    expect(
      sanitizeHelperDiagnostic({
        operation: 'list-servers',
        outcome: 'failure',
        durationMs: 23.4,
        error: 'password=secret',
        url: 'https://private.example',
      }),
    ).toEqual({ operation: 'list-servers', outcome: 'failure', durationMs: 23 });
    log.write({ operation: 'list-servers', outcome: 'success', durationMs: 5 });
    for (let index = 0; index < 20; index++)
      log.write({
        operation: 'list-cluster',
        outcome: 'failure',
        durationMs: index,
        token: 'secret',
      });
    await log.flush();
    const files = await readdir(directory);
    expect(files.sort()).toEqual(['helper.log', 'helper.previous.log']);
    for (const file of files) {
      const path = join(directory, file);
      const metadata = await stat(path);
      expect(metadata.size).toBeLessThanOrEqual(500);
      expect(metadata.mode & 0o777).toBe(0o600);
      const text = await readFile(path, 'utf8');
      expect(text).not.toMatch(/secret|private\.example|https?:|token=/);
      expect(
        text
          .trim()
          .split('\n')
          .every((line) => {
            const item = JSON.parse(line);
            return item.operation === 'list-cluster' && item.outcome === 'failure';
          }),
      ).toBe(true);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
