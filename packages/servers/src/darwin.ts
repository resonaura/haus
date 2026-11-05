/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { macDisks } from './disks.js';
import { parseMacBattery } from './battery.js';
import type { HostDisk, HostSwap, HostMemory, HostBattery } from './types.js';

/** Samples macOS storage, memory, swap, and battery status. */
export async function sampleDarwinPlatform(
  run: (cmd: string, args: string[], options?: Record<string, unknown>) => Promise<string>,
  baseMemory: HostMemory,
) {
  let disks: HostDisk[] = [],
    swap: HostSwap = { supported: false, totalBytes: null, usedBytes: null },
    memory = baseMemory,
    battery: HostBattery | null = null;

  const values = await Promise.allSettled([
    macDisks({ run }),
    run('/usr/sbin/sysctl', ['-n', 'vm.swapusage']),
    run('/usr/bin/vm_stat', []),
    run('/usr/bin/pmset', ['-g', 'batt']),
  ]);

  if (values[0].status === 'fulfilled') disks = values[0].value;
  if (values[1].status === 'fulfilled') {
    const match = /total = ([\d.]+)M\s+used = ([\d.]+)M/.exec(values[1].value);
    if (match)
      swap = {
        supported: true,
        totalBytes: Math.round(Number(match[1]) * 1024 ** 2),
        usedBytes: Math.round(Number(match[2]) * 1024 ** 2),
      };
  }
  if (values[2].status === 'fulfilled') {
    const output = values[2].value;
    const page = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
    const fields = Object.fromEntries(
      [...output.matchAll(/^([^:\n]+):\s+(\d+)\./gm)].map((match) => [match[1], Number(match[2])]),
    );
    if (page) {
      const available = Math.min(
        memory.totalBytes,
        page *
          ((fields['Pages free'] || 0) +
            (fields['Pages inactive'] || 0) +
            (fields['Pages speculative'] || 0)),
      );
      memory = {
        totalBytes: memory.totalBytes,
        installedBytes: memory.installedBytes,
        availableBytes: available,
        usedBytes: memory.totalBytes - available,
      };
    }
  }
  if (values[3].status === 'fulfilled') battery = parseMacBattery(values[3].value);

  return { disks, swap, memory, battery };
}
