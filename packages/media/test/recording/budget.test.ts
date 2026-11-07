/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { spawnFixture } from '../support/process.js';
import { required } from '../support/values.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomUUID } from "node:crypto";



import { CameraRing } from "@haus/media";



test("three short captures share a bounded disk budget instead of reserving a GiB each", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "haus-ring-budget-"));
  const rings: CameraRing[] = [];
  let reserved = 0,
    peak = 0;
  const limit = 320 * 1024 ** 2;
  const reserve = async (bytes: number) => {
    if (reserved + bytes > limit) throw Error("storage_full");
    reserved += bytes;
    peak = Math.max(peak, reserved);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        reserved -= bytes;
      }
    };
  };
  t.onTestFinished(async () => {
    await Promise.all(rings.map((r) => r.stop()));
    await rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 3; i++) {
    const dir = join(root, String(i));
    await mkdir(dir);
    const ring = new CameraRing(dir, "rtsp://127.0.0.1/fixture", {
      reserve,
      now: () => 100000,
      probe: async () => ({ video: true, audio: true, duration: 2 }),
      spawnProcess: spawnFixture(),
    });
    rings.push(ring);
    await ring.start();
    await writeFile(join(dir, "000000000.ts"), "encoded-fixture");
    await utimes(join(dir, "000000000.ts"), 100, 100);
    await writeFile(join(dir, "segments.csv"), "000000000.ts,0,2\n");
    await ring.sample();
    const job = await ring.record({
      eventId: randomUUID(),
      startAt: 98000,
      endAt: 102000,
    });
    assert.equal(job.state, "recording");
    assert.equal(ring.jobs.get(job.id).bytes, 15);
  }
  assert.ok(peak <= limit);
  await Promise.all(rings.map((r) => r.stop()));
  assert.equal(reserved, 0);
});

test("a late closing segment gets a bounded grace period without taking a finalizer slot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "haus-ring-late-tail-"));
  let at = 100000,
    finalizers = 0;
  const diagnostics: Array<Record<string, unknown>> = [];
  const ring = new CameraRing(root, "rtsp://127.0.0.1/fixture", {
    now: () => at,
    log: (event, fields) => diagnostics.push({ event, ...fields }),
    probe: async (path) => ({
      video: true,
      audio: true,
      duration: path.endsWith("recording.mp4") ? 14 : 2,
    }),
    run: async (_file, args) => { await writeFile(required(args.at(-1)), "encoded original"); return ""; },
    acquireFinalizer: () => {
      finalizers++;
      return () => finalizers--;
    },
    spawnProcess: spawnFixture(),
  });
  t.onTestFinished(async () => {
    await ring.stop();
    await rm(root, { recursive: true, force: true });
  });
  await ring.start();
  const append = async (first: number, end: number) => {
    for (let i = first; i < end; i++) {
      const file = join(root, String(i).padStart(9, "0") + ".ts");
      await writeFile(file, "encoded");
      await utimes(file, 92 + i * 2, 92 + i * 2);
    }
    await writeFile(
      join(root, "segments.csv"),
      Array.from(
        { length: end },
        (_, i) => `${String(i).padStart(9, "0")}.ts,${i * 2},${(i + 1) * 2}\n`,
      ).join(""),
    );
  };
  await append(0, 4);
  await ring.sample();
  const id = randomUUID();
  await ring.record({ eventId: id, startAt: 92000, endAt: 106000 });
  at = 109000;
  await ring.sample();
  assert.equal(ring.jobs.get(id).state, "recording");
  assert.equal(finalizers, 0);
  // The encoded tail exists but its segment/list closes late after bursty input.
  await append(4, 8);
  at = 110000;
  await ring.sample();
  await ring.finalizing;
  const saved = ring.jobs.get(id);
  assert.equal(saved.state, "ready");
  assert.equal(saved.result.audio, true);
  assert.equal(saved.result.mediaStartAt, 92000);
  assert.equal(saved.result.duration, 14);
  assert.equal(finalizers, 0);

  const absent = randomUUID();
  await ring.record({ eventId: absent, startAt: 104000, endAt: 120000 });
  at = 123000;
  await ring.sample();
  assert.equal(ring.jobs.get(absent).state, "recording");
  at = 135000;
  await ring.sample();
  await ring.finalizing;
  assert.equal(ring.jobs.get(absent).state, "failed");
  assert.deepEqual(diagnostics[0].coverage, {
    missingStartMs: 0,
    missingEndMs: 14000,
    largestGapMs: 0,
  });
  assert.ok((await stat(saved.output)).size > 0);
});