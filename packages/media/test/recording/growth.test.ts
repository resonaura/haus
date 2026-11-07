/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { spawnFixture } from '../support/process.js';


import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat, utimes, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomUUID } from "node:crypto";



import { CameraRing } from "@haus/media";


for (const denied of [false,true]) test('capture reservation growth: '+(denied?'exhausted':'growing'), async t => {
      const root = await mkdtemp(join(tmpdir(), "haus-ring-growth-"));
      let reserved = 0;
      const limit = (denied ? 96 : 128) * 1024 ** 2;
      const diagnostics: Array<Record<string, unknown>> = [];
      const ring = new CameraRing(root, "rtsp://127.0.0.1/fixture", {
        now: () => 100000,
        probe: async () => ({ video: true, audio: true, duration: 2 }),
        log: (event, fields) => diagnostics.push({ event, ...fields }),
        reserve: async (bytes) => {
          if (reserved + bytes > limit) throw Error("storage_full");
          reserved += bytes;
          let released = false;
          return () => {
            if (!released) {
              released = true;
              reserved -= bytes;
            }
          };
        },
        spawnProcess: spawnFixture(),
      });
      t.onTestFinished(async () => {
        await ring.stop();
        await rm(root, { recursive: true, force: true });
      });
      await ring.start();
      const saved = join(root, "prior-saved.mp4");
      await writeFile(saved, "completed original");
      for (let i = 0; i < 2; i++) {
        const file = join(root, String(i).padStart(9, "0") + ".ts");
        await writeFile(file, "encoded");
        await truncate(file, 12 * 1024 ** 2);
        await utimes(file, 98 + i * 2, 98 + i * 2);
      }
      await writeFile(
        join(root, "segments.csv"),
        "000000000.ts,0,2\n000000001.ts,2,4\n",
      );
      await ring.sample();
      const id = randomUUID();
      const result = await ring.record({
        eventId: id,
        startAt: 96000,
        endAt: 102000,
      });
      if (denied) {
        assert.equal(result.state, "failed");
        assert.equal(reserved, 64 * 1024 ** 2);
        await assert.rejects(stat(ring.jobs.get(id).root), { code: "ENOENT" });
        assert.deepEqual(diagnostics, [
          {
            event: "recording_finalization_failed",
            eventId: id,
            stage: "capture",
            reason: "storage_full",
            parts: 1,
          },
        ]);
      } else {
        assert.equal(result.state, "recording");
        assert.equal(reserved, limit);
        assert.equal(ring.jobs.get(id).bytes, 24 * 1024 ** 2);
        assert.equal(
          (await stat(join(ring.jobs.get(id).root, "000000001.ts"))).size,
          12 * 1024 ** 2,
        );
        await ring.removeRecording(id);
        assert.equal(reserved, 64 * 1024 ** 2);
      }
      assert.equal(await readFile(saved, "utf8"), "completed original");
      await ring.stop();
      assert.equal(reserved, 0);
    });
