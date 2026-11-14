/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CameraRecordingJob, SegmentRow } from './recording.js';

const SEGMENT_FILE_PATTERN = /^(?:\d{9}|\d{12,})\.ts$/;
const SEGMENT_CSV_PATTERN = /^segments(?:-\d{3})?\.csv$/;
const RUN_CSV_PATTERN = /^segments-\d{3}\.csv$/;
const ORPHAN_GRACE_MS = 10000;

export async function readRingSegments(
  root: string,
  runClocks: Map<string, number>,
): Promise<{ entries: string[]; rows: SegmentRow[] }> {
  const entries = await readdir(root).catch(() => [] as string[]);
  const lists = entries.filter((name) => SEGMENT_CSV_PATTERN.test(name));
  const rows: SegmentRow[] = [];
  for (const list of lists) {
    const csv = await readFile(join(root, list), 'utf8').catch(() => '');
    for (const line of csv.split('\n')) {
      const match = /^(?:"?)(?:[^",]*\/)?((?:\d{9}|\d{12,})\.ts)(?:"?),([\d.]+),([\d.]+)$/.exec(
        line,
      );
      if (!match) continue;
      const from = Number(match[2]);
      const to = Number(match[3]);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 30) {
        continue;
      }
      const info = await stat(join(root, match[1])).catch(() => null);
      if (!info) continue;
      rows.push({
        name: match[1],
        from,
        to,
        info,
        run: list,
        startAt: 0,
        endAt: 0,
      });
    }
  }
  const activeRuns = new Set(rows.map((row) => row.run));
  for (const run of runClocks.keys()) {
    if (!activeRuns.has(run)) runClocks.delete(run);
  }
  for (const row of [...rows].sort((a, b) => a.from - b.from)) {
    if (!runClocks.has(row.run) && row.info) {
      runClocks.set(row.run, row.info.mtimeMs - row.to * 1000);
    }
  }
  for (const row of rows) {
    const origin = runClocks.get(row.run) ?? 0;
    row.startAt = origin + row.from * 1000;
    row.endAt = origin + row.to * 1000;
  }
  rows.sort((a, b) => a.startAt - b.startAt || a.name.localeCompare(b.name));
  return { entries, rows };
}

export interface PruneRingStorageOptions {
  root: string;
  entries: string[];
  rows: SegmentRow[];
  jobs: Iterable<CameraRecordingJob>;
  retentionSeconds: number;
  maxBytes: number;
  now: number;
  latestName?: string;
}

/** Evicts expired/excess segments before checking the hard safety byte cap. */
export async function pruneRingStorage({
  root,
  entries,
  rows,
  jobs,
  retentionSeconds,
  maxBytes,
  now,
  latestName,
}: PruneRingStorageOptions): Promise<{ retained: SegmentRow[]; ringBytes: number }> {
  const uncopiedWindows: Array<{ startAt: number; endAt: number; copied: Set<string> }> = [];
  for (const job of jobs) {
    if (job.state === 'recording' || job.state === 'preparing') {
      uncopiedWindows.push({
        startAt: job.startAt - 4000,
        endAt: job.endAt + 4000,
        copied: new Set(job.parts.keys()),
      });
    }
  }
  const isProtected = (part: SegmentRow): boolean => {
    if (part.name === latestName) return true;
    return uncopiedWindows.some(
      (win) => !win.copied.has(part.name) && part.endAt >= win.startAt && part.startAt <= win.endAt,
    );
  };

  let bytes = 0;
  const kept: SegmentRow[] = [];
  const keptNames = new Set<string>();
  const keptRuns = new Set<string>();

  for (const part of [...rows].reverse()) {
    const file = join(root, part.name);
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    const expired = now - part.endAt > retentionSeconds * 1000;
    const overBudget = bytes + info.size > maxBytes;
    if (!isProtected(part) && (expired || overBudget)) {
      await rm(file, { force: true }).catch(() => {});
      continue;
    }
    bytes += info.size;
    kept.push(part);
    keptNames.add(part.name);
    keptRuns.add(part.run);
  }
  kept.reverse();

  let ringBytes = 0;
  for (const name of entries) {
    if (SEGMENT_FILE_PATTERN.test(name)) {
      const file = join(root, name);
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      if (!keptNames.has(name) && name !== latestName && now - info.mtimeMs > ORPHAN_GRACE_MS) {
        await rm(file, { force: true }).catch(() => {});
        continue;
      }
      ringBytes += info.size;
      continue;
    }
    if (RUN_CSV_PATTERN.test(name) && !keptRuns.has(name)) {
      const file = join(root, name);
      const info = await stat(file).catch(() => null);
      if (info && now - info.mtimeMs > ORPHAN_GRACE_MS) {
        await rm(file, { force: true }).catch(() => {});
      }
    }
  }

  return { retained: kept, ringBytes };
}
