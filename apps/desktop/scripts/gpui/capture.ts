/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export async function captureMovingFrames(
  renderer: { captureScreenshot(path: string): void },
  first: string,
  next: string,
  assertPlaying: () => void | Promise<void>,
): Promise<void> {
  await delay(300);
  await assertPlaying();
  renderer.captureScreenshot(first);
  const initial = await readFile(first);
  const deadline = performance.now() + 4000;
  do {
    await delay(350);
    await assertPlaying();
    renderer.captureScreenshot(next);
    if (!initial.equals(await readFile(next))) return;
  } while (performance.now() < deadline);
  assert.fail('Camera frames did not change within four seconds.');
}
