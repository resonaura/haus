/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { access, open } from 'node:fs/promises';
import { clean, sanitizeHostReport } from './sanitize.js';
import type { HostProcParsed } from './types.js';

export type { HostProcParsed } from './types.js';

export const MAX_REPORT = 512 * 1024;

const nullableNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown, fallback: string | null = null) =>
  typeof value === 'string' ? value.slice(0, 240) : fallback;

const armCpuParts = new Map([
  ['0xb76', 'ARM1176JZF-S'],
  ['0xc07', 'Cortex-A7'],
  ['0xc0f', 'Cortex-A15'],
  ['0xd03', 'Cortex-A53'],
  ['0xd04', 'Cortex-A35'],
  ['0xd05', 'Cortex-A55'],
  ['0xd07', 'Cortex-A57'],
  ['0xd08', 'Cortex-A72'],
  ['0xd09', 'Cortex-A73'],
  ['0xd0a', 'Cortex-A75'],
  ['0xd0b', 'Cortex-A76'],
  ['0xd0c', 'Neoverse N1'],
  ['0xd0d', 'Cortex-A77'],
  ['0xd41', 'Cortex-A78'],
  ['0xd44', 'Cortex-X1'],
  ['0xd46', 'Cortex-A510'],
  ['0xd47', 'Cortex-A710'],
  ['0xd48', 'Cortex-X2'],
  ['0xd49', 'Neoverse N2'],
  ['0xd4d', 'Cortex-A715'],
  ['0xd4e', 'Cortex-X3'],
  ['0xd80', 'Cortex-A520'],
  ['0xd81', 'Cortex-A720'],
  ['0xd82', 'Cortex-X4'],
]);

/** Resolve ARM core names from the architected implementer/part fields in procfs. */
export function parseHostCpuModel(cpuinfo: unknown) {
  if (typeof cpuinfo !== 'string' || !cpuinfo.trim()) return null;
  const modelName = text(/^(?:model name)\s*:\s*(.+)$/im.exec(cpuinfo)?.[1])?.trim();
  if (modelName && !/^ARMv\d+\s+Processor\b/i.test(modelName)) return modelName;

  const parts = new Set<string>();
  for (const block of cpuinfo.split(/(?=^processor\s*:\s*\d+)/m)) {
    const implementer = /^CPU implementer\s*:\s*(0x[\da-f]+)\s*$/im.exec(block)?.[1]?.toLowerCase();
    const part = /^CPU part\s*:\s*(0x[\da-f]+)\s*$/im.exec(block)?.[1]?.toLowerCase();
    const name = part ? armCpuParts.get(part) : undefined;
    if (implementer === '0x41' && name) parts.add(name);
  }
  if (parts.size) return `ARM ${[...parts].join(' + ')}`;

  const hardware = text(/^(?:Hardware)\s*:\s*(.+)$/im.exec(cpuinfo)?.[1])?.trim();
  return (
    hardware || modelName || text(/^Processor\s*:\s*(.+)$/im.exec(cpuinfo)?.[1])?.trim() || null
  );
}

/** Linux's CPU and memory proc counters describe the kernel host, not this container's limits. */
export function parseHostProc(stat: string, meminfo: string, uptime: string): HostProcParsed {
  const times = /^cpu\s+([\d\s]+)$/m.exec(stat)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
  const fields = Object.fromEntries(
    [...meminfo.matchAll(/^(\w+):\s+(\d+)\s+kB$/gm)].map((m) => [m[1], Number(m[2]) * 1024]),
  );
  const total = fields.MemTotal;
  const available = fields.MemAvailable ?? fields.MemFree + fields.Buffers + fields.Cached;
  const elapsed = uptime.trim().split(/\s/)[0];
  return {
    cpuTimes:
      times?.length === 8 && times.every(Number.isFinite)
        ? { total: times.reduce((a, b) => a + b, 0), idle: times[3] + times[4] }
        : null,
    logicalCores: [...stat.matchAll(/^cpu\d+\s/gm)].length || null,
    memory: {
      totalBytes: nullableNumber(total),
      availableBytes: nullableNumber(available),
      usedBytes: nullableNumber(total - available),
    },
    swap: {
      supported: Number.isFinite(fields.SwapTotal),
      totalBytes: nullableNumber(fields.SwapTotal),
      usedBytes: nullableNumber(fields.SwapTotal - fields.SwapFree),
    },
    uptimeSeconds: elapsed ? nullableNumber(Number(elapsed)) : null,
  };
}

/** Parse the small, public identity fields from os-release without evaluating shell syntax. */
export function parseOsRelease(contents: string) {
  const values = Object.fromEntries(
    String(contents ?? '')
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^(ID|PRETTY_NAME)=([^\n]*)$/.exec(line.trim());
        if (!match) return [];
        let value = match[2].trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        )
          value = value.slice(1, -1);
        return [[match[1], value]];
      }),
  );
  const distribution = values.ID?.toLowerCase();
  const osName = values.PRETTY_NAME;
  return {
    ...(distribution && /^[a-z0-9._-]{1,80}$/.test(distribution) ? { distribution } : {}),
    ...(osName ? { osName: clean(osName, 160) } : {}),
  };
}

export async function readHostReport(file: string, now = Date.now()) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_REPORT) throw new Error('invalid_host_report');
    const buffer = Buffer.alloc(MAX_REPORT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_REPORT) throw new Error('invalid_host_report');
    return sanitizeHostReport(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), now);
  } finally {
    await handle.close();
  }
}

export async function isContainer() {
  return (
    process.env.HAUS_CONTAINER === 'true' ||
    (await access('/.dockerenv').then(
      () => true,
      () => false,
    )) ||
    (await access('/run/.containerenv').then(
      () => true,
      () => false,
    ))
  );
}
