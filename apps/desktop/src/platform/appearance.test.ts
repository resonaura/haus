/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDesktopAppearance } from './appearance.js';

it('persists the selected appearance and recovers an unrecognized preference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'haus-desktop-appearance-'));
  try {
    const store = await openDesktopAppearance(directory);
    expect(store.theme).toBe('system');
    await store.save('light');
    expect((await openDesktopAppearance(directory)).theme).toBe('light');
    await store.save('dark');
    expect((await openDesktopAppearance(directory)).theme).toBe('dark');
    expect(await readdir(directory)).toEqual(['appearance']);
    await writeFile(join(directory, 'appearance'), 'invalid');
    expect((await openDesktopAppearance(directory)).theme).toBe('system');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
