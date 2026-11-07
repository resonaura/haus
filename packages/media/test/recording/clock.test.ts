/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";





import { CameraRing } from "@haus/media";



test("ring media clocks stay fixed across samples and restart independently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "haus-ring-clock-"));
  const ring = new CameraRing(root, "rtsp://127.0.0.1:8554/fixture", {
    now: () => 108000,
    probe: async () => ({ video: true, audio: true, duration: 2 }),
  });
  t.onTestFinished(async () => {
    await ring.stop();
    await rm(root, { recursive: true, force: true });
  });
  const files: Array<[string,number]> = [
    ["000000000000.ts", 102],
    ["000000000001.ts", 104.8],
    ["001000000000.ts", 108],
  ];
  for (const [name, at] of files) {
    await writeFile(join(root, name), "fixture");
    await utimes(join(root, name), at, at);
  }
  await writeFile(
    join(root, "segments-000.csv"),
    "000000000000.ts,0,2\n000000000001.ts,2,4\n",
  );
  await writeFile(join(root, "segments-001.csv"), "001000000000.ts,0,2\n");
  await ring.sample();
  assert.deepEqual(
    ring.segments.map((s) => [s.startAt, s.endAt]),
    [
      [100000, 102000],
      [102000, 104000],
      [106000, 108000],
    ],
  );
  assert.equal(ring.runClocks.size, 2);
  await utimes(join(root, "000000000000.ts"), 103, 103);
  await ring.sample();
  assert.deepEqual(
    ring.segments.map((s) => [s.startAt, s.endAt]),
    [
      [100000, 102000],
      [102000, 104000],
      [106000, 108000],
    ],
  );
});