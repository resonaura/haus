/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { nodeApiError } from "../lib/node-client.mjs";

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
