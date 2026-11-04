/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { eufyEndpoint } from "../lib/eufy-endpoint.mjs";
test("discovers Eufy through info endpoints allowed to the backup role; caches and coalesces reads", async () => {
  let calls = 0;
  const endpoint = eufyEndpoint(
    { token: "fixture-token" },
    {
      fetchRequest: async (url, options) => {
        calls++;
        assert.match(new URL(url).pathname, /^\/.*\/info$/);
        assert.equal(options.headers.Authorization, "Bearer fixture-token");
        return Response.json({
          data: !url.endsWith("/supervisor/info")
            ? {
                ip_address: "172.30.32.1",
                options: { port: 3000, password: "never-returned" },
              }
            : { addons: [{ slug: "abcd_eufy_security_ws", state: "started" }] },
        });
      },
    },
  );
  assert.deepEqual(
    await Promise.all([endpoint(), endpoint(), endpoint()]),
    Array(3).fill("ws://172.30.32.1:3000/"),
  );
  assert.equal(calls, 2);
  assert.equal(await endpoint(), "ws://172.30.32.1:3000/");
  assert.equal(calls, 2);
});
test("never discovers a public or disguised host, and explicit external installations win", async () => {
  for (const host of ["8.8.8.8", "192.168.example.com"]) {
    const endpoint = eufyEndpoint(
      { token: "fixture" },
      {
        fetchRequest: async (url) =>
          Response.json({
            data: !url.endsWith("/supervisor/info")
              ? { ip_address: host }
              : { addons: [{ slug: "a_eufy_security_ws", state: "started" }] },
          }),
      },
    );
    assert.equal(await endpoint(), undefined);
  }
  assert.equal(
    await eufyEndpoint({ eufy_ws_url: "ws://eufy.local:3000/" })(),
    "ws://eufy.local:3000/",
  );
});
