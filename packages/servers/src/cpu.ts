/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface CpuSample {
  source: 'proc' | 'os';
  total: number;
  idle: number;
  iowait: number;
}

/** Samples host and container CPU utilisation using /proc/stat or OS tick averages. */
export async function sampleCpuDelta(
  cpus: Array<{ times: Record<string, number> }>,
  previous: CpuSample | null | undefined,
  {
    platform,
    container,
    read,
  }: {
    platform: string;
    container?: boolean;
    read: (path: string, encoding: string) => Promise<string>;
  },
) {
  let sample: CpuSample | undefined;
  if (platform === 'linux' && !container) {
    const raw = await read('/proc/stat', 'utf8').catch(() => '');
    const fields = /^cpu[ \t]+([^\r\n]+)/m.exec(raw)?.[1]?.trim().split(/\s+/);
    const times = fields?.slice(0, 8).map(Number);
    if (times && times.length >= 4 && times.every((n) => Number.isSafeInteger(n) && n >= 0)) {
      sample = {
        source: 'proc',
        total: times.reduce((a, b) => a + b, 0),
        idle: times[3] + (times[4] ?? 0),
        iowait: times[4] ?? 0,
      };
    }
  }
  sample ??= {
    source: 'os',
    total: cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0),
    idle: cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0),
    iowait: 0,
  };
  if (
    !previous ||
    sample.source !== previous.source ||
    sample.total <= previous.total ||
    sample.idle < previous.idle ||
    sample.iowait < previous.iowait
  )
    return { sample, usage: null };
  const elapsed = sample.total - previous.total;
  const idle = sample.idle - previous.idle;
  if (idle > elapsed) return { sample, usage: null };
  return {
    sample,
    usage: Math.max(0, Math.min(1, 1 - idle / elapsed)),
  };
}
