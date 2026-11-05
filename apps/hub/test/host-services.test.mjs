/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { homeAssistantServices } from "@haus/ha/node/host-services";

test("HA host services expose the actual Supervisor units without inventing resource counters", () => {
  const report = homeAssistantServices(
    {
      services: [
        {
          name: "NetworkManager.service",
          description: "Network Manager",
          state: "active",
          environment: "secret",
        },
        { name: "fixture.service", state: "failed" },
        { description: "invalid" },
      ],
    },
    1000,
  );
  assert.equal(report.available, true);
  assert.equal(report.source, "supervisor");
  assert.equal(report.services.length, 2);
  assert.equal(report.services[0].id, "NetworkManager.service");
  assert.equal(report.services[0].cpuPercent, null);
  assert.equal(report.services[0].memoryBytes, null);
  assert.equal(report.services[1].status, "failed");
  assert.ok(!JSON.stringify(report).includes("secret"));
  assert.equal(homeAssistantServices(null, 1000).available, false);
});
