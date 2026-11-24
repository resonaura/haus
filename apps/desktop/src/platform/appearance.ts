/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Preferences } from '@haus/ha/view/preferences';

export async function openDesktopAppearance(directory: string) {
  const path = join(directory, 'appearance');
  let theme: Preferences['theme'] = 'system';
  try {
    const saved = (await readFile(path, 'utf8')).trim();
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  return {
    theme,
    async save(next: Preferences['theme']) {
      // The process holding the credential-store owner lock is the only writer.
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${next}\n`, { mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
