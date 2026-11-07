/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { RecentPlayback } from "../lib/playback/recent.mjs";
import { openTestRecordingStore, queryOne, queryRows } from "./support/recording.mjs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RetentionCatalog } from "@haus/hub/storage";
import { openTestCatalog } from "./support/catalog.mjs";

async function fixtureStore(t) {
  const root = await mkdtemp(join(tmpdir(), "haus-recent-playback-"));
  await mkdir(join(root, "media"));
  const store = await openTestRecordingStore(join(root, "haus.sqlite"), join(root, "media"));
  const owner = await openTestCatalog(join(root, "haus.sqlite"));
  const catalog = new RetentionCatalog(owner.transactions);
  t.after(async () => {
    await owner.close();
    (await store.close());
    await rm(root, { recursive: true, force: true });
  });
  return { store, catalog };
}

async function fixture(t) {
  let at = 100000;
  const events = Array.from({ length: 6 }, (_, i) => ({
    id: String(i),
    cameraId: i < 3 ? "camera.a" : "camera.b",
    playbackVersion: 0,
  }));
  const calls = [];
  const { store, catalog } = await fixtureStore(t);
  for (const [i, event] of events.entries())
    (await queryRows(store, "INSERT INTO events(id,camera_id,start_at,end_at,status,kinds,detections,playback_version)VALUES(?,?,?,?,?,?,?,?)",
        event.id,
        event.cameraId,
        1000 - i,
        3000 - i,
        "ready",
        "[]",
        "[]",
        0,
      ));
  const recorder = {
    playbackJobs: new Map(),
    encoding: { pending: [] },
    cameras: ["camera.a", "camera.b"].map((id) => ({
      id,
      enabled: true,
      available: true,
    })),
    preparePlayback: async (event, priority, options) => {
      calls.push({ id: event.id, priority, options });
      (await queryRows(store, "UPDATE events SET playback_version=4 WHERE id=?", event.id));
    },
  };
  const cluster = { canPreparePlayback: () => true };
  const recent = new RecentPlayback(store, recorder, cluster, { catalog, now: () => at });
  return {
    events,
    store,
    calls,
    recorder,
    cluster,
    recent,
    catalog,
    advance: (ms) => (at += ms),
  };
}
test("recent preparation drains the bounded pending page beyond the last two clips per camera", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) await f.recent.tick();
  assert.deepEqual(
    f.calls.map((x) => x.id),
    ["0", "1", "2", "3", "4", "5"],
  );
  assert.ok(f.calls.every((x) => x.priority < 0 && x.options.remoteOnly));
});
test("background admission yields to foreground work and never runs on unavailable or unreplicated workers", async (t) => {
  const f = await fixture(t);
  f.cluster.canPreparePlayback = () => false;
  await f.recent.tick();
  assert.equal(f.calls.length, 0);
  f.cluster.canPreparePlayback = () => true;
  for (const reason of ["foreground", "finalizing", "disabled", "stopped"]) {
    f.recorder.playbackJobs.clear();
    f.recorder.encoding.activeWork = null;
    f.recorder.stopped = false;
    f.recorder.cameras.forEach((c) => {
      c.available = true;
      c.enabled = true;
    });
    if (reason === "foreground") f.recorder.playbackJobs.set("selected", {});
    if (reason === "finalizing") f.recorder.encoding.activeWork = {};
    if (reason === "offline")
      f.recorder.cameras.forEach((c) => (c.available = false));
    if (reason === "disabled")
      f.recorder.cameras.forEach((c) => (c.enabled = false));
    if (reason === "stopped") f.recorder.stopped = true;
    await f.recent.tick();
    assert.equal(f.calls.length, 0, reason);
  }
});
test("a slow or failed worker creates one task at a time with a bounded retry interval", async (t) => {
  const f = await fixture(t);
  let finish, entered;
  let entry = new Promise((resolve) => { entered = resolve; });
  f.recorder.preparePlayback = async (event) => {
    f.calls.push(event.id);
    entered();
    await new Promise((resolve) => (finish = resolve));
    throw Error("worker_unavailable");
  };
  const first = f.recent.tick();
  await entry;
  await f.recent.tick();
  assert.deepEqual(f.calls, ["0"]);
  finish();
  await first;
  entry = new Promise((resolve) => { entered = resolve; });
  const second = f.recent.tick();
  await entry;
  assert.deepEqual(f.calls, ["0", "1"]);
  finish();
  await second;
  f.recorder.preparePlayback = async (event) => {
    f.calls.push(event.id);
    throw Error("worker_unavailable");
  };
  await f.recent.tick();
  await f.recent.tick();
  await f.recent.tick();
  await f.recent.tick();
  await f.recent.tick();
  assert.deepEqual(f.calls, ["0", "1", "2", "3", "4", "5"]);
  f.advance(60000);
  await f.recent.tick();
  assert.equal(f.calls.at(-1), "0");
});

test("prepared recent rows do not bury old pending media or unsafe original markers", async (t) => {
  const { store, catalog } = await fixtureStore(t);
  for (let i = 0; i < 70; i++) {
    const event = (await store.create("camera.a", "motion", 1000 + i, 3000 + i));
    (await store.finish(event.id, { duration: 2, bytes: 1, playbackVersion: 4 }));
  }
  const unsafe = (await store.create("camera.a", "motion", 100, 200));
  (await store.finish(unsafe.id, { duration: 1, bytes: 1, playbackVersion: 4 }));
  await store.setPlayback(unsafe.id, 0, 4, { originalCompatible: true });
  const calls = [];
  const recorder = {
    stopped: false,
    playbackJobs: new Map(),
    encoding: { pending: [] },
    cameras: [{ id: "camera.a", enabled: true, available: true }],
    preparePlayback: async (event) => {
      calls.push(event.id);
    },
  };
  const recent = new RecentPlayback(store, recorder, {
    canPreparePlayback: () => true,
  }, { catalog });
  await recent.tick();
  assert.deepEqual(calls, [unsafe.id]);
});

test("an offline camera's retained local footage can prepare without waking its source; disabled cameras and archived originals stay untouched", async (t) => {
  const f = await fixture(t);
  f.recorder.cameras.forEach((camera) => {
    camera.available = false;
  });
  await f.recent.tick();
  assert.equal(f.calls.length, 1);
  const disabled = await fixture(t);
  disabled.recorder.cameras.forEach((camera) => {
    camera.enabled = false;
  });
  await disabled.recent.tick();
  assert.equal(disabled.calls.length, 0);
  const archived = await fixture(t);
  (await queryRows(archived.store, "UPDATE events SET local_original=0"));
  await archived.recent.tick();
  assert.equal(archived.calls.length, 0);
});

test("64 unadmitted recent clips cannot hide older playable local footage", async (t) => {
  const { store, catalog } = await fixtureStore(t);
  for (let i = 0; i < 64; i++) {
    const e = (await store.create("camera.disabled", "motion", 2000 + i, 3000 + i));
    (await store.finish(e.id, { duration: 1, bytes: 1 }));
  }
  const old = (await store.create("camera.enabled", "motion", 1000, 2000));
  (await store.finish(old.id, { duration: 1, bytes: 1 }));
  const calls = [];
  const recorder = {
    playbackJobs: new Map(),
    encoding: { pending: [] },
    cameras: [
      { id: "camera.disabled", enabled: false },
      { id: "camera.enabled", enabled: true },
    ],
    preparePlayback: async (e) => {
      calls.push(e.id);
      (await store.finish(e.id, { duration: 1, bytes: 1, playbackVersion: 4 }));
    },
  };
  const recent = new RecentPlayback(
    store,
    recorder,
    { canPreparePlayback: () => true },
    { catalog, now: () => 100000 },
  );
  await recent.tick();
  await recent.tick();
  assert.deepEqual(calls, [old.id]);
});

test("slow repeated failures yield to unattempted old clips", async (t) => {
  const { store, catalog } = await fixtureStore(t);
  let at = 100000;
  for (let i = 0; i < 64; i++) {
    const e = (await store.create("camera.bad", "motion", 2000 + i, 3000 + i));
    (await store.finish(e.id, { duration: 1, bytes: 1 }));
  }
  const old = (await store.create("camera.good", "motion", 1000, 2000));
  (await store.finish(old.id, { duration: 1, bytes: 1 }));
  const calls = [];
  const recorder = {
    playbackJobs: new Map(),
    encoding: { pending: [] },
    cameras: [
      { id: "camera.bad", enabled: true },
      { id: "camera.good", enabled: true },
    ],
    preparePlayback: async (e) => {
      calls.push(e.id);
      if (e.cameraId === "camera.bad") {
        at += 61000;
        throw Error("worker_unavailable");
      }
      (await store.finish(e.id, { duration: 1, bytes: 1, playbackVersion: 4 }));
    },
  };
  const recent = new RecentPlayback(
    store,
    recorder,
    { canPreparePlayback: () => true },
    { catalog, now: () => at },
  );
  for (let i = 0; i < 65; i++) await recent.tick();
  assert.equal(calls.at(-1), old.id);
  assert.equal(new Set(calls).size, 65);
});

test("background retry cooldown survives a controller restart while new footage stays first", async (t) => {
  const f = await fixture(t);
  f.recorder.preparePlayback = async (event) => {
    f.calls.push(event.id);
    throw Error("worker_unavailable");
  };
  await f.recent.tick();
  assert.deepEqual(f.calls, ["0"]);
  const restarted = new RecentPlayback(
    f.store,
    f.recorder,
    f.cluster,
    { catalog: f.catalog, now: () => 100000 },
  );
  await restarted.tick();
  assert.deepEqual(f.calls, ["0", "1"]);
  const added = (await f.store.create("camera.a", "motion", 2000, 3000));
  (await f.store.finish(added.id, { duration: 1, bytes: 1 }));
  await restarted.tick();
  assert.equal(f.calls.at(-1), added.id);
  assert.equal(f.calls.filter((id) => id === "0").length, 1);
});

test("retry bookkeeping drops prepared, archived and expired rows without changing footage metadata", async (t) => {
  const f = await fixture(t);
  f.cluster.canPreparePlayback = () => false;
  await f.recent.tick();
  assert.equal(
    (await queryOne(f.store, "SELECT count(*) AS n FROM background_preparation_attempts", )).n,
    6,
  );
  (await queryRows(f.store,
    "UPDATE events SET playback_version=4 WHERE id='0'; UPDATE events SET local_original=0 WHERE id='1'; DELETE FROM events WHERE id='2'",
  ));
  const before = (await queryRows(f.store, "SELECT * FROM events ORDER BY id", ));
  await f.recent.tick();
  assert.equal(
    (await queryOne(f.store, "SELECT count(*) AS n FROM background_preparation_attempts", )).n,
    3,
  );
  assert.deepEqual(
    (await queryRows(f.store, "SELECT * FROM events ORDER BY id", )),
    before,
  );
});
