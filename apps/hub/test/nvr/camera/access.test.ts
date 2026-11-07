/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */
import { engineFixture, ringFixture } from '../support/camera.js';
import { port } from '../support/values.js';

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Blobs, CameraSessions, CameraAccess, cameraAccessKey } from "../../../src/nvr/index.js";
import { cameraSource } from "@haus/media/source";
import { createNode } from "../../../src/nvr/index.js";
import { sign } from "../../../src/nvr/index.js";

test("a scoped camera key survives controller loss without becoming a node key; stored sources are encrypted and expiry/revocation are enforced", async () => {
  const root = await mkdtemp(join(tmpdir(), "haus-camera-access-"));
  const key = "fixture-root-key-with-at-least-32-bytes",
    id = "1".repeat(32),
    now = Date.now(),
    closes: string[] = [];
  const engine = engineFixture();
  const viewers = engine.viewers;
  engine.closeViewer = (id,owner) => { if(viewers.get(id)?.owner===owner) {viewers.delete(id);closes.push(id);} };
  engine.offer = async(session,owner) => {const viewerId=randomUUID(); viewers.set(viewerId,{session:{id:session},owner}); return {viewerId,answer:{type:'answer',sdp:'v=0\r\nfixture'}};};
  const cameras = await new CameraSessions(join(root,'sessions'),engine,{max:1,now:()=>now,ring:()=>ringFixture(now)}).initialize();
  const sessions=cameras.sessions, byCamera=cameras.byCamera;
  const blobs = new Blobs(join(root,'blobs')); await blobs.initialize();
  const path = join(root, "access.enc");
  const access = await new CameraAccess(path, key, cameras).initialize();
  const input = {
    id,
    cameraId: "camera.fixture",
    advertiseHost: "192.168.5.117",
    source: {
      kind: "p2p-restream",
      url: "rtsp://user:private-camera-secret@192.168.5.3:8556/camera",
    },
    expiresAt: now + 60000,
    preRollSeconds: 8,
    requireAudio: true,
    recordAudio: true,
    batteryPowered: false,
  };
  const server = createNode({
    key,
    blobs,
    nodeId: "fixture",
    instanceId: randomUUID(),
    cameras,
    cameraAccess: access,
    continuity: { update: async cameras => { assert.ok(Array.isArray(cameras)); return { accepted: cameras.length }; }, status: () => ({ profile: 1, cameras: [] }), stop: async () => {} },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${port(server)}`;
  const request = async (
    path: string,
    data: Record<string, unknown> | undefined,
    signingKey: string,
    method = "POST",
    delegated = true,
  ) => {
    const bytes =
      data === undefined
        ? undefined
        : JSON.stringify(
            path.startsWith("/v1/client/")
              ? { clientSession: "f".repeat(16), ...data }
              : data,
          );
    return fetch(base + path, {
      method,
      headers: {
        ...sign(
          signingKey,
          method,
          path,
          createHash("sha256")
            .update(bytes ?? "")
            .digest("hex"),
        ),
        ...(delegated ? { "x-haus-camera-access": id } : {}),
        ...(bytes ? { "Content-Type": "application/json" } : {}),
      },
      body: bytes,
    });
  };
  try {
    const issued = await request(
      "/v1/camera-access",
      input,
      key,
      "POST",
      false,
    );
    assert.equal(issued.status, 201);
    assert.equal(JSON.stringify(await issued.json()).includes("secret"), false);
    assert.equal(
      (await readFile(path)).includes(Buffer.from("private-camera-secret")),
      false,
    );
    if (process.platform !== "win32")
      assert.equal((await stat(path)).mode & 0o077, 0);
    assert.equal(
      (await new CameraAccess(path, key, cameras).initialize()).grants.size,
      1,
    );
    const clientKey = cameraAccessKey(key, id, input.cameraId, input.expiresAt);
    assert.equal(
      (
        await request(
          "/v1/camera-continuity",
          { cameras: [] },
          clientKey,
          "PUT",
        )
      ).status,
      401,
      "a camera-only key cannot authorize durable producers",
    );
    const assignedPolicy = await request(
      "/v1/camera-continuity",
      { cameras: [] },
      key,
      "PUT",
      false,
    );
    assert.equal(assignedPolicy.status, 200);
    assert.deepEqual(await assignedPolicy.json(), { accepted: 0 });
    const signedPath = "/v1/client/camera/status";
    const replay = {
      ...sign(clientKey, "GET", signedPath),
      "x-haus-camera-access": id,
    };
    assert.equal(
      (await fetch(base + signedPath, { headers: replay })).status,
      200,
    );
    assert.equal(
      (await fetch(base + signedPath, { headers: replay })).status,
      401,
    );
    const untouched = JSON.stringify({
      clientSession: "f".repeat(16),
      active: true,
      preview: true,
    });
    const modified = JSON.stringify({
      clientSession: "f".repeat(16),
      active: false,
      preview: true,
    });
    const tampered = await fetch(base + "/v1/client/camera/warm", {
      method: "POST",
      headers: {
        ...sign(
          clientKey,
          "POST",
          "/v1/client/camera/warm",
          createHash("sha256").update(untouched).digest("hex"),
        ),
        "x-haus-camera-access": id,
      },
      body: modified,
    });
    assert.equal(tampered.ok, false);
    assert.equal(sessions.size, 0);
    assert.equal(
      (await request("/v1/status", undefined, clientKey, "GET")).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/v1/camera-access",
          { ...input, cameraId: "camera.other" },
          clientKey,
        )
      ).status,
      401,
    );
    const warm = await request(
      "/v1/client/camera/warm",
      {
        active: true,
        preview: true,
        cameraId: "camera.other",
        source: { kind: "rtsp", url: "rtsp://public.invalid/" },
      },
      clientKey,
    );
    assert.equal(warm.status, 200);
    assert.ok(byCamera.has("camera.fixture"));
    assert.equal(byCamera.has("camera.other"), false);
    const viewerId = randomUUID();
    const secondViewer = randomUUID();
    assert.equal(
      (
        await request(
          "/v1/client/camera/viewer",
          {
            clientSession: "e".repeat(16),
            viewerId: secondViewer,
            offer: "v=0\r\nfixture",
          },
          clientKey,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/v1/client/camera/viewer",
          { viewerId, offer: "v=0\r\nfixture" },
          clientKey,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/v1/client/camera/warm",
          { active: false, preview: true },
          clientKey,
        )
      ).status,
      200,
    );
    assert.equal(
      viewers.size,
      2,
      "preview release cannot stop an independent viewer",
    );
    assert.equal(
      (await request("/v1/client/camera/close", { viewerId }, clientKey))
        .status,
      200,
    );
    assert.equal(
      viewers.size,
      1,
      "closing one app instance keeps another instance alive",
    );
    await access.provision(input);
    assert.equal(
      (await fetch(base + signedPath, { headers: replay })).status,
      401,
      "idempotent provisioning must not reset nonce replay protection",
    );
    const deniedPolicy = await request(
      "/v1/camera-access/reconcile",
      { cameras: [] },
      clientKey,
    );
    assert.equal(deniedPolicy.status, 401);
    const policy = await request(
      "/v1/camera-access/reconcile",
      { cameras: [] },
      key,
      "POST",
      false,
    );
    assert.equal(policy.status, 200);
    assert.deepEqual(await policy.json(), { revoked: 1 });
    assert.equal(viewers.size, 0);
    assert.equal(
      (await request("/v1/client/camera/warm", { active: true }, clientKey))
        .status,
      401,
    );
    assert.equal(
      (await new CameraAccess(path, key, cameras).initialize()).grants.size,
      0,
    );
    await access.provision(input);
    const expired = new CameraAccess(path, key, cameras, {
      now: () => input.expiresAt + 1,
    });
    await expired.initialize();
    assert.equal(expired.grants.size, 0);
    await assert.rejects(
      new CameraAccess(path, "different-private-key", cameras).initialize(),
      /unlocked/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await cameras.stop();
    await rm(root, { recursive: true, force: true });
  }
});
