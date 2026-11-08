/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface SegmentPart {
  path: string;
  start: number;
  end: number;
}

export function bufferDirectoryPath(dataDir: string, cameraId: string): string {
  return join(dataDir, 'buffer', createHash('sha256').update(cameraId).digest('hex').slice(0, 20));
}

export function parseSegments(csv: string, directory: string): SegmentPart[] {
  const segments = new Map<string, SegmentPart>();
  for (const line of csv.trim().split('\n')) {
    const row = /^"?([^",]+\.mp4)"?,([\d.]+),([\d.]+)$/.exec(line);
    if (!row || !row[1] || !row[2] || !row[3]) continue;
    const name = row[1].split('/').at(-1);
    if (!name) continue;
    const sequential = /^b(\d{13})-[a-f0-9]{8}-\d{9,}\.mp4$/.exec(name);
    const legacy = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.mp4$/.exec(name);
    const from = Number(row[2]);
    const to = Number(row[3]);
    if ((!sequential && !legacy) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      continue;
    }
    let start: number;
    if (sequential) {
      start = Number(sequential[1]) + from * 1000;
    } else {
      const [year, month, day, hour, minute, second] = legacy!
        .slice(1)
        .map((value, index) => (index === 1 ? Number(value) - 1 : Number(value)));
      start = Date.UTC(year!, month!, day!, hour!, minute!, second!);
    }
    const path = join(directory, name);
    if (Number.isFinite(start)) {
      segments.set(path, { path, start, end: start + (to - from) * 1000 });
    }
  }
  return [...segments.values()];
}

export async function readBufferSegments(buffer: { readonly dir: string }): Promise<SegmentPart[]> {
  const names = (await readdir(buffer.dir).catch(() => [] as string[])).filter(
    (name) => name === 'index.csv' || /^b\d{13}-[a-f0-9]{8}\.csv$/.test(name),
  );
  const parts = await Promise.all(
    names.map(async (name) => {
      const csv = await readFile(join(buffer.dir, name), 'utf8').catch(() => '');
      // A camera's RTP clock can jump or drift independently of wall time.
      // Completed file mtimes track local receipt times, including
      // reconnects; never project hours of source timestamp drift onto events.
      const resolved = await Promise.all(
        parseSegments(csv, buffer.dir).map(async (part): Promise<SegmentPart | undefined> => {
          const info = await stat(part.path).catch(() => null);
          if (!info?.size) return undefined;
          const duration = part.end - part.start;
          return {
            ...part,
            start: info.mtimeMs - duration,
            end: info.mtimeMs,
          };
        }),
      );
      return resolved.filter((part): part is SegmentPart => part !== undefined);
    }),
  );
  // Old versions could list the same overwritten wall-clock file more than once.
  // Never concatenate one physical segment twice, including across reconnects.
  return [...new Map(parts.flat().map((part) => [part.path, part])).values()].sort(
    (a, b) => a.start - b.start || a.path.localeCompare(b.path),
  );
}
