/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

// Optional privileged read-only hardware probe. Never export raw SMBIOS records.
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

function safeSize(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseDmiInstalledMemory(entries) {
  let foundDevice = false;
  let totalBytes = 0;
  for (const raw of entries) {
    if (!Buffer.isBuffer(raw) || raw[0] !== 17 || raw[1] < 14) continue;
    foundDevice = true;
    const size = raw.readUInt16LE(12);
    if (size === 0) continue;
    if (size === 0xffff) return null;
    if (size === 0x7fff) {
      if (raw[1] < 32) return null;
      const extendedMegabytes = raw.readUInt32LE(28) & 0x7fffffff;
      if (!extendedMegabytes) return null;
      totalBytes += extendedMegabytes * 1024 ** 2;
      continue;
    }
    totalBytes +=
      (size & 0x8000 ? size & 0x7fff : size) *
      (size & 0x8000 ? 1024 : 1024 ** 2);
  }
  return foundDevice ? safeSize(totalBytes) : null;
}

async function readInstalledMemory() {
  try {
    const entries = await readdir("/sys/firmware/dmi/entries");
    const devices = entries
      .filter((name) => /^17-[\da-f]+$/i.test(name))
      .slice(0, 128);
    if (devices.length) {
      const raw = await Promise.all(
        devices.map((name) =>
          readFile(`/sys/firmware/dmi/entries/${name}/raw`).catch(() => null),
        ),
      );
      if (raw.every(Buffer.isBuffer)) {
        return parseDmiInstalledMemory(raw);
      }
    }
  } catch {
    /* ARM systems commonly have no SMBIOS table. */
  }
  return null;
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output" || !args[1].startsWith("/"))
  throw Error(
    "Usage: node install/host-memory-probe.mjs --output /absolute/hardware.json",
  );
const installedBytes = await readInstalledMemory();
if (installedBytes === null)
  throw Error("Installed memory is not reported by the host firmware.");
const output = args[1],
  temporary = `${output}.${randomUUID()}.tmp`;
const bootId = (
  await readFile("/proc/sys/kernel/random/boot_id", "utf8")
).trim();
if (!/^[a-f\d-]{36}$/i.test(bootId)) throw Error("Invalid boot identity.");
await mkdir(dirname(output), { recursive: true, mode: 0o755 });
try {
  await writeFile(
    temporary,
    JSON.stringify({
      version: 1,
      installedBytes,
      bootId,
      sampledAt: new Date().toISOString(),
    }) + "\n",
    { flag: "wx", mode: 0o644 },
  );
  await rename(temporary, output);
} finally {
  await unlink(temporary).catch(() => {});
}
