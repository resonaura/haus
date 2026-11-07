/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { engineFixture, ringFixture, recordingFixture } from '../support/camera.js';
import { required, record } from '../support/values.js';
import type { CameraSessionsRing } from '../../../src/nvr/camera/contracts.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CameraActivity } from "../../../src/nvr/index.js";
import { CameraSessions } from "../../../src/nvr/index.js";
import { Detectors, type VisionWorkerOptions } from "@haus/ai";

test("explicit Assist assignment survives controller lease loss, shares one producer, creates/extends canonical pre-event IDs and revokes cleanly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "haus-autonomous-activity-"));
  let at = Date.now(),
    added = 0,
    workerOptions: VisionWorkerOptions | undefined,
    stopped = 0;
  const engine = engineFixture({
    viewers: new Map(),
    initialize: async () => {},
    add: async () => {
      added++;
    },
    remove: async () => {},
    localRtsp: () => "rtsp://127.0.0.1:8554/private",
    stop: async () => {},
  });
  let ring: CameraSessionsRing | undefined;
  const cameras = await new CameraSessions(join(root, "sessions"), engine, {
    max: 1,
    now: () => at,
    ring: () => {
      const state = ringFixture(at);
      state.record = async value => { const old = state.jobs.get(value.eventId); const job=recordingFixture(value); state.jobs.set(job.id,job); return old ?? job; };
      ring = state; return state;
    },
  }).initialize();
  const capacity = {
    detectors: 1,
    memory: 512,
    memoryUsed: 64,
    pressured: false,
  };
  const detectors = new Detectors('', capacity, {
    now: () => at,
    worker: (options) => {
      workerOptions = options;
      return {
        state: "running",
        calibrated: true,
        lastResult: at,
        lastFrame: at,
        stop: async () => {
          stopped++;
        },
      };
    },
  });
  detectors.supported = true;
  detectors.sessions = cameras;
  const path = join(root, "activity.enc"),
    key = "private-node-key-fixture-123456789";
  let activity = await new CameraActivity(path, key, cameras, detectors, {
    now: () => at,
  }).initialize();
  t.onTestFinished(async () => {
    await activity.stop();
    await detectors.stop();
    await cameras.stop();
    await rm(root, { recursive: true, force: true });
  });
  const plan = {
    cameraId: "camera.fixture",
    source: {
      kind: "p2p-restream",
      url: "rtsp://u:secret-p2p@192.168.1.9:8556/live",
    },
    advertiseHost: "192.168.1.5",
    preRollSeconds: 8,
    requireAudio: true,
    recordAudio: true,
    expiresAt: at + 86400000,
    policyId: randomUUID(),
    mode: "objects",
    postRollSeconds: 20,
    maxEventSeconds: 300,
  };
  assert.equal(
    detectors.jobs.size,
    0,
    "Assist stays off until an explicit valid policy",
  );
  await cameras.acquire({ ...plan, owner: "controller-recording-fixture" });
  await activity.update([plan]);
  assert.equal(added, 1);
  assert.equal(detectors.jobs.size, 1);
  assert.equal(required(workerOptions).source, "rtsp://127.0.0.1:8554/private");
  assert.equal(
    (await readFile(path)).includes(Buffer.from("secret-p2p")),
    false,
  );
  at += 40000;
  await activity.tick();
  at += 25000;
  required(ring).freshAt = at;
  await cameras.tick();
  await activity.tick();
  assert.equal(added, 1);
  assert.equal(cameras.sessions.size, 1);
  assert.equal(detectors.jobs.size, 1);
  required(required(workerOptions).onDetection)({ kind: "person", at });
  await activity.tick();
  const first = required(activity.status().cameras[0].events.at(-1));
  assert.ok(first.recordedEventId);
  assert.equal(first.recordingManaged, true);
  const capture = required(required(ring).jobs.get(required(first.recordedEventId)));
  assert.equal(capture.startAt, at - 8000);
  assert.equal(capture.metadata.startAt, at);
  assert.equal(record(required(capture.metadata).origin).policyId, plan.policyId);
  const requestId = randomUUID();
  const native = {
    cameraId: plan.cameraId,
    policyId: plan.policyId,
    requestId,
    kind: "person",
    at,
  };
  const accepted = await activity.trigger(native);
  assert.equal(
    accepted.recordedEventId,
    first.recordedEventId,
    "native and software activity share the same capture",
  );
  assert.deepEqual(await activity.trigger(native), accepted);
  assert.equal(required(ring).jobs.size, 1);
  at += 4000;
  required(required(workerOptions).onDetection)({ kind: "pet", at });
  await activity.tick();
  assert.equal(required(ring).jobs.size, 1);
  assert.equal(required(required(ring).jobs.get(required(first.recordedEventId))).endAt, at + 20000);
  capacity.detectors = 0;
  await detectors.remove(required(detectors.jobs.keys().next().value));
  at += 4000;
  await activity.tick();
  assert.equal(detectors.jobs.size, 0);
  assert.equal(activity.status().cameras[0].state, "waiting");
  const fallback = await activity.trigger({
    ...native,
    requestId: randomUUID(),
    kind: "doorbell",
    at,
  });
  assert.equal(
    fallback.recordedEventId,
    first.recordedEventId,
    "native semantic capture stays available when analysis has no quota",
  );
  assert.equal(cameras.sessions.size, 1);
  capacity.detectors = 1;
  at += 10001;
  await activity.tick();
  assert.equal(detectors.jobs.size, 1);
  at += 301000;
  required(ring).freshAt = at;
  required(required(workerOptions).onDetection)({ kind: "person", at });
  await activity.tick();
  assert.equal(
    required(ring).jobs.size,
    2,
    "maximum event duration rotates the event ID",
  );
  await assert.rejects(
    activity.update([{ ...plan, mode: "all-pixels" }]),
    /invalid_camera_activity/,
  );
  assert.equal(detectors.jobs.size, 1);
  await activity.stop();
  assert.equal(detectors.jobs.size, 0);
  activity = await new CameraActivity(path, key, cameras, detectors, {
    now: () => at,
  }).initialize();
  for (let i = 0; i < 30 && !detectors.jobs.size; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    detectors.jobs.size,
    1,
    "encrypted explicit policy restores after the node policy manager restarts",
  );
  await activity.update([]);
  assert.equal(detectors.jobs.size, 0);
  assert.ok(stopped >= 2);
  assert.equal(activity.status().cameras.length, 0);
  await activity.update([plan]);
  at = plan.expiresAt + 1;
  await activity.tick();
  assert.equal(
    detectors.jobs.size,
    0,
    "expired policy cannot keep inference alive",
  );
});
