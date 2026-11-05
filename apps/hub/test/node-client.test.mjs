/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { nodeApiError, cameraFailureCode } from "@haus/servers";

test("node failures preserve known capture codes without remote payloads", async () => {
  const failure = await nodeApiError(
    new Response(
      JSON.stringify({
        error: "camera_recording_busy",
        message: "rtsp://private:secret@example.invalid/live",
      }),
      { status: 503 },
    ),
  );
  assert.equal(failure.message, "Node returned 503");
  assert.equal(failure.status, 503);
  assert.equal(failure.code, "camera_recording_busy");
  assert.equal(JSON.stringify(failure).includes("secret"), false);
  const unauthorized = await nodeApiError(new Response("", { status: 401 }));
  assert.equal(unauthorized.message, "invalid_node_key_or_clock");
  for (const code of ['camera_webrtc_failed', 'camera_viewer_busy', 'camera_stream_warming']) {
    const failure = await nodeApiError(new Response(JSON.stringify({error:code}), {status:503}));
    assert.equal(cameraFailureCode(failure), code);
  }
  assert.equal(cameraFailureCode(Error('rtsp://user:secret@private/live')), 'camera_request_failed');
  assert.equal(cameraFailureCode(new DOMException('private', 'TimeoutError')), 'camera_request_timeout');
});

test("malformed, unknown and over-budget error bodies cannot enter diagnostics", async () => {
  for (const body of [
    "broken",
    JSON.stringify({ error: "private-secret" }),
    JSON.stringify({
      error: "camera_recording_busy",
      padding: "x".repeat(4096),
    }),
  ]) {
    const failure = await nodeApiError(new Response(body, { status: 503 }));
    assert.equal(failure.code, undefined);
    assert.equal(failure.message, "Node returned 503");
  }
});
