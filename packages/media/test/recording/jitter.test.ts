/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { ProcessFixture, spawnFixture } from '../support/process.js';
import { required } from '../support/values.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomUUID } from "node:crypto";



import { CameraRing, cameraProcess } from "@haus/media";


test("stream-copy ring tolerates file-write jitter but rejects real missing footage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "haus-ring-fixture-"));
  let at = 100000;
  const reservations: number[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  const saved: unknown[] = [];
  const ring = new CameraRing(root, "rtsp://127.0.0.1:8554/fixture", {
    now: () => at,
    log: (event, fields) => diagnostics.push({ event, ...fields }),
    onRecordingReady: async (job) => {
      assert.ok((await stat(required(job.output))).size > 0);
      assert.equal(required(job.result).audio, true);
      saved.push(job.metadata);
    },
    reserve: async (bytes) => {
      reservations.push(bytes);
      return () => { reservations.splice(reservations.indexOf(bytes), 1); };
    },
    spawnProcess: spawnFixture((_file,args) => {assert.equal(args.includes('copy'),true);assert.equal(args.includes('libx264'),false);return new ProcessFixture();}),
  });
  t.onTestFinished(async () => {
    await ring.stop();
    await rm(root, { recursive: true, force: true });
  });
  await ring.start();
  await cameraProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=20",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000",
    "-t",
    "12",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-preset",
    "ultrafast",
    "-g",
    "40",
    "-c:a",
    "aac",
    "-f",
    "segment",
    "-segment_format",
    "mpegts",
    "-segment_time",
    "2",
    "-reset_timestamps",
    "1",
    "-segment_list",
    join(root, "segments.csv"),
    "-segment_list_type",
    "csv",
    join(root, "%09d.ts"),
  ]);
  for (let i = 0; i < 6; i++) {
    // Real P2P delivery and filesystem scheduling move close mtimes without
    // introducing a gap in the encoded media clock. The old per-file clock
    // mapping rejected these complete recordings as incomplete.
    const timestamp = 90 + i * 2 + (i % 2 ? 0.8 : 0);
    await utimes(
      join(root, `${String(i).padStart(9, "0")}.ts`),
      timestamp,
      timestamp,
    );
  }
  await ring.sample();
  assert.equal(ring.ready(), true);
  const eventId = randomUUID();
  const event = {
    id: eventId,
    cameraId: "camera.fixture",
    startAt: 100000,
    endAt: 101000,
    kinds: ["motion"],
  };
  await ring.record({
    eventId,
    startAt: 92000,
    endAt: 100000,
    metadata: event,
  });
  at = 103000;
  await ring.sample();
  await ring.finalizing;
  const job = ring.jobs.get(eventId);
  assert.equal(job.state, "ready");
  assert.equal(required(job.result).audio, true);
  assert.ok(job.result.mediaStartAt <= 92000);
  assert.ok(job.result.duration >= 8);
  assert.deepEqual(
    saved,
    [event],
    "durable output receives original trigger metadata, not its pre-roll-adjusted window",
  );
  const metadata = JSON.parse(
    await cameraProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      job.output,
    ]),
  );
  assert.equal(
    metadata.streams.some((row) => row.codec_type === "audio"),
    true,
  );

  // Omitting a real media segment must still fail. The change is only the
  // wall-clock mapping; it must not turn an actual hole into a valid clip.
  const csv = await readFile(join(root, "segments.csv"), "utf8");
  await writeFile(
    join(root, "segments.csv"),
    csv
      .split("\n")
      .filter((_, index) => index !== 3)
      .join("\n"),
  );
  await ring.sample();
  const missingId = randomUUID();
  await ring.record({ eventId: missingId, startAt: 92000, endAt: 100000 });
  await ring.finalizing;
  assert.equal(ring.jobs.get(missingId).state, "failed");
  assert.equal(
    reservations.length,
    2,
    "failed capture releases its disk reservation after cleanup",
  );
  assert.deepEqual(diagnostics, [
    {
      event: "recording_finalization_failed",
      eventId: missingId,
      stage: "coverage",
      reason: "camera_recording_incomplete",
      parts: 3,
      coverage: { missingStartMs: 0, missingEndMs: 0, largestGapMs: 2000 },
    },
  ]);
  assert.ok(
    (await stat(required(job.output))).size > 0,
    "a later failure cannot remove the earlier original",
  );
  await ring.stop();
  assert.equal(reservations.length, 0);
});