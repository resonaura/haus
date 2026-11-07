import { eufyAddress } from '@haus/kitsune/native';
/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
export const SUPPORTED_HA_APPLIANCES = Object.freeze([
  "ha-green",
  "ha-yellow",
  "ha-os",
  "ha-supervised",
  "ha",
]);
export const defaults = Object.freeze({
  homekit_address: "",
  recording_enabled: true,
  record_audio: true,
  ha_backups_enabled: true,
  eufy_ws_url: "",
  pre_roll_seconds: 8,
  post_roll_seconds: 20,
  max_event_seconds: 300,
  retention_days: 7,
  max_storage_gb: 10,
  max_buffer_gb: 1,
});
export function validateOptions(input = {}) {
  const result = { ...defaults };
  if (input.homekit_address !== undefined) {
    if (typeof input.homekit_address !== "string" || (input.homekit_address !== "" && (isIP(input.homekit_address) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(input.homekit_address)))) throw Error("Invalid HomeKit LAN address");
    result.homekit_address = input.homekit_address;
  }
  const ranges = {
    pre_roll_seconds: [0, 30],
    post_roll_seconds: [5, 120],
    max_event_seconds: [30, 300],
    retention_days: [1, 90],
    max_storage_gb: [0, 1000000],
    max_buffer_gb: [1, 10],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)
        throw new Error(`Invalid ${key}`);
      result[key] = input[key];
    }
  }
  for (const key of ["recording_enabled", "record_audio", "ha_backups_enabled"])
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") throw new Error(`Invalid ${key}`);
      result[key] = input[key];
    }
  if (input.eufy_ws_url) result.eufy_ws_url = eufyAddress(input.eufy_ws_url);

  return result;
}
export async function loadConfig() {
  const data = resolve(process.env.HAUS_DATA || "/data");
  let input = {};
  try {
    input = JSON.parse(await readFile(`${data}/options.json`, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const hasHaToken = Boolean(process.env.SUPERVISOR_TOKEN || process.env.HAUS_HA_TOKEN);
  const chosenAppliance = String(input.appliance || process.env.HAUS_APPLIANCE || "")
    .trim()
    .toLowerCase();
  const explicitAppliance =
    process.env.HAUS_STANDALONE !== "1" &&
    (SUPPORTED_HA_APPLIANCES.includes(chosenAppliance) ||
      process.env.HAUS_MODE === "ha-appliance" ||
      process.env.HAUS_STANDALONE === "0");
  const standalone = !explicitAppliance;
  if (!standalone && !hasHaToken)
    throw new Error("Home Assistant authentication is missing");
  const apiToken =
    process.env.HAUS_API_TOKEN || (standalone ? randomBytes(24).toString("hex") : undefined);

  let base = null;
  let ws = null;
  if (!standalone && (process.env.HAUS_HA_URL || hasHaToken)) {
    const rawBase = new URL(process.env.HAUS_HA_URL || "http://supervisor/core");
    if (
      !["http:", "https:"].includes(rawBase.protocol) ||
      rawBase.username ||
      rawBase.password
    )
      throw new Error("Invalid Home Assistant address");
    base = rawBase.href.replace(/\/$/, "");
    ws = process.env.HAUS_HA_URL
      ? rawBase.origin.replace(/^http/, "ws") + "/api/websocket"
      : "ws://supervisor/core/websocket";
  }

  return {
    ...validateOptions(input),
    data,
    media: resolve(process.env.HAUS_MEDIA || "/media/haus"),
    base,
    ws,
    token: standalone ? null : process.env.SUPERVISOR_TOKEN || process.env.HAUS_HA_TOKEN || null,
    standalone,
    mode: standalone ? "standalone" : "ha-appliance",
    appliance: standalone ? null : chosenAppliance || "ha",
    apiToken,
    port: Number(process.env.PORT || 8099),
  };
}
