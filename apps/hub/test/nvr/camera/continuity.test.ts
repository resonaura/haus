/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { engineFixture, ringFixture } from '../support/camera.js';
import { required } from '../support/values.js';
import type { CameraSessionsRing } from '../../../src/nvr/camera/contracts.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CameraSessions } from "../../../src/nvr/index.js";
import { CameraContinuity } from "../../../src/nvr/index.js";

test("an assigned producer survives controller lease loss, restarts from private policy, obeys capacity and stops on revocation/expiry", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "haus-continuity-"));
  let at = Date.now(),
    adds = 0;
  const engine = engineFixture({
    viewers: new Map(),
    initialize: async () => {},
    add: async () => {
      adds++;
    },
    remove: async () => {},
    localRtsp: () => "rtsp://127.0.0.1:8554/local",
    stop: async () => {},
  });
  const create = async () =>
    new CameraSessions(join(root, "sessions"), engine, {
      max: 1,
      now: () => at,
      ring: () => ringFixture(at),
    }).initialize();
  const key = "fixture-private-node-key-more-than-32",
    path = join(root, "continuity.enc");
  let cameras = await create(),
    continuity = await new CameraContinuity(path, key, cameras, {
      now: () => at,
    }).initialize();
  t.onTestFinished(async () => {
    await continuity.stop();
    await cameras.stop();
    await rm(root, { recursive: true, force: true });
  });
  const plan = {
    cameraId: "camera.fixture",
    source: {
      kind: "p2p-restream",
      url: "rtsp://u:source-secret@192.168.1.9:8556/live",
    },
    advertiseHost: "192.168.1.5",
    preRollSeconds: 8,
    requireAudio: true,
    recordAudio: true,
    expiresAt: at + 86400000,
  };
  const controller = await cameras.acquire({
    ...plan,
    owner: "recording-controller-fixture",
  });
  await continuity.update([plan]);
  assert.equal(cameras.sessions.size, 1);
  assert.equal(adds, 1);
  assert.equal(
    required(await readFile(path)).includes(Buffer.from("source-secret")),
    false,
  );
  assert.equal(required(await stat(path)).mode & 0o077, 0);
  at += 40000;
  await continuity.tick();
  at += 25000;
  required(cameras.byCamera.get(plan.cameraId)).ring.freshAt = at;
  await cameras.tick();
  assert.equal(required(cameras.byCamera.get(plan.cameraId)).id, controller.id);
  assert.equal(
    required(cameras.byCamera
      .get(plan.cameraId))
      .owners.has("recording-controller-fixture"),
    false,
  );
  assert.equal(adds, 1, "controller loss must not restart the source");
  await continuity.stop();
  await cameras.stop();
  cameras = await create();
  continuity = await new CameraContinuity(path, key, cameras, {
    now: () => at,
  }).initialize();
  // initialize starts one asynchronous tick; await it through a bounded microtask drain.
  for (let i = 0; i < 20 && continuity.busy; i++)
    await new Promise((r) => setImmediate(r));
  assert.equal(cameras.sessions.size, 1);
  assert.equal(adds, 2);
  await continuity.update([plan, { ...plan, cameraId: "camera.second" }]);
  assert.equal(
    cameras.sessions.size,
    1,
    "persisted policy cannot bypass a one-source node",
  );
  assert.equal(
    required(continuity.status().cameras.find((c) => c.cameraId === "camera.second"))
      .state,
    "waiting",
  );
  await assert.rejects(
    continuity.update([
      { ...plan, source: { kind: "rtsp", url: "rtsp://8.8.8.8/live" } },
    ]),
    /invalid_camera_source/,
  );
  assert.equal(
    continuity.status().cameras.length,
    2,
    "invalid replacement leaves prior policy intact",
  );
  await continuity.update([]);
  assert.equal(cameras.sessions.size, 0);
  await continuity.update([plan]);
  assert.equal(cameras.sessions.size, 1);
  at = plan.expiresAt + 1;
  await continuity.tick();
  assert.equal(cameras.sessions.size, 0);
  await continuity.stop();
  await assert.rejects(
    new CameraContinuity(path, "different-key", cameras).initialize(),
    /unlocked/,
  );
});
