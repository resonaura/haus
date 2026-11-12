/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Shared by the App driver and manager so runtime data-root changes stay consistent. */
export class AppOptions {
  constructor(private root: string) {}

  setRoot(root: string): void {
    this.root = root;
  }

  save(appId: string, options: Readonly<Record<string, unknown>>): void {
    persistAppOptions(this.root, appId, options);
  }
}

/** Writes App options as a private, atomically replaced file before the runtime starts. */
export function persistAppOptions(
  dataRoot: string,
  appId: string,
  options: Readonly<Record<string, unknown>>,
): void {
  const directory = join(dataRoot, appId, 'data');
  let temporary: string | undefined;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    temporary = join(directory, `.options-${randomUUID()}.tmp`);
    const serialized = JSON.stringify(options, null, 2);
    if (typeof serialized !== 'string') throw Error('app_options_invalid');
    writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, join(directory, 'options.json'));
  } catch {
    if (temporary) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        throw Error('app_options_cleanup_failed');
      }
    }
    throw Error('app_options_persist_failed');
  }
}
