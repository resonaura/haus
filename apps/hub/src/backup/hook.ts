/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotCatalog } from '../storage/index.js';
import { CATALOG_SNAPSHOT } from './backups.service.js';

export async function runBackupHook(
  mode = process.argv[2],
  root = process.env.HAUS_DATA || '/data',
): Promise<void> {
  const directory = join(root, 'restore');
  if (mode === 'post') {
    await rm(directory, { recursive: true, force: true });
  } else {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, 'catalog.partial.sqlite');
    await rm(temporary, { force: true });
    await snapshotCatalog(join(root, 'haus.sqlite'), temporary);
    await rename(temporary, join(directory, CATALOG_SNAPSHOT));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runBackupHook();
}
